import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Sale } from '@/types';
import { fetchSales } from '@/lib/supabase';
import { userMessage } from '@/lib/errors';
import { classNames, formatFCFA, vibrate } from '@/lib/format';
import { usePullToRefresh, PullToRefreshBar } from '@/lib/usePullToRefresh';
import { Skeleton } from '@/components/Skeleton';
import {
  Crown, Coins, Banknote, ShoppingCart, Users,
  ChevronRight,
} from 'lucide-react';

export type HistoryTab = 'sales' | 'stock';

type Period = 'today' | 'yesterday' | 'week' | 'month';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'yesterday', label: 'Hier' },
  { id: 'week', label: 'Cette semaine' },
  { id: 'month', label: 'Ce mois-ci' },
];

function periodRange(p: Period): { start: Date; end: Date } {
  const now = new Date();
  const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === 'today') {
    const s = day0(now); const e = new Date(s); e.setDate(e.getDate() + 1);
    return { start: s, end: e };
  }
  if (p === 'yesterday') {
    const e = day0(now); const s = new Date(e); s.setDate(s.getDate() - 1);
    return { start: s, end: e };
  }
  if (p === 'week') {
    const s = day0(now); const offset = (s.getDay() + 6) % 7; s.setDate(s.getDate() - offset);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    return { start: s, end: e };
  }
  const s = new Date(now.getFullYear(), now.getMonth(), 1);
  const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: s, end: e };
}

interface Props {
  supabaseOnline: boolean;
  onOpenEmployees: () => void;
}

export function BossPage({ supabaseOnline, onOpenEmployees }: Props) {
  const [period, setPeriod] = useState<Period>('today');
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseOnline) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setSales(await fetchSales(500));
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [supabaseOnline]);

  useEffect(() => { load(); }, [load]);

  // Actualisation par glissement du haut vers le bas (plus de bouton « Actualiser »).
  const pull = usePullToRefresh(load);

  const inRange = useMemo(() => {
    const { start, end } = periodRange(period);
    return sales.filter((s) => {
      if (s.status === 'cancelled' || s.cancelled_at) return false;
      const t = new Date(s.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
  }, [sales, period]);

  const salesTotal = inRange.reduce((sum, s) => sum + s.total, 0);
  const cashTotal = inRange.reduce((sum, s) => sum + s.amount_received, 0);
  const countTotal = inRange.length;

  return (
    <div className="space-y-4">
      <PullToRefreshBar distance={pull.distance} refreshing={pull.refreshing} />

      <div className="flex items-center gap-2">
        <Crown className="text-amber-500" size={26} />
        <h1 className="text-2xl font-extrabold text-slate-800">Espace Boss</h1>
      </div>

      {/* Filtres de période */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { vibrate(15); setPeriod(p.id); }}
            className={classNames(
              'rounded-xl px-1 py-2 text-[11px] font-bold leading-tight transition',
              period === p.id ? 'bg-white text-orange-600 shadow' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}

      {/* Indicateurs de vente */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi icon={Coins} color="bg-green-500" label="Ventes du jour" value={formatFCFA(salesTotal)} loading={loading} />
        <Kpi icon={Banknote} color="bg-blue-500" label="Argent encaissé" value={formatFCFA(cashTotal)} loading={loading} />
        <Kpi icon={ShoppingCart} color="bg-orange-500" label="Nombre de ventes" value={String(countTotal)} loading={loading} />
      </div>

      {!supabaseOnline && (
        <p className="rounded-2xl bg-yellow-50 p-3 text-sm font-semibold text-yellow-800 ring-1 ring-yellow-200">
          Les chiffres s'afficheront dès que la connexion au serveur reviendra.
        </p>
      )}

      {/* Navigation */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Gestion</h2>
        <NavCard icon={Users} title="Employés" subtitle="Inviter et gérer les accès" onClick={onOpenEmployees} />
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, color, label, value, loading }: {
  icon: typeof Coins; color: string; label: string; value: string; loading: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <span className={classNames('inline-flex rounded-xl p-2 text-white shadow-sm', color)}>
        <Icon size={20} />
      </span>
      <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <p className="mt-0.5 text-xl font-extrabold text-slate-800">{value}</p>
      )}
    </div>
  );
}

function NavCard({ icon: Icon, title, subtitle, onClick, disabled }: {
  icon: typeof Users; title: string; subtitle: string; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={classNames(
        'flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200 transition',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:ring-slate-300 active:scale-[0.99]',
      )}
    >
      <span className={classNames('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm', disabled ? 'bg-slate-400' : 'bg-violet-500')}>
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-extrabold text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{subtitle}</span>
      </span>
      {!disabled && <ChevronRight className="shrink-0 text-slate-300" size={20} />}
    </button>
  );
}
