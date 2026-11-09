import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Sale, StockMovement } from '@/types';
import {
  fetchSales, fetchSaleWithItems, fetchStockMovements, cancelSale, type Actor,
} from '@/lib/supabase';
import { classNames, formatFCFA, formatQty, formatDateTime } from '@/lib/format';
import { userMessage } from '@/lib/errors';
import { usePullToRefresh, PullToRefreshBar } from '@/lib/usePullToRefresh';
import { SaleDetailSheet } from '@/components/SaleDetailSheet';
import { SkeletonRow } from '@/components/Skeleton';
import {
  Check, X, Eye, EyeOff, ChevronRight, FileText, Wrench,
  ArrowDownCircle, ArrowUpCircle, RotateCcw, ShoppingCart, History,
} from 'lucide-react';

type TabId = 'sales' | 'stock';

interface Props {
  supabaseOnline: boolean;
  isGerant: boolean;
  actor: Actor;
  userName: string;
  /** Tirer vers le bas : synchronise les opérations en attente puis recharge. */
  onRefresh?: () => void | Promise<void>;
}

const REASON_META: Record<string, { label: string; icon: typeof ArrowDownCircle; color: string }> = {
  arrival:      { label: 'Arrivage de stock',   icon: ArrowDownCircle, color: 'text-green-700 bg-green-100' },
  sale:         { label: 'Vente',               icon: ShoppingCart,    color: 'text-blue-700 bg-blue-100' },
  cancellation: { label: 'Annulation',          icon: RotateCcw,       color: 'text-red-700 bg-red-100' },
  adjustment:   { label: 'Modification de stock', icon: ArrowUpCircle, color: 'text-amber-700 bg-amber-100' },
};

export function HistoryPage({ supabaseOnline, isGerant, actor, userName, onRefresh }: Props) {
  /** null = aucune sélection : toute l'activité est affichée, du plus récent au plus ancien. */
  const [tab, setTab] = useState<TabId | null>(null);
  const [hideAmounts, setHideAmounts] = useState(false);

  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openSale, setOpenSale] = useState<Sale | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseOnline) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [s, m] = await Promise.all([
        fetchSales(100), fetchStockMovements(undefined, 200),
      ]);
      setSales(s); setMovements(m);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [supabaseOnline]);

  useEffect(() => { load(); }, [load]);

  const pull = usePullToRefresh(async () => {
    await onRefresh?.();
    await load();
  });

  const fmt = (n: number) => (hideAmounts ? '•••• F' : formatFCFA(n));
  const totalRevenue = useMemo(() => sales.filter((s) => s.status !== 'cancelled').reduce((s, x) => s + x.amount_received, 0), [sales]);

  /** « Modifications Stock » : uniquement arrivages et modifications de produits (jamais les ventes). */
  const stockMovements = useMemo(
    () => movements.filter((m) => m.reason === 'arrival' || m.reason === 'adjustment'),
    [movements],
  );

  /** Vue par défaut : ventes et mouvements de stock, du plus récent au plus ancien. */
  const feed = useMemo(() => {
    const items: Array<
      | { kind: 'sale'; at: string; sale: Sale }
      | { kind: 'stock'; at: string; movement: StockMovement }
    > = [];
    for (const s of sales) items.push({ kind: 'sale', at: s.created_at, sale: s });
    for (const m of stockMovements) items.push({ kind: 'stock', at: m.created_at, movement: m });
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [sales, stockMovements]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setOpenSale(sales.find((s) => s.id === id) ?? null);
    try {
      const full = await fetchSaleWithItems(id);
      if (full) setOpenSale(full);
    } catch { /* garde l'en-tête */ }
  }

  async function handleCancel(saleId: string, reason: string) {
    const res = await cancelSale(saleId, reason || null, userName, actor);
    if (!res.ok) return { ok: false, error: userMessage(res.error) };
    await load();
    return { ok: true };
  }

  /** Libellé produit d'une vente : nom du produit (ou « +N » si plusieurs articles). */
  function productLabel(s: Sale): string {
    const items = s.sale_items ?? [];
    if (items.length === 0) return 'Vente';
    if (items.length === 1) return items[0].product_name;
    return `${items[0].product_name} +${items.length - 1}`;
  }

  function renderSale(s: Sale) {
    const cancelled = s.status === 'cancelled' || !!s.cancelled_at;
    return (
      <li key={s.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <button type="button" onClick={() => openDetail(s.id)} className="flex w-full items-center gap-3 p-3 text-left">
          <span className={classNames('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            cancelled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
            {cancelled ? <X size={20} /> : <Check size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-slate-800">{cancelled ? 'Vente annulée' : 'Vente effectuée'}</p>
            <p className="truncate text-sm font-semibold text-slate-700">{productLabel(s)}</p>
            <p className="text-xs text-slate-500">{formatDateTime(s.created_at)}</p>
            {s.customer_name && <p className="text-xs text-slate-600">Client : {s.customer_name}</p>}
          </div>
          <div className="text-right">
            <p className={classNames('text-sm font-extrabold', cancelled ? 'text-slate-400 line-through' : 'text-slate-900')}>{fmt(s.total)}</p>
          </div>
          <ChevronRight className="shrink-0 text-slate-300" size={18} />
        </button>
        <div className="border-t border-slate-100 px-3 py-2">
          <p className="truncate text-sm italic text-slate-800">Effectué par {s.created_by ?? 'Inconnu'}</p>
        </div>
      </li>
    );
  }

  function renderMovement(m: StockMovement) {
    const meta = REASON_META[m.reason] ?? REASON_META.adjustment;
    const Icon = meta.icon;
    const positive = m.delta >= 0;
    return (
      <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <span className={classNames('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', meta.color)}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-800">{meta.label}</p>
          <p className="truncate text-sm font-semibold text-slate-700">{m.product?.name ?? 'Produit'}</p>
          <p className="text-xs text-slate-500">
            {formatDateTime(m.created_at)}
            {m.note ? ` · ${m.note}` : ''}
          </p>
          <p className="truncate text-sm italic text-slate-800">Effectué par {m.created_by ?? 'Inconnu'}</p>
        </div>
        <p className={classNames('shrink-0 text-sm font-extrabold', positive ? 'text-green-700' : 'text-blue-700')}>
          {positive ? '+' : ''}{formatQty(m.delta)}
        </p>
      </li>
    );
  }

  if (!supabaseOnline) {
    return (
      <div className="space-y-4">
        <PullToRefreshBar distance={pull.distance} refreshing={pull.refreshing} />
        <h1 className="text-2xl font-extrabold text-slate-800">Historique</h1>
        <div className="rounded-2xl bg-yellow-50 p-4 text-sm font-semibold text-yellow-800 ring-1 ring-yellow-200">
          La connexion au serveur est nécessaire pour afficher les ventes et les modifications de stock.
        </div>
      </div>
    );
  }

  const TABS: Array<{ id: TabId; label: string; icon: typeof FileText; active: string; idle: string }> = [
    {
      id: 'sales', label: 'Ventes effectuées', icon: FileText,
      active: 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-500/30',
      idle: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100',
    },
    {
      id: 'stock', label: 'Modifications Stock', icon: Wrench,
      active: 'bg-violet-500 border-violet-500 text-white shadow-lg shadow-violet-500/30',
      idle: 'bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100',
    },
  ];

  return (
    <div className="space-y-4">
      <PullToRefreshBar distance={pull.distance} refreshing={pull.refreshing} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">Historique</h1>
        <button type="button" onClick={() => setHideAmounts((v) => !v)} className="rounded-xl bg-slate-100 p-2.5 text-slate-600" aria-label="Masquer montants">
          {hideAmounts ? <EyeOff size={0} /> : <Eye size={0} />}
        </button>
      </div>

      {/* Filtres : re-cliquer retire le filtre */}
      <div className="grid grid-cols-2 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab((current) => (current === t.id ? null : t.id))}
              className={classNames(
                'flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-sm font-extrabold leading-tight transition active:scale-95',
                active ? classNames(t.active, 'scale-[1.03]') : t.idle,
              )}
            >
              <Icon size={24} strokeWidth={2.6} />
              <span className="text-center">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'sales' && (
        <p className="text-sm text-slate-500">{sales.length} vente(s) · Encaissé : {fmt(totalRevenue)}</p>
      )}
      {tab === 'stock' && (
        <p className="text-sm text-slate-500">{stockMovements.length} mouvement(s) enregistré(s).</p>
      )}

      {loading && (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => <li key={i}><SkeletonRow /></li>)}
        </ul>
      )}
      {error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}

      {/* Vue par défaut : toutes les catégories, du plus récent au plus ancien */}
      {!loading && tab === null && (
        feed.length === 0 ? (
          <Empty icon={History} text="Aucune activité enregistrée pour le moment." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {feed.map((item) =>
              item.kind === 'sale' ? renderSale(item.sale)
                : renderMovement(item.movement),
            )}
          </ul>
        )
      )}

      {/* Filtre 1 : Ventes effectuées */}
      {!loading && tab === 'sales' && (
        sales.length === 0 ? (
          <Empty icon={FileText} text="Aucune vente pour le moment." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{sales.map(renderSale)}</ul>
        )
      )}

      {/* Modifications Stock (arrivages & modifications de produits) */}
      {!loading && tab === 'stock' && (
        stockMovements.length === 0 ? (
          <Empty icon={History} text="Aucune modification de stock enregistrée." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{stockMovements.map(renderMovement)}</ul>
        )
      )}

      <SaleDetailSheet
        open={detailOpen}
        sale={openSale}
        onClose={() => setDetailOpen(false)}
        onCancel={handleCancel}
        isGerant={isGerant}
        onRefresh={load}
      />
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center text-slate-500 ring-1 ring-slate-100">
      <Icon className="mx-auto mb-2 text-slate-300" size={32} />
      {text}
    </div>
  );
}
