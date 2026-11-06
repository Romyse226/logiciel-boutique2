import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Home, ShoppingCart, History, Crown, Plus, Store as StoreIcon,
  Check, ArrowRight, Delete, MessageCircle,
} from 'lucide-react';
import { classNames, formatFCFA, vibrate, normalizeCIphone } from '@/lib/format';
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
  isSupabaseConfigured, pingSupabase, saveProduct, isProductArchived, ensureOwner, resetOwnerSecret, employeeState, acceptInvite,
  uploadProductImage, deleteProductImage, type Actor,
} from '@/lib/supabase';
import type { Product, ProductCategory, ProductSaleUnit, StoreInfo, Sale, ProductInput } from '@/types';

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

export default function App() {
  const {
    profile, identityReady, isGerant, canEditCatalog, canAddProducts,
    markIdentityReady, applyOwner, applyEmployee, applyRemoteState, completeOnboarding,
  } = useUser();
  const offline = useOfflineSync();
  const { notify } = useToast();

  const [tab, setTab] = useState<Tab>('home');
  const [bossScreen, setBossScreen] = useState<BossScreen>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [store, setStore] = useState<StoreInfo | null>(DEMO_STORE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(isSupabaseConfigured);
  /** Nom du boss qui a retiré l'accès : non nul = écran de blocage total (aucune navigation). */
  const [suspendedBy, setSuspendedBy] = useState<string | null>(null);

  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Le serveur a répondu que cet appareil n'est pas (ou plus) celui du patron. */
  const [ownerBlocked, setOwnerBlocked] = useState(false);
  /** Le patron de cet appareil n'a pas encore défini son code secret (base migrée). */
  const [ownerNeedsSecret, setOwnerNeedsSecret] = useState(false);

  const cart = useCart();
  const sellerName = profile.name || (isGerant ? 'Boss' : 'Employé');
  const actor: Actor = useMemo(() => ({ id: profile.employeeId, token: profile.accessToken }), [profile.employeeId, profile.accessToken]);

  /**
   * Identité serveur au moment d'écrire.
   * `ensure_owner` n'est appelé qu'une fois au démarrage : s'il échoue (ouverture
   * hors-ligne, réseau lent), l'appareil restait sans identité et TOUTE écriture
   * était refusée ensuite. On la redemande donc ici, à la demande.
   */
  const resolveActor = useCallback(async (): Promise<{ actor: Actor | null; error: string | null }> => {
    if (actor.id && actor.token) return { actor, error: null };
    if (!isSupabaseConfigured) {
      return { actor: null, error: 'Connexion au serveur impossible. Vérifie ton réseau.' };
    }
    if (!profile.isOwner) {
      return { actor: null, error: 'Appareil non identifié : reconnecte ton accès employé.' };
    }
    try {
      const o = await ensureOwner(profile.deviceToken, profile.name, profile.phone);
      if (o.ok && o.is_owner && o.employee_id && o.token) {
        applyOwner({ employeeId: o.employee_id, name: o.name ?? profile.name, accessToken: o.token });
        return { actor: { id: o.employee_id, token: o.token }, error: null };
      }
      if (o.ok && o.is_owner === false) {
        // Nom + téléphone ne suffisent pas : on demande le CODE SECRET.
        setOwnerBlocked(true);
        return { actor: null, error: 'Cet appareil n’est pas reconnu comme le gérant du commerce. Saisis ton code secret.' };
      }
      return { actor: null, error: o.error ?? 'Impossible de confirmer ton identité.' };
    } catch {
      return { actor: null, error: 'Connexion au serveur impossible. Vérifie ton réseau.' };
    }
  }, [actor, profile.isOwner, profile.deviceToken, profile.name, profile.phone, applyOwner]);

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
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

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
    if (profile.isOwner || !profile.employeeId || !profile.accessToken) return;
    try {
      const st = await employeeState({ id: profile.employeeId, token: profile.accessToken });
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
  }, [profile.isOwner, profile.employeeId, profile.accessToken, applyRemoteState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const invite = params.get('invite');

        if (invite && isSupabaseConfigured) {
          const res = await acceptInvite(invite);
          if (res.ok && res.employee_id && res.token) {
            applyEmployee({
              employeeId: res.employee_id,
              name: res.name ?? 'Employé',
              accessToken: res.token,
              canEditCatalog: !!res.can_edit_catalog,
              canAddProducts: !!res.can_add_products,
            });
            params.delete('invite');
            const qs = params.toString();
            window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
            notify('Bienvenue ! Ton accès employé est activé.');
            if (!cancelled) markIdentityReady();
            return;
          }
        }

        if (!isSupabaseConfigured) { if (!cancelled) markIdentityReady(); return; }

        // Employé déjà identifié : on vérifie son état côté serveur.
        if (!profile.isOwner && profile.employeeId && profile.accessToken) {
          await verifyEmployeeAccess();
          if (!cancelled) markIdentityReady();
          return;
        }

        // Appareil du boss : (re)réclame la propriété (une fois le profil
        // renseigné à l'inscription). L'appel est fait même si un identifiant
        // est déjà mémorisé : `ensure_owner` est idempotent pour le même jeton
        // d'appareil et recrée l'identité si sa ligne a disparu côté base.
        // Sans cela, l'appareil conserverait un identifiant périmé et le
        // serveur refuserait toute vente (contrôle d'accès de `register_sale`).
        if (profile.isOwner && profile.onboarded) {
          const o = await ensureOwner(profile.deviceToken, profile.name, profile.phone);
          if (o.ok && o.is_owner && o.employee_id && o.token) {
            applyOwner({ employeeId: o.employee_id, name: o.name ?? profile.name, accessToken: o.token });
            // Base migrée : le patron n'a pas encore de code secret personnel.
            // On lui demande d'en choisir un (une seule fois).
            if (o.needs_secret && !cancelled) setOwnerNeedsSecret(true);
          } else if (o.ok && o.is_owner === false) {
            // Le patron existe sur un autre appareil (jeton d'appareil perdu ou
            // autre navigateur) : on demande le code secret pour le rattacher.
            if (!cancelled) setOwnerBlocked(true);
          }
        }
      } catch {
        /* hors-ligne : on conserve l'identité locale */
      } finally {
        if (!cancelled) markIdentityReady();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retrait d'accès : on revérifie à chaque reconnexion et au retour sur l'app,
  // pour que le blocage soit effectif même sans rechargement de la page.
  useEffect(() => {
    if (profile.isOwner || !profile.employeeId || !profile.accessToken) return;
    const recheck = () => { void verifyEmployeeAccess(); };
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile.isOwner, profile.employeeId, profile.accessToken, verifyEmployeeAccess]);

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

  async function handleConfirmPayment(result: PaymentResult) {
    if (processing) return;
    setProcessing(true);
    setPayError(null);
    try {
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
        amountReceived: result.status === 'paid' ? null : result.amountReceived,
        customerName: result.customerName,
        customerPhone: result.customerPhone,
        createdBy: sellerName,
        actorId: actor.id,
        actorToken: actor.token,
      };

      if (!offline.online || !isSupabaseConfigured) {
        offline.enqueue({ type: 'sale', payload });
        setProcessing(false);
        setPayOpen(false);
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
          setProcessing(false);
          setPayOpen(false);
          cart.clear();
          notify('Connexion perdue : vente enregistrée hors-ligne. Elle sera envoyée au retour du réseau.');
          openHistory('sales');
          return;
        }
        setPayError(userMessage(res.error));
        setProcessing(false);
        return;
      }
      // La vente est enregistrée côté serveur (`res.ok === true`). La relecture
      // détaillée (articles, paiements) ne doit JAMAIS transformer une vente
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
        balance_due: res.balance_due,
        status: res.status,
        customer_name: result.customerName ?? null,
        customer_phone: result.customerPhone ?? null,
        note: null,
        created_at: new Date().toISOString(),
        created_by: sellerName,
        cancelled_at: null,
        cancelled_by: null,
        cancel_reason: null,
        sale_items: [],
        sale_payments: [],
      });
      cart.clear();
      setPayOpen(false);
      setReceiptOpen(true);
      setProcessing(false);
      loadAll();
    } catch (e) {
      setPayError(userMessage(e));
      setProcessing(false);
    }
  }

  function startNewSale() {
    setReceiptOpen(false);
    setLastSale(null);
    setCartOpen(false);
    setPayOpen(false);
    go('sell');
  }

  /**
   * Inscription / reconnaissance du patron.
   * `secret` est le CODE SECRET personnel du patron : seul élément accepté par
   * le serveur pour rattacher un appareil. Renvoie un message d'erreur, ou null.
   */
  async function handleOnboarding(name: string, phone: string | null, secret: string): Promise<string | null> {
    completeOnboarding(name, phone);
    if (!isSupabaseConfigured) return null;
    try {
      const o = await ensureOwner(profile.deviceToken, name, phone, secret);
      if (o.ok && o.is_owner && o.employee_id && o.token) {
        applyOwner({ employeeId: o.employee_id, name: o.name ?? name, accessToken: o.token });
        setOwnerBlocked(false);
        setOwnerNeedsSecret(false);
        return null;
      }
      if (o.ok && o.is_owner === false) {
        setOwnerBlocked(true);
        return secret
          ? 'Code secret incorrect. Vérifie-le, puis réessaie.'
          : 'Saisis ton code secret.';
      }
      return o.error ?? 'Impossible de confirmer ton identité.';
    } catch {
      return 'Connexion au serveur impossible. Vérifie ton réseau.';
    }
  }

  /**
   * « Code oublié » : le patron saisit le code temporaire communiqué par le
   * gérant, puis choisit son nouveau code secret. Le code temporaire est
   * aussitôt invalidé côté serveur.
   */
  async function handleResetSecret(tempCode: string, newSecret: string): Promise<string | null> {
    if (!isSupabaseConfigured) return 'Connexion au serveur impossible. Vérifie ton réseau.';
    try {
      const o = await resetOwnerSecret(profile.deviceToken, tempCode, newSecret);
      if (o.ok && o.is_owner && o.employee_id && o.token) {
        completeOnboarding(o.name ?? profile.name, profile.phone);
        applyOwner({ employeeId: o.employee_id, name: o.name ?? profile.name, accessToken: o.token });
        setOwnerBlocked(false);
        setOwnerNeedsSecret(false);
        return null;
      }
      return o.error ?? 'Réinitialisation impossible.';
    } catch {
      return 'Connexion au serveur impossible. Vérifie ton réseau.';
    }
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

  // Accès retiré par le boss : écran blanc total, aucune navigation.
  if (suspendedBy !== null) {
    return <SuspendedScreen bossName={suspendedBy} />;
  }

  // Employé dont l'identité n'est pas encore confirmée par le serveur : on
  // n'affiche JAMAIS l'interface normale (ni les données) avant la vérification.
  const isEmployee = !profile.isOwner && !!profile.employeeId && !!profile.accessToken;
  if (isEmployee && !identityReady) {
    return <AccessCheckScreen />;
  }

  // Appareil du patron non reconnu par le serveur (jeton d'appareil perdu,
  // autre navigateur, autre origine) : on le rattache avec le CODE SECRET.
  // Le nom et le numéro, à eux seuls, ne donnent aucun droit.
  if (profile.isOwner && ownerBlocked) {
    return (
      <OnboardingPage
        recovery
        storeName={store?.name ?? 'Quincaillerie'}
        initialName={profile.name && profile.name !== 'Boss' ? profile.name : ''}
        initialPhone={profile.phone}
        onSubmit={handleOnboarding}
        onReset={handleResetSecret}
      />
    );
  }

  // Patron reconnu sur cet appareil mais sans code secret défini (base migrée
  // depuis l'ancien « code patron ») : on lui demande d'en choisir un.
  if (profile.isOwner && ownerNeedsSecret) {
    return (
      <OnboardingPage
        setSecretOnly
        storeName={store?.name ?? 'Quincaillerie'}
        initialName={profile.name && profile.name !== 'Boss' ? profile.name : ''}
        initialPhone={profile.phone}
        onSubmit={handleOnboarding}
      />
    );
  }

  // Toute première page : le boss enregistre sa quincaillerie (nom + téléphone
  // + son code secret personnel).
  if (profile.isOwner && !profile.onboarded) {
    return (
      <OnboardingPage
        storeName={store?.name ?? 'Quincaillerie'}
        initialName={profile.name && profile.name !== 'Boss' ? profile.name : ''}
        initialPhone={profile.phone}
        onSubmit={handleOnboarding}
        onReset={handleResetSecret}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:max-w-6xl lg:px-6 2xl:max-w-7xl">
          <button type="button" onClick={() => go('home')} className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow">
              <StoreIcon size={20} />
            </span>
            <div className="min-w-0 text-left">
              <h1 className="truncate text-base font-extrabold text-slate-800">{store?.name ?? 'Quincaillerie'}</h1>
              <p className="truncate text-[11px] text-slate-500">{sellerName} · Côte d'Ivoire</p>
            </div>
          </button>
          <SupabaseStatus compact />
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
            />
          )
        ) : null}
      </main>

      {tab === 'sell' && cartCount > 0 && !cartOpen && !payOpen && !receiptOpen && (
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
        onClose={() => setCartOpen(false)}
        onSetQty={cart.setQuantity}
        onRemove={cart.remove}
        onCheckout={() => { setCartOpen(false); setPayOpen(true); }}
        onContinueShopping={() => setCartOpen(false)}
      />
      <PaymentSheet
        open={payOpen}
        lines={cart.lines}
        total={cart.total}
        processing={processing}
        error={payError}
        onClose={() => setPayOpen(false)}
        onBack={() => { setPayOpen(false); setCartOpen(true); }}
        onConfirm={handleConfirmPayment}
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

/** Pavé numérique de saisie d'un code secret (style déverrouillage de téléphone). */
function PinPad({ onDigit, onBackspace, disabled = false }: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const key = 'h-16 rounded-2xl bg-slate-50 text-2xl font-extrabold text-slate-800 ring-1 ring-slate-200 transition active:scale-95 active:bg-orange-100 disabled:opacity-50';
  return (
    <div className="grid grid-cols-3 gap-3">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" disabled={disabled}
          onClick={() => { vibrate(10); onDigit(d); }} className={key}>
          {d}
        </button>
      ))}
      <button type="button" disabled={disabled} aria-label="Effacer un chiffre"
        onClick={() => { vibrate(10); onBackspace(); }}
        className="flex h-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 transition active:scale-95 active:bg-orange-100 disabled:opacity-50">
        <Delete size={24} />
      </button>
      <button type="button" disabled={disabled}
        onClick={() => { vibrate(10); onDigit('0'); }} className={key}>
        0
      </button>
      <span aria-hidden />
    </div>
  );
}

/** Points affichant le nombre de chiffres saisis (le code reste masqué). */
function PinDots({ count }: { count: number }) {
  const shown = Math.max(6, count);
  return (
    <div className="flex items-center justify-center gap-2.5 py-1" role="status" aria-label={`${count} chiffre(s) saisi(s)`}>
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className={classNames('h-3.5 w-3.5 rounded-full transition', i < count ? 'bg-orange-500' : 'bg-slate-200')} />
      ))}
    </div>
  );
}

/** Première page : le boss enregistre sa quincaillerie et son code secret personnel. */
function OnboardingPage({
  onSubmit, onReset, recovery = false, setSecretOnly = false,
  initialName = '', initialPhone = null, storeName,
}: {
  onSubmit: (name: string, phone: string | null, secret: string) => Promise<string | null>;
  /** « Code oublié » : échange un code temporaire contre un nouveau code secret. */
  onReset?: (tempCode: string, newSecret: string) => Promise<string | null>;
  /** Écran de rattachement d'un appareil patron qui n'est plus reconnu. */
  recovery?: boolean;
  /** Appareil déjà reconnu : on ne demande que le choix du code secret. */
  setSecretOnly?: boolean;
  initialName?: string;
  initialPhone?: string | null;
  storeName: string;
}) {
  type Step = 'form' | 'forgot' | 'temp' | 'new';
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [secret, setSecret] = useState('');
  const [tempCode, setTempCode] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canReset = !setSecretOnly && !!onReset;

  function openWhatsapp() {
    const text = encodeURIComponent(`Bonjour, j'ai oublié mon code secret pour ma quincaillerie ${storeName}.`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  async function submitSecret() {
    if (busy) return;
    if (!setSecretOnly && !name.trim()) { setError('Renseigne ton nom.'); return; }
    if (secret.length < 4) { setError('Choisis un code secret d’au moins 4 chiffres.'); return; }
    setBusy(true);
    setError(null);
    // Mode « définir le code » : l'appareil est déjà reconnu, on n'écrase pas
    // le nom / téléphone existants (chaîne vide = le serveur les conserve).
    const cleanName = setSecretOnly ? '' : name.trim();
    const cleanPhone = setSecretOnly
      ? (initialPhone ?? null)
      : (phone.trim() ? normalizeCIphone(phone.trim()) : null);
    const message = await onSubmit(cleanName, cleanPhone, secret);
    setBusy(false);
    if (message) { setError(message); setSecret(''); vibrate([30, 60, 30]); }
  }

  function goToNewSecret() {
    if (tempCode.length < 4) { setError('Saisis le code temporaire reçu.'); return; }
    setError(null);
    setStep('new');
  }

  async function submitReset() {
    if (busy || !onReset) return;
    if (newSecret.length < 4) { setError('Choisis un nouveau code d’au moins 4 chiffres.'); return; }
    setBusy(true);
    setError(null);
    const message = await onReset(tempCode, newSecret);
    setBusy(false);
    if (message) { setError(message); setNewSecret(''); setStep('temp'); vibrate([30, 60, 30]); }
  }

  const title =
    step === 'forgot' ? 'Code oublié'
      : step === 'temp' ? 'Code temporaire'
        : step === 'new' ? 'Nouveau code secret'
          : recovery ? 'Reconnaître cet appareil'
            : setSecretOnly ? 'Choisis ton code secret' : 'Bienvenue !';

  const subtitle =
    step === 'forgot' ? 'Écris-nous sur WhatsApp pour recevoir un code temporaire.'
      : step === 'temp' ? 'Saisis le code temporaire communiqué par ton gérant.'
        : step === 'new' ? 'Choisis maintenant ton nouveau code secret.'
          : recovery ? 'Ce téléphone n’est pas encore rattaché au patron du commerce.'
            : setSecretOnly ? 'Pour sécuriser l’accès à ta quincaillerie.'
              : 'Enregistre tes infos et choisis ton code secret.';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-orange-500 via-orange-500 to-amber-500 px-5 py-8">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow">
          <StoreIcon size={32} />
        </span>
        <h1 className="mt-4 text-center text-2xl font-extrabold text-slate-800">{title}</h1>
        <p className="mt-1 text-center text-sm text-slate-500">{subtitle}</p>

        {step === 'form' && (
          <>
            {!setSecretOnly && (
              <>
                <label className="mt-6 block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Ton nom</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex : Mohamed"
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Numéro de téléphone</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="Ex : 07 00 00 00 00"
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                  />
                </label>
              </>
            )}
            <p className={classNames('mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500', setSecretOnly ? 'mt-6' : 'mt-4')}>
              {recovery ? 'Ton code secret' : 'Choisis ton code secret'}
            </p>
            <PinDots count={secret.length} />
            <div className="mt-3">
              <PinPad
                disabled={busy}
                onDigit={(d) => setSecret((v) => (v + d).slice(0, 10))}
                onBackspace={() => setSecret((v) => v.slice(0, -1))}
              />
            </div>
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
            <button
              type="button"
              onClick={submitSecret}
              disabled={busy || secret.length < 4}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
            >
              <Check size={20} /> {busy ? 'Vérification…' : recovery ? 'Rattacher cet appareil' : setSecretOnly ? 'Enregistrer mon code' : 'Créer mon code secret'}
            </button>
            {canReset && (
              <button
                type="button"
                onClick={() => { setStep('forgot'); setError(null); }}
                className="mt-3 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
              >
                Code oublié ?
              </button>
            )}
          </>
        )}

        {step === 'forgot' && (
          <>
            <button
              type="button"
              onClick={openWhatsapp}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-green-500 px-4 py-3.5 text-base font-bold text-white shadow transition hover:bg-green-600 active:scale-[0.99]"
            >
              <MessageCircle size={20} /> Contacter sur WhatsApp
            </button>
            <button
              type="button"
              onClick={() => { setStep('temp'); setError(null); }}
              className="mt-3 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
            >
              J’ai reçu un code temporaire
            </button>
            <button type="button" onClick={() => { setStep('form'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-400">
              Retour
            </button>
          </>
        )}

        {step === 'temp' && (
          <>
            <p className="mb-1 mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Code temporaire</p>
            <PinDots count={tempCode.length} />
            <div className="mt-3">
              <PinPad
                disabled={busy}
                onDigit={(d) => setTempCode((v) => (v + d).slice(0, 10))}
                onBackspace={() => setTempCode((v) => v.slice(0, -1))}
              />
            </div>
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
            <button
              type="button"
              onClick={goToNewSecret}
              disabled={tempCode.length < 4}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
            >
              Suivant
            </button>
            <button type="button" onClick={() => { setStep('forgot'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-400">
              Retour
            </button>
          </>
        )}

        {step === 'new' && (
          <>
            <p className="mb-1 mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Nouveau code secret</p>
            <PinDots count={newSecret.length} />
            <div className="mt-3">
              <PinPad
                disabled={busy}
                onDigit={(d) => setNewSecret((v) => (v + d).slice(0, 10))}
                onBackspace={() => setNewSecret((v) => v.slice(0, -1))}
              />
            </div>
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
            <button
              type="button"
              onClick={submitReset}
              disabled={busy || newSecret.length < 4}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
            >
              <Check size={20} /> {busy ? 'Enregistrement…' : 'Enregistrer mon nouveau code'}
            </button>
            <button type="button" onClick={() => { setStep('temp'); setError(null); }} className="mt-3 w-full text-center text-sm font-semibold text-slate-400">
              Retour
            </button>
          </>
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
      {/* Colonne 1 (mobile : simplement empilée) : en-tête boutique + raccourcis */}
      <div className="space-y-4 lg:flex lg:flex-col lg:justify-center lg:gap-6 lg:space-y-0">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-500 to-amber-500 p-6 text-white shadow-lg">
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

      <div className="grid grid-cols-2 gap-3">
        <Tile icon={ShoppingCart} title="Vendre" subtitle="Encaisser une vente" color="orange" onClick={() => onGo('sell')} />
        <Tile icon={History} title="Historique" subtitle="Ventes, crédits & stock" color="green" onClick={() => onOpenHistory('sales')} />
      </div>
      </div>

      {/* Colonne 2 : état du stock + accès Espace Boss */}
      <div className="space-y-4 lg:flex lg:flex-col lg:justify-center lg:gap-6 lg:space-y-0">
      {/* Légende des feux tricolores */}
      <section className="space-y-2 pt-1">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">État du stock</h2>
        <StockLegend products={products} />
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
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start gap-2 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-slate-300 active:scale-[0.98]">
      <span className={classNames('inline-flex rounded-xl p-2.5 text-white shadow-sm', c.bg)}>
        <Icon size={24} />
      </span>
      <div>
        <p className="text-base font-extrabold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </button>
  );
}
