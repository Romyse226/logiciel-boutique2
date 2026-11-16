import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Home, ShoppingCart, History, Crown, Plus, Store as StoreIcon,
  Check, ArrowRight, LogOut,
} from 'lucide-react';
import { classNames, formatFCFA, vibrate } from '@/lib/format';
import { getHostContext, slugFromName, storeUrl, usesPathRouting } from '@/lib/tenant';
import { userMessage } from '@/lib/errors';
import { SupabaseStatus } from '@/components/SupabaseStatus';
import { Skeleton, SkeletonCard } from '@/components/Skeleton';
import { SellPage } from '@/pages/SellPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { BossPage, type HistoryTab } from '@/pages/BossPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { StockLegend } from '@/components/StockList';
import { AddToCartSheet } from '@/components/AddToCartSheet';
import { CartSheet } from '@/components/CartSheet';
import { ReceiptSheet } from '@/components/ReceiptSheet';
import { ProductEditor, type ProductFormValue } from '@/components/ProductEditor';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useToast } from '@/components/Toast';
import { useCart } from '@/lib/useCart';
import { useUser } from '@/lib/useUser';
import { useOfflineSync } from '@/lib/useOfflineSync';
import { UNIT_GROS, UNIT_DETAIL, isGrosUnit, isDetailUnit } from '@/lib/product';
import {
  fetchCategories, fetchProducts, fetchStore, registerSale, fetchSaleWithItems,
  isSupabaseConfigured, pingSupabase, saveProduct, isProductArchived, employeeState,
  uploadProductImage, deleteProductImage, authPortal, setAuthSession,
  getAuthenticatedEmployee, signOut as signOutSupabase, supabase, type Actor, type AuthPortalResult,
} from '@/lib/supabase';
import type { CartLine, Product, ProductCategory, ProductSaleUnit, StoreInfo, Sale, ProductInput } from '@/types';

type Tab = 'home' | 'sell' | 'history' | 'boss';
type BossScreen = 'dashboard' | 'employees';

const DEMO_STORE: StoreInfo = {
  id: 'demo',
  name: 'Quincaillerie Démo',
  phone: '+225 07 00 00 00 00',
  address: '',
  is_demo: true,
};

function newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Vrai si l'unité stockée correspond à l'unité cible (tolère l'ancien encodage). */
function matchesUnit(stored: string, target: string): boolean {
  return target === UNIT_GROS ? isGrosUnit(stored) : isDetailUnit(stored);
}

function withUnit(units: ProductSaleUnit[], productId: string, unit: string, price: number, isDefault: boolean): ProductSaleUnit[] {
  if (units.some((u) => matchesUnit(u.unit, unit))) {
    // On réécrit aussi `unit` : cela répare au passage une valeur héritée mal encodée.
    return units.map((u) => (matchesUnit(u.unit, unit) ? { ...u, unit, price } : u));
  }
  return [...units, { id: `local-${productId}-${unit}`, product_id: productId, unit, price, factor_to_stock: 1, is_default: isDefault, allow_decimal: false }];
}

/** Vrai si l'erreur est d'origine réseau (et non une règle métier). */
function isNetworkError(message?: string | null): boolean {
  if (!message) return false;
  return /failed to fetch|networkerror|network|load failed|timeout|fetch/i.test(message);
}

function insufficientStockLine(lines: CartLine[], products: Product[]): CartLine | null {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const requested = new Map<string, { line: CartLine; quantity: number }>();
  for (const line of lines) {
    const current = requested.get(line.product.id);
    requested.set(line.product.id, {
      line: current?.line ?? line,
      quantity: (current?.quantity ?? 0) + line.quantity * line.factorToStock,
    });
  }
  for (const { line, quantity } of requested.values()) {
    const stock = productsById.get(line.product.id)?.stock_qty;
    const available = Number(stock);
    if (!Number.isFinite(available) || available <= 0 || quantity > available) return line;
  }
  return null;
}

function decrementProductsStock(products: Product[], lines: CartLine[]): Product[] {
  const decrements = new Map<string, number>();
  for (const line of lines) {
    decrements.set(
      line.product.id,
      (decrements.get(line.product.id) ?? 0) + line.quantity * line.factorToStock,
    );
  }
  return products.map((product) => {
    const decrement = decrements.get(product.id);
    if (decrement == null || product.stock_qty == null) return product;
    return { ...product, stock_qty: Math.max(0, +(product.stock_qty - decrement).toFixed(3)) };
  });
}

export default function App() {
  const {
    profile, identityReady, isGerant, canEditCatalog, canAddProducts,
    legacyEmployee, markIdentityReady, applyOwner, applyEmployee, applyRemoteState,
    clearIdentity, clearLegacyIdentity,
  } = useUser();
  const offline = useOfflineSync();
  const { notify } = useToast();

  const [tab, setTab] = useState<Tab>('home');
  const [bossScreen, setBossScreen] = useState<BossScreen>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(isSupabaseConfigured);
  /** Nom du boss qui a retiré l'accès : non nul = écran de blocage total (aucune navigation). */
  const [suspendedBy, setSuspendedBy] = useState<string | null>(null);

  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const paymentSubmitting = useRef(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const identityBootstrapStarted = useRef(false);

  const cart = useCart();
  const sellerName = profile.name || (isGerant ? 'Boss' : 'Employé');
  const actor: Actor = useMemo(() => ({ id: profile.employeeId, token: '' }), [profile.employeeId]);

  /**
   * Toutes les écritures exigent une session Supabase Auth; les identifiants
   * locaux historiques ne sont plus acceptés comme preuve d'identité.
   */
  const resolveActor = useCallback(async (): Promise<{ actor: Actor | null; error: string | null }> => {
    if (actor.id && actor.token) return { actor, error: null };
    if (actor.id && supabase) return { actor: { id: actor.id, token: '' }, error: null };
    if (!isSupabaseConfigured) {
      return { actor: null, error: 'Connexion au serveur impossible. Vérifie ton réseau.' };
    }
    return { actor: null, error: 'Session expirée : reconnecte-toi puis réessaie.' };
  }, [actor]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ok = await pingSupabase();
      setOnline(ok);
      if (!ok || !isSupabaseConfigured) { setLoading(false); return; }
      const [cats, prods, st] = await Promise.all([
        fetchCategories(), fetchProducts(false), fetchStore(),
      ]);
      setCategories(cats);
      setProducts(prods);
      if (st) setStore(st);
    } catch (e) {
      setLoadError(userMessage(e));
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, [profile.employeeId]);

  useEffect(() => {
    if (profile.employeeId) loadAll();
  }, [profile.employeeId, loadAll]);

  /** Tirer vers le bas : on renvoie d'abord les opérations en attente, puis on relit les données. */
  const refreshAll = useCallback(async () => {
    await offline.syncNow();
    await loadAll();
  }, [offline.syncNow, loadAll]);

  // ---------- Identité : boss propriétaire, employé invité, lien WhatsApp ----------

  /**
   * Vérifie côté serveur que l'accès de l'employé est toujours actif.
   * - statut « suspended » (accès retiré par le boss) -> blocage total ;
   * - jeton inconnu (invitation régénérée, employé retiré) -> blocage total ;
   * - panne réseau -> on conserve l'accès local (mode hors ligne garanti).
   */
  const verifyEmployeeAccess = useCallback(async () => {
    if (profile.isOwner || !profile.employeeId) return;
    try {
      const st = await employeeState(actor);
      if (st.ok) {
        if (st.status === 'suspended') {
          setSuspendedBy(st.suspended_by ?? 'le boss');
        } else {
          setSuspendedBy(null);
          applyRemoteState({ name: st.name, canEditCatalog: st.can_edit_catalog, canAddProducts: st.can_add_products });
        }
      } else if (st.error && !isNetworkError(st.error)) {
        setSuspendedBy(st.suspended_by ?? 'le boss');
      }
    } catch {
      /* hors-ligne : on conserve l'accès local */
    }
  }, [profile.isOwner, profile.employeeId, actor, applyRemoteState]);

  const applyAuthenticatedEmployee = useCallback((employee: NonNullable<Awaited<ReturnType<typeof getAuthenticatedEmployee>>>) => {
    if (employee.status === 'suspended') {
      setSuspendedBy(employee.suspended_by ?? 'le gérant');
      return;
    }
    setSuspendedBy(null);
    if (employee.is_owner) {
      applyOwner({ employeeId: employee.employee_id, name: employee.name });
    } else {
      applyEmployee({
        employeeId: employee.employee_id,
        name: employee.name,
        canEditCatalog: employee.can_edit_catalog,
        canAddProducts: employee.can_add_products,
      });
    }
  }, [applyEmployee, applyOwner]);

  const applyPortalSession = useCallback(async (result: AuthPortalResult) => {
    if (!result.ok || !result.session) {
      throw new Error(result.error ?? 'Connexion impossible.');
    }
    await setAuthSession(result.session);
    const employee = await getAuthenticatedEmployee();
    if (!employee) {
      await signOutSupabase();
      throw new Error('Le compte connecté ne correspond à aucun utilisateur actif.');
    }
    applyAuthenticatedEmployee(employee);
    clearLegacyIdentity();
    markIdentityReady();
  }, [applyAuthenticatedEmployee, clearLegacyIdentity, markIdentityReady]);

  // CORRIGÉ : on ne déconnecte PLUS sur un échec réseau de getAuthenticatedEmployee().
  // La session Supabase reste valide ; un second useEffect (plus bas) rattrape
  // le chargement du profil dès que le réseau revient / au focus / périodiquement.
  useEffect(() => {
    if (identityBootstrapStarted.current) return;
    identityBootstrapStarted.current = true;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const invite = params.get('invite');
        const host = getHostContext();
        if (invite && isSupabaseConfigured && host.slug) {
          const result = await authPortal({ action: 'accept-invite', token: invite });
          await applyPortalSession(result);
          params.delete('invite');
          const query = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
          notify('Bienvenue ! Ton accès employé est activé.');
          return;
        }

        if (!isSupabaseConfigured) {
          setAuthError('Supabase n’est pas configuré.');
          clearLegacyIdentity();
          return;
        }

        const { data: sessionData, error: sessionError } = await supabase!.auth.getSession();
        if (sessionError) throw sessionError;

        if (sessionData.session) {
          // Session présente : on tente de charger le profil.
          // - Succès -> app normale.
          // - Échec réseau -> on GARDE la session, on laisse profile vide
          //   (donc AccessCheckScreen) et le 2e useEffect réessaiera.
          // - Profil introuvable (token valide mais compte supprimé) -> déconnexion.
          let employee: Awaited<ReturnType<typeof getAuthenticatedEmployee>> = null;
          let networkFailure = false;
          try {
            employee = await getAuthenticatedEmployee();
          } catch (err) {
            if (isNetworkError(err instanceof Error ? err.message : String(err))) {
              networkFailure = true;
            } else {
              throw err;
            }
          }

          if (employee) {
            if (usesPathRouting() && host.root && employee.store_slug) {
              const query = window.location.search;
              const hash = window.location.hash;
              window.history.replaceState({}, '', `/store/${employee.store_slug}${query}${hash}`);
            }
            applyAuthenticatedEmployee(employee);
            clearLegacyIdentity();
            return;
          }

          if (networkFailure) {
            // Session conservée, profil pas encore chargé : on ne fait rien,
            // le 2e useEffect s'en occupe (retry au focus/réseau/interval).
            return;
          }

          // Token valide mais aucun profil associé : vraie déconnexion.
          await signOutSupabase();
        }

        if (legacyEmployee && host.slug) {
          const result = await authPortal({
            action: 'accept-invite',
            token: legacyEmployee.accessToken,
          });
          if (result.ok && result.session) {
            await applyPortalSession(result);
            notify('Session employé migrée vers une connexion sécurisée.');
            return;
          }
          setAuthError(result.error ?? 'Reconnecte-toi avec un nouveau lien d’invitation.');
        } else {
          clearLegacyIdentity();
        }
      } catch (error) {
        setAuthError(userMessage(error));
      } finally {
        markIdentityReady();
      }
    })();
  }, [applyPortalSession, clearLegacyIdentity, legacyEmployee, markIdentityReady, notify]);

  // CORRIGÉ (nouveau) : rattrapage du profil tant qu'une session Supabase existe
  // mais que profile.employeeId n'est pas encore chargé (échec réseau au boot,
  // actualisation, retour de veille, retour du réseau…).
  useEffect(() => {
    if (profile.employeeId) return;
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;
    const tryLoad = async () => {
      if (cancelled) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled || !data.session) return;
        const employee = await getAuthenticatedEmployee();
        if (cancelled || !employee) return;
        applyAuthenticatedEmployee(employee);
      } catch {
        /* réseau : on retentera */
      }
    };

    void tryLoad();
    const interval = window.setInterval(tryLoad, 5000);
    const onOnline = () => { void tryLoad(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void tryLoad(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile.employeeId, applyAuthenticatedEmployee]);

  // Retrait d'accès : on revérifie à chaque reconnexion et au retour sur l'app,
  // pour que le blocage soit effectif même sans rechargement de la page.
  useEffect(() => {
    if (profile.isOwner || !profile.employeeId) return;
    const recheck = () => { void verifyEmployeeAccess(); };
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile.isOwner, profile.employeeId, verifyEmployeeAccess]);

  async function handleOwnerLogin(phone: string, pin: string): Promise<string | null> {
    const host = getHostContext();

    // Sur un sous-domaine ou un path /store/<slug>, on garde la vérification.
    // Sur le domaine racine avec path-routing, le backend retrouve la boutique
    // à partir du téléphone : plus besoin de slug en amont.
    const needsSlug = !host.root || !usesPathRouting();
    if (needsSlug && !host.slug) {
      return 'Ouvre la page de connexion depuis le sous-domaine de ta boutique.';
    }

    const result = await authPortal({ action: 'login', phone, pin });
    if (!result.ok) return result.error ?? 'Numéro ou PIN incorrect.';
    try {
      await applyPortalSession(result);
      setAuthError(null);

      // Redirection path-routing : si on est sur / et que le backend nous a
      // renvoyé un slug, on bascule sur /store/<slug>.
      const employee = await getAuthenticatedEmployee();
      if (employee && usesPathRouting() && host.root && employee.store_slug) {
        const query = window.location.search;
        const hash = window.location.hash;
        window.history.replaceState({}, '', `/store/${employee.store_slug}${query}${hash}`);
      }
      return null;
    } catch (error) {
      return userMessage(error);
    }
  }

  async function handleStoreSignup(input: {
    storeName: string;
    ownerName: string;
    phone: string;
    pin: string;
    slug: string;
  }): Promise<string | null> {
    const result = await authPortal({
      action: 'signup',
      storeName: input.storeName,
      ownerName: input.ownerName,
      phone: input.phone,
      pin: input.pin,
      slug: input.slug,
    });
    if (!result.ok || !result.slug || !result.session) return result.error ?? 'Création de la boutique impossible.';
    const destination = storeUrl(result.slug);
    if (!destination) return 'Configure VITE_BASE_DOMAIN pour ouvrir la boutique créée.';
    try {
      await applyPortalSession(result);
      window.location.assign(destination);
      return null;
    } catch (error) {
      return userMessage(error);
    }
  }

  async function handleVerifyRecovery(phone: string, code: string): Promise<{ token?: string; error?: string }> {
    const result = await authPortal({ action: 'recovery-verify', phone, code });
    if (!result.ok || !result.recoveryToken) {
      return { error: result.error ?? 'Code invalide ou expiré.' };
    }
    return { token: result.recoveryToken };
  }

  async function handleCompleteRecovery(phone: string, token: string, newPin: string): Promise<string | null> {
    const result = await authPortal({
      action: 'recovery-complete',
      phone,
      recoveryToken: token,
      newPin,
    });
    if (!result.ok) return result.error ?? 'La modification du PIN a échoué.';
    try {
      await applyPortalSession(result);
      return null;
    } catch (error) {
      return userMessage(error);
    }
  }

  async function handleSignOut() {
    try {
      await signOutSupabase();
      clearIdentity();
      clearLegacyIdentity();
      setSuspendedBy(null);
      setStore(null);
      setProducts([]);
      setCategories([]);
      setTab('home');
    } catch (error) {
      notify(userMessage(error));
    }
  }

  const go = useCallback((t: Tab) => {
    vibrate(15);
    if (t === 'boss') setBossScreen('dashboard');
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openHistory = useCallback((_sub: HistoryTab) => {
    vibrate(15);
    setTab('history');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  async function handleAdd(product: Product, unit: string, quantity: number) {
    cart.add(product, unit, quantity);
    setCartOpen(true);
  }

  async function handleConfirmSale() {
    if (paymentSubmitting.current || processing) return;
    if (cart.lines.length === 0) return;
    paymentSubmitting.current = true;
    setProcessing(true);
    setSaleError(null);
    try {
      const insufficientLine = insufficientStockLine(cart.lines, products);
      if (insufficientLine) {
        setSaleError(`${insufficientLine.product.name} est en rupture de stock.`);
        return;
      }

      const items = cart.lines.map((l) => ({
        product_id: l.product.id,
        unit: l.unit,
        quantity: l.quantity,
        unit_price: l.price,
      }));
      const idempotencyKey = `sale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const payload = {
        storeId: store?.id && store.id !== 'demo' ? store.id : null,
        idempotencyKey,
        items,
        amountReceived: null,
        customerName: null,
        customerPhone: null,
        createdBy: sellerName,
        actorId: actor.id,
        actorToken: actor.token,
      };

      if (!offline.online || !isSupabaseConfigured) {
        offline.enqueue({ type: 'sale', payload });
        setProducts((current) => decrementProductsStock(current, cart.lines));
        setCartOpen(false);
        setReceiptOpen(false);
        cart.clear();
        notify('Vente enregistrée hors-ligne. Elle sera envoyée au retour du réseau.');
        openHistory('sales');
        return;
      }

      const res = await registerSale(payload);
      if (!res.ok) {
        if (isNetworkError(res.error)) {
          offline.enqueue({ type: 'sale', payload });
          setProducts((current) => decrementProductsStock(current, cart.lines));
          setCartOpen(false);
          cart.clear();
          notify('Connexion perdue : vente enregistrée hors-ligne. Elle sera envoyée au retour du réseau.');
          openHistory('sales');
          return;
        }
        setSaleError(
          /stock insuffisant|rupture de stock/i.test(res.error ?? '')
            ? 'Un produit du panier est en rupture de stock.'
            : userMessage(res.error),
        );
        return;
      }
      // La vente est enregistrée côté serveur (`res.ok === true`). La relecture
      // détaillée des articles ne doit JAMAIS transformer une vente
      // réussie en échec : si elle échoue, on affiche le reçu à partir des
      // informations confirmées par le serveur.
      let full: Sale | null = null;
      try {
        full = await fetchSaleWithItems(res.sale_id);
      } catch {
        full = null;
      }
      setLastSale(full ?? {
        id: res.sale_id,
        reference: res.reference,
        total: res.total,
        amount_received: res.amount_received,
        status: res.status,
        customer_name: null,
        customer_phone: null,
        note: null,
        created_at: new Date().toISOString(),
        created_by: sellerName,
        cancelled_at: null,
        cancelled_by: null,
        cancel_reason: null,
        sale_items: [],
      });
      setProducts((current) => decrementProductsStock(current, cart.lines));
      cart.clear();
      setCartOpen(false);
      setReceiptOpen(true);
      loadAll();
    } catch (e) {
      setSaleError(userMessage(e));
    } finally {
      paymentSubmitting.current = false;
      setProcessing(false);
    }
  }

  function startNewSale() {
    setReceiptOpen(false);
    setLastSale(null);
    setCartOpen(false);
    go('sell');
  }

  function openNewProduct() {
    setEditingProduct(null);
    setEditorOpen(true);
  }
  function openEditProduct(p: Product) {
    setEditingProduct(p);
    setEditorOpen(true);
  }

  function applyLocalProductUpdate(input: ProductInput) {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== input.id) return p;
      let units = withUnit(p.sale_units ?? [], p.id, UNIT_GROS, input.price_gros, false);
      units = withUnit(units, p.id, UNIT_DETAIL, input.price_detail, true);
      return { ...p, name: input.name, image_url: input.image_url ?? p.image_url, image_key: input.image_key ?? p.image_key, stock_qty: input.stock_qty, sale_units: units };
    }));
  }

  function applyLocalProductCreate(input: ProductInput, id: string) {
    const cat = categories.find((c) => c.id === input.category_id) ?? null;
    const prod: Product = {
      id,
      category_id: input.category_id,
      name: input.name,
      description: null,
      image_url: input.image_url,
      image_key: input.image_key ?? null,
      stock_unit: 'unité',
      stock_qty: input.stock_qty,
      low_stock_threshold: input.low_stock_threshold,
      is_active: true,
      is_archived: false,
      category: cat,
      sale_units: [
        { id: `local-${id}-${UNIT_GROS}`, product_id: id, unit: UNIT_GROS, price: input.price_gros, factor_to_stock: 1, is_default: false, allow_decimal: false },
        { id: `local-${id}-${UNIT_DETAIL}`, product_id: id, unit: UNIT_DETAIL, price: input.price_detail, factor_to_stock: 1, is_default: true, allow_decimal: false },
      ],
    };
    setProducts((prev) => [prod, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function handleProductSubmit(value: ProductFormValue, imageFile: File | null) {
    const canWrite = offline.online && isSupabaseConfigured;
    try {
      if (editingProduct) {
        let imageUrl = value.image_url;
        const previousImageUrl = editingProduct.image_url;
        if (imageFile) {
          if (!canWrite) return { ok: false, error: 'La modification de la photo nécessite une connexion.' };
          const url = await uploadProductImage(imageFile, editingProduct.id);
          if (url) imageUrl = url;
        }
        const input: ProductInput = {
          id: editingProduct.id,
          name: value.name,
          category_id: value.category_id ?? editingProduct.category_id,
          image_url: imageUrl,
          stock_qty: value.stock_qty,
          low_stock_threshold: editingProduct.low_stock_threshold,
          price_gros: value.price_gros,
          price_detail: value.price_detail,
          idempotency_key: `prod-${editingProduct.id}-${Date.now()}`,
        };
        if (!canWrite) {
          offline.enqueue({ type: 'adjust_stock', payload: { mode: 'update', input, actor } });
          applyLocalProductUpdate(input);
          notify('Modification enregistrée hors-ligne. Elle sera synchronisée.');
          return { ok: true };
        }
        const identity = await resolveActor();
        if (!identity.actor) return { ok: false, error: identity.error ?? 'Identité non confirmée. Réessaie.' };
        const res = await saveProduct('update', input, identity.actor);
        if (!res.ok) {
          if (isNetworkError(res.error)) {
            offline.enqueue({ type: 'adjust_stock', payload: { mode: 'update', input, actor } });
            applyLocalProductUpdate(input);
            notify('Connexion perdue : modification enregistrée hors-ligne.');
            return { ok: true };
          }
          return { ok: false, error: userMessage(res.error) };
        }
        // Remplacement de photo : on efface l'ancienne du stockage pour éviter
        // un fichier orphelin (sauf si un autre produit la partage encore).
        if (imageFile && previousImageUrl && previousImageUrl !== imageUrl) {
          const shared = products.some((p) => p.id !== editingProduct.id && p.image_url === previousImageUrl);
          if (!shared) {
            try { await deleteProductImage(previousImageUrl); } catch { /* la photo reste, sans bloquer */ }
          }
        }
        await loadAll();
        notify('Produit enregistré.');
        return { ok: true };
      }

      const newId = newUuid();
      const input: ProductInput = {
        id: newId,
        name: value.name,
        category_id: value.category_id,
        image_url: null,
        stock_qty: value.stock_qty,
        low_stock_threshold: value.low_stock_threshold,
        price_gros: value.price_gros,
        price_detail: value.price_detail,
        idempotency_key: `prod-new-${newId}`,
      };
      if (!canWrite) {
        if (imageFile) return { ok: false, error: 'L’ajout d’une photo nécessite une connexion.' };
        offline.enqueue({ type: 'adjust_stock', payload: { mode: 'create', input, actor } });
        applyLocalProductCreate(input, newId);
        notify('Produit enregistré hors-ligne. Il sera envoyé au retour du réseau.');
        return { ok: true };
      }
      const identity = await resolveActor();
      if (!identity.actor) return { ok: false, error: identity.error ?? 'Identité non confirmée. Réessaie.' };
      const res = await saveProduct('create', input, identity.actor);
      if (!res.ok) {
        if (isNetworkError(res.error)) {
          offline.enqueue({ type: 'adjust_stock', payload: { mode: 'create', input, actor } });
          applyLocalProductCreate(input, newId);
          notify('Connexion perdue : produit enregistré hors-ligne.');
          return { ok: true };
        }
        return { ok: false, error: userMessage(res.error) };
      }
      // Photo : envoyée après la création. Son échec n'annule pas le produit,
      // mais l'utilisateur en est informé (pas de réussite trompeuse).
      let photoWarning = false;
      if (imageFile) {
        const pid = res.product_id ?? newId;
        try {
          const url = await uploadProductImage(imageFile, pid);
          if (url) {
            const photo = await saveProduct('update', { ...input, id: pid, image_url: url, idempotency_key: null }, identity.actor);
            if (!photo.ok) photoWarning = true;
          } else photoWarning = true;
        } catch { photoWarning = true; }
      }
      await loadAll();
      notify(photoWarning
        ? 'Produit enregistré, mais la photo n’a pas pu être envoyée.'
        : 'Produit enregistré.');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: userMessage(e) };
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    if (!isSupabaseConfigured || !offline.online) {
      notify('Connexion requise pour supprimer un produit.');
      return;
    }
    const target = pendingDelete;
    setDeleting(true);
    try {
      const input: ProductInput = {
        id: target.id,
        name: target.name,
        category_id: target.category_id,
        // Photo détachée en base : elle sera supprimée du stockage juste après.
        image_url: null,
        stock_qty: target.stock_qty,
        low_stock_threshold: target.low_stock_threshold,
        price_gros: 0,
        price_detail: 0,
      };
      const identity = await resolveActor();
      if (!identity.actor) { notify(identity.error ?? 'Identité non confirmée. Réessaie.'); return; }
      const res = await saveProduct('archive', input, identity.actor);
      if (!res.ok) { notify(userMessage(res.error)); return; }

      // Vérification explicite du résultat réel en base : on n'annonce jamais
      // une suppression réussie sur la seule réponse de la fonction serveur.
      const archived = await isProductArchived(target.id);
      if (!archived) {
        notify('La suppression n’a pas été confirmée par le serveur. Réessaie.');
        return;
      }

      // Nettoyage de la photo : uniquement si elle appartient au stockage
      // Supabase et qu'aucun autre produit ne la partage (pas de suppression
      // involontaire d'une image partagée).
      const imageUrl = target.image_url;
      const shared = !!imageUrl && products.some((p) => p.id !== target.id && p.image_url === imageUrl);
      let photoCleared = true;
      if (imageUrl && !shared) {
        const del = await deleteProductImage(imageUrl);
        photoCleared = del.ok;
      }

      setProducts((prev) => prev.filter((p) => p.id !== target.id));
      setPendingDelete(null);
      if (photoCleared) notify('Produit supprimé.');
      else notify('Produit supprimé, mais sa photo n’a pas pu être effacée du stockage.');
    } catch (e) {
      notify(userMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  const cartCount = cart.count;
  const effectiveOnline = offline.online && online;

  if (!identityReady) {
    return <AccessCheckScreen />;
  }

  // Accès retiré par le boss : écran blanc total, aucune navigation.
  if (suspendedBy !== null) {
    return <SuspendedScreen bossName={suspendedBy} />;
  }

  if (!profile.employeeId) {
    return (
      <AuthPage
        host={getHostContext()}
        initialError={authError}
        onLogin={handleOwnerLogin}
        onSignup={handleStoreSignup}
        onVerifyRecovery={handleVerifyRecovery}
        onCompleteRecovery={handleCompleteRecovery}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:max-w-6xl lg:px-6 2xl:max-w-7xl">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setSignOutConfirmOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-red-50 hover:text-red-600" aria-label="Se déconnecter" title="Se déconnecter">
              <LogOut size={18} />
            </button>
            <button type="button" onClick={() => go('home')} className="flex min-w-0 items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow">
                <StoreIcon size={20} />
              </span>
              <div className="min-w-0 text-left">
                <h1 className="truncate text-base font-extrabold text-slate-800">{store?.name ?? 'Quincaillerie'}</h1>
                <p className="truncate text-[11px] text-slate-500">Profil : {sellerName}</p>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <SupabaseStatus compact />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-28 pt-4 lg:max-w-6xl lg:px-6 2xl:max-w-7xl">
        <OfflineBanner
          online={offline.online}
          pendingCount={offline.pending.length}
          syncing={offline.syncing}
          error={offline.lastSyncError ? userMessage(offline.lastSyncError) : null}
          onSync={offline.syncNow}
        />

        {loadError && (
          <div className="mb-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">
            {loadError}
          </div>
        )}

        {tab === 'home' ? (
          <HomeView
            online={effectiveOnline}
            loading={loading}
            store={store}
            products={products}
            productCount={products.length}
            categoryCount={categories.length}
            cartCount={cartCount}
            pendingCount={offline.pending.length}
            isBoss={isGerant}
            onGo={go}
            onNewSale={startNewSale}
            onOpenHistory={openHistory}
          />
        ) : tab === 'sell' ? (
          loading ? <LoadingBlock /> : (
            <SellPage
              products={products}
              categories={categories}
              canEditCatalog={canEditCatalog}
              canAddProducts={canAddProducts}
              onSelect={setSelected}
              onEdit={openEditProduct}
              onDelete={setPendingDelete}
              onNewProduct={openNewProduct}
              onNotify={notify}
              onRefresh={refreshAll}
              onBack={() => go('home')}
            />
          )
        ) : tab === 'history' ? (
          <HistoryPage
            supabaseOnline={effectiveOnline}
            isGerant={isGerant}
            actor={actor}
            userName={sellerName}
            onRefresh={refreshAll}
          />
        ) : tab === 'boss' ? (
          bossScreen === 'employees' ? (
            <EmployeesPage actor={actor} onBack={() => setBossScreen('dashboard')} onNotify={notify} />
          ) : (
            <BossPage
              supabaseOnline={effectiveOnline}
              onOpenEmployees={() => setBossScreen('employees')}
              products={products}
              storeId={store?.id ?? null}
            />
          )
        ) : null}
      </main>

      {tab === 'sell' && cartCount > 0 && !cartOpen && !receiptOpen && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed bottom-24 right-4 z-20 flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3.5 font-bold text-white shadow-xl shadow-orange-500/30 transition hover:bg-orange-600 active:scale-95 sm:bottom-28"
        >
          <ShoppingCart size={20} />
          <span>{cartCount} article{cartCount > 1 ? 's' : ''}</span>
          <span className="rounded-full bg-white/25 px-2 py-0.5 text-sm">{formatFCFA(cart.total)}</span>
        </button>
      )}

      {/* Barre de navigation du bas : 3 boutons */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto grid max-w-md grid-cols-3 items-end pb-[calc(env(safe-area-inset-bottom)+6px)]">
          <NavButton id="history" label="Historique" icon={History} active={tab === 'history'} onClick={go} />
          <NavButton id="home" label="Accueil" icon={Home} active={tab === 'home'} onClick={go} center />
          <NavButton id="sell" label="Vendre" icon={ShoppingCart} active={tab === 'sell'} onClick={go} badge={cartCount} />
        </div>
      </nav>

      <AddToCartSheet product={selected} onClose={() => setSelected(null)} onAdd={handleAdd} />
      <CartSheet
        open={cartOpen}
        lines={cart.lines}
        total={cart.total}
        processing={processing}
        error={saleError}
        onClose={() => setCartOpen(false)}
        onSetQty={cart.setQuantity}
        onRemove={cart.remove}
        onConfirm={handleConfirmSale}
        onContinueShopping={() => setCartOpen(false)}
      />
      <ReceiptSheet
        open={receiptOpen}
        sale={lastSale}
        store={store}
        onClose={() => setReceiptOpen(false)}
        onNewSale={startNewSale}
      />
      <ProductEditor
        open={editorOpen}
        product={editingProduct}
        categories={categories}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleProductSubmit}
      />

      {/* Confirmation de suppression */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => (deleting ? undefined : setPendingDelete(null))} aria-hidden />
          <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <h2 className="text-base font-extrabold text-slate-800">Supprimer ce produit ?</h2>
            <p className="mt-1 text-sm text-slate-600">
              « {pendingDelete.name} » sera retiré du catalogue. Cette action est définitive.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} disabled={deleting} className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">
                Annuler
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                {deleting ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {signOutConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="sign-out-title">
          <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setSignOutConfirmOpen(false)} aria-label="Fermer" />
          <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <h2 id="sign-out-title" className="text-base font-extrabold text-slate-800">Souhaitez-vous vraiment vous déconnecter ?</h2>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setSignOutConfirmOpen(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
                Annuler
              </button>
              <button type="button" onClick={() => { setSignOutConfirmOpen(false); void handleSignOut(); }} className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white">
                Me déconnecter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
      </div>
    </div>
  );
}

/** Écran blanc total affiché à un employé dont l'accès a été retiré par le boss. */
function SuspendedScreen({ bossName }: { bossName: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <p className="max-w-md text-center text-lg font-extrabold leading-relaxed text-slate-800">
        Votre accès à l'application a été retiré par {bossName}. Contactez-le pour qu'il vous réactive.
      </p>
    </div>
  );
}

/** Écran neutre affiché le temps de vérifier l'accès d'un employé auprès du serveur. */
function AccessCheckScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <Skeleton className="h-6 w-56" />
    </div>
  );
}

/** Squelette de l'accueil : reprend la structure (en-tête, badges, tuiles, stock). */
function HomeSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <section className="rounded-3xl bg-slate-200/70 p-6">
        <Skeleton className="h-3 w-24 rounded-full bg-white/60" />
        <Skeleton className="mt-2 h-8 w-52 rounded-lg bg-white/70" />
        <Skeleton className="mt-2 h-3 w-40 rounded-full bg-white/60" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-12 w-44 rounded-2xl bg-white/70" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-40 rounded-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="mt-3 h-4 w-24 rounded" />
            <Skeleton className="mt-1.5 h-3 w-32 rounded" />
          </div>
        ))}
      </div>

      <section className="space-y-2 pt-1">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </section>
    </div>
  );
}

function AuthPage({
  host, initialError, onLogin, onSignup, onVerifyRecovery, onCompleteRecovery,
}: {
  host: ReturnType<typeof getHostContext>;
  initialError: string | null;
  onLogin: (phone: string, pin: string) => Promise<string | null>;
  onSignup: (input: { storeName: string; ownerName: string; phone: string; pin: string; slug: string }) => Promise<string | null>;
  onVerifyRecovery: (phone: string, code: string) => Promise<{ token?: string; error?: string }>;
  onCompleteRecovery: (phone: string, token: string, newPin: string) => Promise<string | null>;
}) {
  type Step = 'login' | 'signup' | 'forgot' | 'verify' | 'new-pin';
  const [step, setStep] = useState<Step>(host.root ? 'signup' : 'login');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  const ADMIN_WHATSAPP = '2250757094873';

  // Restauration après retour de WhatsApp
  useEffect(() => {
    const saved = sessionStorage.getItem('recovery_flow');
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as { step?: Step; phone?: string; storeName?: string };
      if (data.phone) setPhone(data.phone);
      if (data.storeName) setStoreName(data.storeName);
      if (data.step === 'verify') setStep('verify');
    } catch { /* ignore */ }
  }, []);

  const handleWhatsAppRecovery = () => {
    if (!phone.trim()) {
      setError('Renseigne ton numéro de téléphone.');
      return;
    }
    const boutique = storeName.trim() || slugFromName(phone) || 'ma boutique';
    const message =
      `Bonjour WhaChap, je souhaite réinitialiser mon PIN.\n\n` +
      `Boutique : ${boutique}\n` +
      `Téléphone : ${phone}`;
    const url = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`;

    sessionStorage.setItem('recovery_flow', JSON.stringify({
      step: 'verify',
      phone,
      storeName,
    }));

    // Ouvre WhatsApp puis bascule l'UI sur la saisie du code
    window.open(url, '_blank', 'noopener,noreferrer');
    setStep('verify');
    setError(null);
  };

  async function submitLogin() {
    if (busy || pin.length !== 4) return;
    // Plus de vérification de slug ici : le backend gère le path-routing.
    setBusy(true);
    setError(null);
    try {
      const message = await onLogin(phone, pin);
      if (message) {
        setError(message);
        setPin('');
        vibrate([30, 60, 30]);
      }
    } catch (reason) {
      setError(userMessage(reason));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  async function submitSignup() {
    if (busy) return;
    if (!storeName.trim() || !ownerName.trim() || !phone.trim() || pin.length !== 4 || !slug) {
      setError('Renseigne tous les champs et choisis un PIN de 4 chiffres.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSignup({ storeName: storeName.trim(), ownerName: ownerName.trim(), phone, pin, slug });
      if (message) setError(message);
    } catch (reason) {
      setError(userMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (busy || recoveryCode.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onVerifyRecovery(phone, recoveryCode);
      if (result.error || !result.token) {
        setError(result.error ?? 'Code invalide ou expiré.');
        return;
      }
      setRecoveryToken(result.token);
      setPin('');
      setStep('new-pin');
    } catch (reason) {
      setError(userMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function completeRecovery() {
    if (busy || pin.length !== 4 || !recoveryToken) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onCompleteRecovery(phone, recoveryToken, pin);
      if (message) {
        setError(message);
        setPin('');
        setStep('verify');
      }
    } catch (reason) {
      setError(userMessage(reason));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Step, string> = {
    login: 'Connexion gérant',
    signup: 'Créer une boutique',
    forgot: 'PIN oublié ?',
    verify: 'Code temporaire',
    'new-pin': 'Nouveau PIN',
  };
  const subtitles: Record<Step, string> = {
    login: 'Connecte-toi avec ton numéro de téléphone et ton PIN.',
    signup: 'Crée ton espace de gestion sécurisé.',
    forgot: 'Le propriétaire de la plateforme génère le code manuellement dans Supabase et te le transmet par WhatsApp.',
    verify: 'Saisis le code temporaire reçu du propriétaire.',
    'new-pin': 'Choisis un nouveau PIN de 4 chiffres.',
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-orange-500 via-orange-500 to-amber-500 px-5 py-8">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow">
          <StoreIcon size={32} />
        </span>
        <h1 className="mt-4 text-center text-2xl font-extrabold text-slate-800">{titles[step]}</h1>
        <p className="mt-1 text-center text-sm text-slate-500">{subtitles[step]}</p>

        {step === 'login' && (
          <>
            <label className="mt-6 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Numéro de téléphone</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="Ex. : 07 00 00 00 00"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Code PIN (4 chiffres)</span>
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                maxLength={4}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-orange-400"
              />
            </label>
            <button
              type="button"
              onClick={submitLogin}
              disabled={busy || !phone.trim() || pin.length !== 4}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-60"
            >
              <Check size={20} /> {busy ? 'Connexion…' : 'Se connecter'}
            </button>
            <button type="button" onClick={() => { setStep('forgot'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-500">
              PIN oublié ?
            </button>
            {host.root && usesPathRouting() && (
              <button type="button" onClick={() => { window.history.replaceState({}, '', '/'); setStep('signup'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-orange-600">
                Première visite ? Créer une boutique
              </button>
            )}
          </>
        )}

        {step === 'signup' && (
          <>
            <label className="mt-6 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom de la boutique</span>
              <input value={storeName} onChange={(event) => { setStoreName(event.target.value); setSlug(slugFromName(event.target.value)); }} autoComplete="organization" placeholder="Ex. : Boutique du Centre" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom du gérant</span>
              <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} autoComplete="name" placeholder="Ex. : Awa Koné" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Téléphone du gérant</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Ex. : 07 00 00 00 00" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Code PIN (4 chiffres)</span>
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                maxLength={4}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-orange-400"
              />
            </label>
            <button type="button" onClick={submitSignup} disabled={busy || pin.length !== 4 || !storeName.trim() || !ownerName.trim() || !phone.trim()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-60">
              <Check size={20} /> {busy ? 'Création…' : 'Créer ma boutique'}
            </button>
            {host.root && usesPathRouting() && (
              <button type="button" onClick={() => { setStep('login'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-500">
                Déjà une boutique ? Se connecter
              </button>
            )}
          </>
        )}

        {step === 'forgot' && (
          <>
            <label className="mt-6 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Numéro de téléphone</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="Ex. : 07 00 00 00 00"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom de la boutique</span>
              <input
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="Ex. : Boutique du Centre"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
              />
            </label>
            <button
              type="button"
              onClick={handleWhatsAppRecovery}
              disabled={!phone.trim()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-60"
            >
              <ArrowRight size={20} /> Demander un code par WhatsApp
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              WhatsApp s'ouvre avec un message prérempli. Le gérant te renvoie un code à saisir ici.
            </p>
            <button type="button" onClick={() => { setStep('login'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-500">
              Retour à la connexion
            </button>
          </>
        )}

        {step === 'verify' && (
          <>
            <label className="mt-6 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Code temporaire à 4 chiffres</span>
              <input
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-orange-400"
              />
            </label>
            <button
              type="button"
              onClick={verifyCode}
              disabled={busy || recoveryCode.length !== 4}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-60"
            >
              <Check size={20} /> {busy ? 'Vérification…' : 'Vérifier le code'}
            </button>
            <button type="button" onClick={() => { sessionStorage.removeItem('recovery_flow'); setStep('forgot'); setRecoveryCode(''); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-500">
              Redemander un code
            </button>
          </>
        )}

        {step === 'new-pin' && (
          <>
            <label className="mt-6 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nouveau PIN (4 chiffres)</span>
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                type="password"
                autoComplete="new-password"
                maxLength={4}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-orange-400"
              />
            </label>
            <button
              type="button"
              onClick={completeRecovery}
              disabled={busy || pin.length !== 4}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-60"
            >
              <Check size={20} /> {busy ? 'Modification…' : 'Enregistrer le nouveau PIN'}
            </button>
          </>
        )}

        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
        {!host.root && step !== 'login' && step !== 'forgot' && step !== 'verify' && step !== 'new-pin' && (
          <p className="mt-3 text-center text-xs text-slate-500">Cette boutique se connecte avec son adresse dédiée.</p>
        )}
      </div>
    </div>
  );
}

function NavButton({ id, label, icon: Icon, active, onClick, center, badge }: {
  id: Tab; label: string; icon: typeof Home; active: boolean;
  onClick: (t: Tab) => void; center?: boolean; badge?: number;
}) {
  if (center) {
    return (
      <button
        type="button"
        onClick={() => onClick(id)}
        className="relative flex flex-col items-center gap-0.5 pb-1.5 pt-1 text-[11px] font-bold text-orange-600"
      >
        <span className={classNames(
          '-mt-5 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95',
          active ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-orange-500/40' : 'bg-gradient-to-br from-orange-400 to-orange-500 shadow-orange-400/30',
        )}>
          <Icon size={26} strokeWidth={2.4} />
        </span>
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={classNames('relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold transition', active ? 'text-orange-600' : 'text-slate-400 hover:text-slate-600')}
    >
      <span className="relative">
        <Icon size={22} strokeWidth={active ? 2.6 : 2} />
        {badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{badge}</span>
        )}
      </span>
      {label}
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-500" />}
    </button>
  );
}

interface HomeViewProps {
  online: boolean;
  loading: boolean;
  store: StoreInfo | null;
  products: Product[];
  productCount: number;
  categoryCount: number;
  cartCount: number;
  pendingCount: number;
  isBoss: boolean;
  onGo: (t: Tab) => void;
  onNewSale: () => void;
  onOpenHistory: (tab: HistoryTab) => void;
}

function HomeView({
  online, loading, store, products, productCount, categoryCount,
  cartCount, pendingCount, isBoss, onGo, onNewSale, onOpenHistory,
}: HomeViewProps) {
  // Premier chargement : squelette à la place de la page blanche. Dès que les
  // données sont prêtes (ou déjà en cache), on affiche le contenu réel.
  if (loading && productCount === 0) return <HomeSkeleton />;

  return (
    <div className="space-y-4 lg:grid lg:min-h-[calc(100vh-12rem)] lg:content-center lg:grid-cols-2 lg:gap-6 lg:space-y-0">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-500 to-amber-500 px-6 py-8 text-white shadow-lg lg:col-span-2 lg:py-12">
        <p className="text-sm font-semibold text-white/80"></p>
        <h2 className="text-3xl font-extrabold leading-tight">{store?.name ?? 'Quincaillerie'}</h2>
        <p className="mt-1 text-sm text-white/90">{store?.address}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onNewSale} className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-base font-extrabold text-orange-600 shadow transition hover:bg-orange-50 active:scale-95">
            <Plus size={22} /> Nouvelle vente
          </button>
          {cartCount > 0 && (
            <button type="button" onClick={() => onGo('sell')} className="flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-3 text-base font-bold text-white backdrop-blur transition hover:bg-white/30">
              <ShoppingCart size={20} /> Panier ({cartCount})
            </button>
          )}
        </div>
      </section>

      {/* Colonne 1 : raccourcis */}
      <div>
      <div className="grid grid-cols-2 gap-3">
        <Tile icon={ShoppingCart} title="Vendre" subtitle="Encaisser une vente" color="orange" onClick={() => onGo('sell')} />
        <Tile icon={History} title="Historique" subtitle="Ventes & stock" color="green" onClick={() => onOpenHistory('sales')} />
      </div>
      </div>

      {/* Colonne 2 : état du stock + accès Espace Boss */}
      <div className="space-y-4 lg:flex lg:flex-col lg:justify-center lg:gap-6 lg:space-y-0">
      {/* Légende des feux tricolores */}
      <section className="space-y-2 pt-1">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">État du stock</h2>
        <StockLegend products={products} storeId={store?.id ?? null} />
      </section>

      {/* Bannière Espace Boss — visible uniquement pour le boss, tout en bas */}
      {isBoss && (
        <button
          type="button"
          onClick={() => onGo('boss')}
          className="flex w-full items-center gap-3 rounded-3xl bg-gradient-to-r from-violet-500 to-purple-600 p-4 text-left text-white shadow-lg transition hover:opacity-95 active:scale-[0.99]"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Crown size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold">Espace Boss</span>
            <span className="block text-xs text-white/90">Caisse, employés, magasin </span>
          </span>
          <ArrowRight size={22} className="shrink-0" />
        </button>
      )}
      </div>
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import { colorOf } from '@/lib/colors';

function Tile({ icon: Icon, title, subtitle, color, onClick }: {
  icon: LucideIcon; title: string; subtitle: string; color: string; onClick: () => void;
}) {
  const c = colorOf(color);
  const iconBackground = color === 'orange' ? 'bg-[#f97316]' : c.bg;
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start gap-2 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-slate-300 active:scale-[0.98]">
      <span className={classNames('inline-flex rounded-xl p-2.5 text-white shadow-sm', iconBackground)}>
        <Icon size={24} />
      </span>
      <div>
        <p className="text-base font-extrabold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </button>
  );
}