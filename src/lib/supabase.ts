import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Product, ProductCategory, Sale, StoreInfo, StockMovement,
  RegisterSaleResult, RegisterSaleInput, ArrivalResult, ProductInput,
  Employee, EmployeeStatus,
  CancelSaleResult,
} from '@/types';


/** Acteur identifié côté serveur (employé ou boss). */
export interface Actor {
  id: string | null;
  token: string;
}

export interface SaveProductResult {
  ok: boolean;
  product_id?: string;
  error?: string;
}

export interface OwnerResult {
  ok: boolean;
  is_owner: boolean;
  employee_id?: string;
  name?: string;
  token?: string;
  status?: EmployeeStatus;
  /** true quand le serveur attend le code secret pour rattacher cet appareil. */
  claim_required?: boolean;
  /** true quand le patron de cet appareil n'a pas encore défini son code secret. */
  needs_secret?: boolean;
  error?: string;
}

export interface InviteResult {
  ok: boolean;
  employee_id?: string;
  name?: string;
  token?: string;
  is_owner?: boolean;
  status?: EmployeeStatus;
  /** Nom du boss qui a suspendu l'accès (renvoyé par employee_state). */
  suspended_by?: string | null;
  can_edit_catalog?: boolean;
  can_add_products?: boolean;
  error?: string;
}

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : null;

export async function pingSupabase(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('product_categories')
      .select('id', { count: 'exact', head: true });
    return !error;
  } catch {
    return false;
  }
}

// ---------- Products / categories ----------
export async function fetchCategories(): Promise<ProductCategory[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductCategory[];
}

export async function fetchProducts(includeArchived = false): Promise<Product[]> {
  if (!supabase) return [];
  let q = supabase
    .from('products')
    .select('*, category:product_categories(*), sale_units:product_sale_units(*)')
    .order('name', { ascending: true });
  if (!includeArchived) q = q.eq('is_archived', false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Product[];
}

export async function saveProduct(
  mode: 'create' | 'update' | 'archive',
  input: ProductInput,
  actor: Actor,
): Promise<SaveProductResult> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };

  // La fonction serveur est LA SEULE voie d'écriture du catalogue : les
  // politiques RLS de la base interdisent toute écriture directe depuis le
  // client (migration 0006). On ne tente donc jamais d'écriture directe :
  // sans identité serveur, on le dit clairement au lieu de produire une
  // requête « POST /rest/v1/products » systématiquement refusée (401).
  if (!actor.id || !actor.token) {
    return {
      ok: false,
      error: 'Identité serveur non confirmée : reconnecte-toi au réseau puis réessaie.',
    };
  }

  const { data, error } = await supabase.rpc('save_product', {
    p_actor_id: actor.id,
    p_actor_token: actor.token,
    p_mode: mode,
    p_product_id: input.id ?? null,
    p_name: input.name,
    p_category_id: input.category_id,
    p_image_url: input.image_url,
    p_stock_qty: input.stock_qty,
    p_low_stock_threshold: input.low_stock_threshold,
    p_price_gros: input.price_gros,
    p_price_detail: input.price_detail,
    p_idempotency_key: input.idempotency_key ?? null,
  });
  if (error) return { ok: false, error: error.message };

  // Le serveur répond toujours par un objet structuré : une réponse HTTP 200
  // ne signifie pas que l'écriture a réussi. On se fie uniquement à `ok`.
  const result = data as unknown as SaveProductResult | null;
  if (!result || result.ok !== true) {
    return { ok: false, error: result?.error ?? 'Enregistrement refusé par le serveur.' };
  }
  return result;
}

/**
 * Vérification explicite après archivage : la ligne a-t-elle réellement été
 * marquée comme archivée en base ? La fonction serveur renvoie `ok: true` même
 * lorsqu'aucune ligne ne correspond, on ne s'y fie donc pas seul.
 */
export async function isProductArchived(productId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('products')
    .select('is_archived')
    .eq('id', productId)
    .maybeSingle();
  if (error) return false;
  return !!(data as { is_archived: boolean } | null)?.is_archived;
}

/** Vrai si l'erreur signifie que la fonction RPC n'existe pas sur le serveur. */
function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code === 'PGRST202' || code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

// ---------- Employees / permissions (vérifiées côté serveur) ----------

/**
 * Reconnaît (ou rattache) l'appareil du patron.
 * `secret` est le CODE SECRET personnel du patron : c'est la SEULE preuve
 * acceptée pour rattacher un nouvel appareil. Le nom et le téléphone ne
 * donnent aucun droit. Le code n'est jamais conservé en clair (hash côté base).
 */
export async function ensureOwner(
  deviceToken: string,
  name?: string | null,
  phone?: string | null,
  secret?: string | null,
): Promise<OwnerResult> {
  if (!supabase) return { ok: false, is_owner: false, error: 'Supabase non configuré' };
  const code = secret && secret.trim() ? secret.trim() : null;
  const { data, error } = await supabase.rpc('ensure_owner', {
    p_device_token: deviceToken,
    p_name: name ?? null,
    p_phone: phone ?? null,
    p_secret: code,
  });
  if (error) return { ok: false, is_owner: false, error: error.message };
  return data as unknown as OwnerResult;
}

/**
 * « Code oublié » : échange un CODE TEMPORAIRE (généré par le gérant depuis
 * Supabase) contre un NOUVEAU code secret. Le code temporaire devient
 * inutilisable aussitôt, et l'appareil est rattaché au patron.
 */
export async function resetOwnerSecret(
  deviceToken: string,
  tempCode: string,
  newSecret: string,
): Promise<OwnerResult> {
  if (!supabase) return { ok: false, is_owner: false, error: 'Supabase non configuré' };
  const { data, error } = await supabase.rpc('reset_owner_secret', {
    p_device_token: deviceToken,
    p_temp_code: tempCode.trim(),
    p_new_secret: newSecret.trim(),
  });
  if (error) return { ok: false, is_owner: false, error: error.message };
  return data as unknown as OwnerResult;
}

/**
 * Repli sans fonction serveur : sur un serveur où la migration `0006` n'est pas
 * appliquée, les RPC employés n'existent pas. On gère alors les employés
 * directement dans la table `employees`, en encodant le jeton d'invitation et
 * les droits d'ajout de produits dans la colonne `role`.
 */
const EMP_ROLE_PREFIX = 'emp';

interface EmployeeRow {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  is_active: boolean;
  can_edit_catalog: boolean;
  created_at: string;
}

const EMPLOYEE_COLUMNS = 'id, name, phone, role, is_active, can_edit_catalog, created_at';

function newInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function encodeEmployeeRole(status: EmployeeStatus, canAddProducts: boolean, token: string): string {
  return `${EMP_ROLE_PREFIX}.${status}.${canAddProducts ? '1' : '0'}.${token}`;
}

/** Reconstitue un employé depuis une ligne `employees` (encodée ou non). */
function decodeEmployeeRow(row: EmployeeRow): Employee {
  const parts = String(row.role ?? '').split('.');
  const encoded = parts[0] === EMP_ROLE_PREFIX && parts.length >= 4;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? null,
    status: encoded ? (parts[1] as EmployeeStatus) : row.is_active ? 'active' : 'suspended',
    can_edit_catalog: !!row.can_edit_catalog,
    can_add_products: encoded && parts[2] === '1',
    access_token: encoded ? parts.slice(3).join('.') : row.id,
    created_at: row.created_at,
  };
}

async function fetchEmployeeRows(): Promise<{ rows: EmployeeRow[]; error?: string }> {
  if (!supabase) return { rows: [], error: 'Supabase non configuré' };
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .order('created_at', { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as EmployeeRow[] };
}

async function fetchEmployeeRow(employeeId: string): Promise<{ row: EmployeeRow | null; error?: string }> {
  if (!supabase) return { row: null, error: 'Supabase non configuré' };
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('id', employeeId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as unknown as EmployeeRow) ?? null };
}

async function listEmployeesDirect(): Promise<{ ok: boolean; employees: Employee[]; error?: string }> {
  const { rows, error } = await fetchEmployeeRows();
  if (error) return { ok: false, employees: [], error };
  return { ok: true, employees: rows.map(decodeEmployeeRow) };
}

async function createEmployeeDirect(
  input: { name: string; phone: string | null; canEditCatalog: boolean; canAddProducts: boolean },
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  const { data, error } = await supabase
    .from('employees')
    .insert({
      name: input.name,
      phone: input.phone,
      role: encodeEmployeeRole('invited', input.canAddProducts, newInviteToken()),
      is_active: true,
      can_edit_catalog: input.canEditCatalog,
    })
    .select(EMPLOYEE_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, employee: decodeEmployeeRow(data as unknown as EmployeeRow) };
}

async function updateEmployeeDirect(
  employeeId: string,
  patch: { status?: EmployeeStatus; canEditCatalog?: boolean; canAddProducts?: boolean },
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  const { row, error: readError } = await fetchEmployeeRow(employeeId);
  if (readError) return { ok: false, error: readError };
  if (!row) return { ok: false, error: 'Employé introuvable.' };
  const employee = decodeEmployeeRow(row);
  const status = patch.status ?? employee.status;
  const { data, error } = await supabase
    .from('employees')
    .update({
      role: encodeEmployeeRole(status, patch.canAddProducts ?? employee.can_add_products, employee.access_token),
      is_active: status !== 'suspended',
      can_edit_catalog: patch.canEditCatalog ?? employee.can_edit_catalog,
    })
    .eq('id', employeeId)
    .select(EMPLOYEE_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, employee: decodeEmployeeRow(data as unknown as EmployeeRow) };
}

async function regenerateInviteDirect(
  employeeId: string,
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  const { row, error: readError } = await fetchEmployeeRow(employeeId);
  if (readError) return { ok: false, error: readError };
  if (!row) return { ok: false, error: 'Employé introuvable.' };
  const employee = decodeEmployeeRow(row);
  const status: EmployeeStatus = employee.status === 'suspended' ? 'suspended' : 'invited';
  const { data, error } = await supabase
    .from('employees')
    .update({ role: encodeEmployeeRole(status, employee.can_add_products, newInviteToken()) })
    .eq('id', employeeId)
    .select(EMPLOYEE_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, employee: decodeEmployeeRow(data as unknown as EmployeeRow) };
}

async function acceptInviteDirect(token: string): Promise<InviteResult> {
  const { rows, error } = await fetchEmployeeRows();
  if (error) return { ok: false, error };
  const employee = rows.map(decodeEmployeeRow).find((e) => e.access_token === token);
  if (!employee) return { ok: false, error: 'Invitation introuvable ou expirée.' };
  if (employee.status === 'suspended') return { ok: false, error: 'Accès suspendu par le boss.' };
  if (supabase) {
    await supabase
      .from('employees')
      .update({ role: encodeEmployeeRole('active', employee.can_add_products, employee.access_token) })
      .eq('id', employee.id);
  }
  return {
    ok: true,
    employee_id: employee.id,
    name: employee.name,
    token: employee.access_token,
    is_owner: false,
    status: 'active',
    can_edit_catalog: employee.can_edit_catalog,
    can_add_products: employee.can_add_products,
  };
}

async function employeeStateDirect(actor: Actor): Promise<InviteResult> {
  if (!supabase || !actor.id) return { ok: false, error: 'Appareil non identifié' };
  const { row, error } = await fetchEmployeeRow(actor.id);
  if (error) return { ok: false, error };
  if (!row) return { ok: false, error: 'Employé introuvable.' };
  const employee = decodeEmployeeRow(row);
  if (employee.access_token !== actor.token) return { ok: false, error: 'Accès invalide.' };
  return {
    ok: true,
    employee_id: employee.id,
    name: employee.name,
    token: employee.access_token,
    is_owner: false,
    status: employee.status,
    suspended_by: employee.suspended_by ?? null,
    can_edit_catalog: employee.can_edit_catalog,
    can_add_products: employee.can_add_products,
  };
}

export async function listEmployees(actor: Actor): Promise<{ ok: boolean; employees: Employee[]; error?: string }> {
  if (!supabase) return { ok: false, employees: [], error: 'Supabase non configuré' };
  if (actor.id && actor.token) {
    const { data, error } = await supabase.rpc('list_employees', {
      p_actor_id: actor.id, p_actor_token: actor.token,
    });
    if (!error) {
      const res = data as unknown as { ok: boolean; employees: Employee[]; error?: string };
      return { ok: res.ok, employees: res.employees ?? [], error: res.error };
    }
    if (!isMissingRpc(error)) return { ok: false, employees: [], error: error.message };
  }
  return listEmployeesDirect();
}

export async function createEmployee(
  actor: Actor,
  input: { name: string; phone: string | null; canEditCatalog: boolean; canAddProducts: boolean },
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  if (actor.id && actor.token) {
    const { data, error } = await supabase.rpc('create_employee', {
      p_actor_id: actor.id,
      p_actor_token: actor.token,
      p_name: input.name,
      p_phone: input.phone,
      p_can_edit: input.canEditCatalog,
      p_can_add: input.canAddProducts,
    });
    if (!error) return data as unknown as { ok: boolean; employee?: Employee; error?: string };
    if (!isMissingRpc(error)) return { ok: false, error: error.message };
  }
  return createEmployeeDirect(input);
}

export async function updateEmployee(
  actor: Actor,
  employeeId: string,
  patch: { status?: EmployeeStatus; canEditCatalog?: boolean; canAddProducts?: boolean },
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  if (actor.id && actor.token) {
    const { data, error } = await supabase.rpc('update_employee', {
      p_actor_id: actor.id,
      p_actor_token: actor.token,
      p_employee_id: employeeId,
      p_status: patch.status ?? null,
      p_can_edit: patch.canEditCatalog ?? null,
      p_can_add: patch.canAddProducts ?? null,
    });
    if (!error) return data as unknown as { ok: boolean; employee?: Employee; error?: string };
    if (!isMissingRpc(error)) return { ok: false, error: error.message };
  }
  return updateEmployeeDirect(employeeId, patch);
}

export async function regenerateInvite(
  actor: Actor,
  employeeId: string,
): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  if (actor.id && actor.token) {
    const { data, error } = await supabase.rpc('regenerate_invite', {
      p_actor_id: actor.id, p_actor_token: actor.token, p_employee_id: employeeId,
    });
    if (!error) return data as unknown as { ok: boolean; employee?: Employee; error?: string };
    if (!isMissingRpc(error)) return { ok: false, error: error.message };
  }
  return regenerateInviteDirect(employeeId);
}

export async function acceptInvite(token: string): Promise<InviteResult> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
  if (!error) return data as unknown as InviteResult;
  if (!isMissingRpc(error)) return { ok: false, error: error.message };
  return acceptInviteDirect(token);
}

export async function employeeState(actor: Actor): Promise<InviteResult> {
  if (!supabase || !actor.id || !actor.token) return { ok: false, error: 'Appareil non identifié' };
  const { data, error } = await supabase.rpc('employee_state', {
    p_actor_id: actor.id, p_actor_token: actor.token,
  });
  if (!error) return data as unknown as InviteResult;
  if (!isMissingRpc(error)) return { ok: false, error: error.message };
  return employeeStateDirect(actor);
}

// ---------- Store ----------
export async function fetchStore(): Promise<StoreInfo | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as StoreInfo) ?? null;
}

export async function updateStore(id: string, patch: Partial<Pick<StoreInfo, 'name' | 'phone' | 'address'>>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('stores').update(patch).eq('id', id);
  if (error) throw error;
}

// ---------- Sales ----------
export async function fetchSales(limit = 100): Promise<Sale[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Sale[];
}

export async function fetchSaleWithItems(id: string): Promise<Sale | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Sale) ?? null;
}

export async function registerSale(input: RegisterSaleInput): Promise<RegisterSaleResult> {
  if (!supabase) {
    return { ok: false, sale_id: '', reference: '', total: 0, amount_received: 0, status: 'paid', error: 'Supabase non configuré' };
  }
  const base = {
    p_store_id: input.storeId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_items: input.items,
    p_amount_received: input.amountReceived,
    p_customer_name: input.customerName ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_note: input.note ?? null,
    p_created_by: input.createdBy ?? null,
  };
  const hasActor = Boolean(input.actorId && input.actorToken);
  const { data, error } = await supabase.rpc('register_sale', hasActor
    ? { ...base, p_actor_id: input.actorId, p_actor_token: input.actorToken }
    : base);
  if (!error) return data as unknown as RegisterSaleResult;
  // Base pas encore migrée (fonction `register_sale` sans paramètres d'acteur) :
  // on rejoue sans identifiants. C'est la seule voie de repli autorisée.
  // Un acteur REFUSÉ (accès révoqué par le boss) n'est jamais contourné :
  // l'erreur remonte telle quelle à l'interface.
  if (hasActor && isMissingRpc(error)) {
    const retry = await supabase.rpc('register_sale', base);
    if (!retry.error) return retry.data as unknown as RegisterSaleResult;
    return { ok: false, sale_id: '', reference: '', total: 0, amount_received: 0, status: 'paid', error: retry.error.message };
  }
  return { ok: false, sale_id: '', reference: '', total: 0, amount_received: 0, status: 'paid', error: error.message };
}

export async function cancelSale(saleId: string, reason: string | null, cancelledBy: string | null, actor: Actor): Promise<CancelSaleResult> {
  if (!supabase) {
    return { ok: false, sale_id: '', reference: '', restocked_lines: 0, error: 'Supabase non configuré' };
  }
  const { data, error } = await supabase.rpc('cancel_sale', {
    p_sale_id: saleId,
    p_reason: reason,
    p_cancelled_by: cancelledBy,
    p_actor_id: actor.id,
    p_actor_token: actor.token,
  });
  if (error) {
    return { ok: false, sale_id: '', reference: '', restocked_lines: 0, error: error.message };
  }
  return data as unknown as CancelSaleResult;
}

// ---------- Arrivals ----------
export async function recordArrival(productId: string, quantity: number, note: string | null, createdBy: string | null): Promise<ArrivalResult> {
  if (!supabase) {
    return { ok: false, product_id: productId, new_stock_qty: 0, unit: '', error: 'Supabase non configuré' };
  }
  const { data, error } = await supabase.rpc('record_arrival', {
    p_product_id: productId,
    p_quantity: quantity,
    p_note: note,
    p_created_by: createdBy,
  });
  if (error) {
    return { ok: false, product_id: productId, new_stock_qty: 0, unit: '', error: error.message };
  }
  return data as unknown as ArrivalResult;
}

// ---------- Stock movements ----------
export async function fetchStockMovements(productId?: string, limit = 200): Promise<StockMovement[]> {
  if (!supabase) return [];
  let q = supabase
    .from('stock_movements')
    .select('*, product:products(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (productId) q = q.eq('product_id', productId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as StockMovement[];
}

// ---------- Storage (product images) ----------


export async function uploadProductImage(
  file: File,
  productId: string
): Promise<string | null> {
  if (!supabase) return null;

  // Lire la photo originale
  const image = await createImageBitmap(file);

  try {
    // Recadrer au centre en carré
    const size = Math.min(image.width, image.height);
    const x = (image.width - size) / 2;
    const y = (image.height - size) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de traiter la photo.');

    ctx.drawImage(
      image,
      x,
      y,
      size,
      size,
      0,
      0,
      1000,
      1000
    );

    // Convertir le résultat en fichier JPEG carré
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error('Échec du recadrage de la photo.'));
        },
        'image/jpeg',
        0.9
      );
    });

    const path = `products/${productId}-${Date.now()}.jpg`;

    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from('product-images')
      .getPublicUrl(path);

    return data.publicUrl ?? null;
  } finally {
    image.close();
  }
}



/**
 * Chemin Storage d'une URL publique du bucket `product-images` (ou `null` si
 * l'URL ne provient pas de ce bucket : image du catalogue local, URL externe…).
 */
export function productImagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/product-images/';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
}

/**
 * Supprime une photo du bucket `product-images`. Sans effet et considéré comme
 * un succès si l'URL ne provient pas de ce bucket (rien à nettoyer).
 */
export async function deleteProductImage(url: string | null | undefined): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase non configuré' };
  const path = productImagePathFromUrl(url);
  if (!path) return { ok: true };
  const { error } = await supabase.storage.from('product-images').remove([path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { type RegisterSaleInput };