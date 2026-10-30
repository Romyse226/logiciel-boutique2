import { useEffect, useMemo, useState } from 'react';
import type { Sale, SalePayment } from '@/types';
import { classNames, formatFCFA, formatDateTime } from '@/lib/format';
import { X, Check, AlertTriangle, Loader2, Wallet, Plus } from 'lucide-react';

interface Props {
  open: boolean;
  sale: Sale | null;
  onClose: () => void;
  onPay: (saleId: string, amount: number, note: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: (saleId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  isGerant: boolean;
  onRefresh?: () => void;
}

export function SaleDetailSheet({ open, sale, onClose, onPay, onCancel, isGerant, onRefresh }: Props) {
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [loadingPay, setLoadingPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && sale) {
      setPayments(sale.sale_payments ?? []);
      setPayAmount(''); setPayNote(''); setError(null); setShowCancel(false); setCancelReason('');
    }
  }, [open, sale]);

  const isCancelled = sale?.status === 'cancelled' || !!sale?.cancelled_at;
  const balance = sale?.balance_due ?? 0;

  const whatsappUrl = useMemo(() => {
    if (!sale) return '';
    const lines: string[] = [];
    lines.push(`Reçu: ${sale.reference}`);
    lines.push(`Date: ${formatDateTime(sale.created_at)}`);
    if (sale.customer_name) lines.push(`Client: ${sale.customer_name}`);
    lines.push('---');
    for (const it of sale.sale_items ?? []) {
      lines.push(`- ${it.product_name}: ${it.quantity} ${it.unit} × ${formatFCFA(it.unit_price)} = ${formatFCFA(it.line_total)}`);
    }
    lines.push('---');
    lines.push(`Total: ${formatFCFA(sale.total)}`);
    lines.push(`Reçu: ${formatFCFA(sale.amount_received)}`);
    lines.push(`Reste dû: ${formatFCFA(sale.balance_due)}`);
    const text = encodeURIComponent(lines.join('\n'));
    const phone = sale.customer_phone ? sale.customer_phone.replace(/\D/g, '') : '';
    return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  }, [sale]);

  if (!open || !sale) return null;

  async function handlePay() {
    if (!sale || paying) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { setError('Montant invalide'); return; }
    setPaying(true); setError(null);
    try {
      const res = await onPay(sale.id, amount, payNote.trim());
      if (!res.ok) { setError(res.error ?? 'Échec'); setPaying(false); return; }
      setPaying(false); setPayAmount(''); setPayNote('');
      onRefresh?.();
      onClose();
    } catch (e) {
      setError((e as Error).message); setPaying(false);
    }
  }

  async function handleCancel() {
    if (!sale || cancelling) return;
    setCancelling(true); setError(null);
    try {
      const res = await onCancel(sale.id, cancelReason.trim());
      if (!res.ok) { setError(res.error ?? 'Échec'); setCancelling(false); return; }
      setCancelling(false);
      onRefresh?.();
      onClose();
    } catch (e) {
      setError((e as Error).message); setCancelling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={classNames('flex h-8 w-8 items-center justify-center rounded-full',
              isCancelled ? 'bg-red-100 text-red-700' : sale.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>
              {isCancelled ? <X size={16} /> : sale.status === 'paid' ? <Check size={16} /> : <AlertTriangle size={16} />}
            </span>
            <h2 className="text-base font-extrabold text-slate-800">{sale.reference}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <p className="text-xs text-slate-500">{formatDateTime(sale.created_at)}</p>
            {sale.customer_name && <p className="text-sm font-bold text-slate-800">Client: {sale.customer_name}</p>}
            {sale.customer_phone && <p className="text-xs text-slate-600">{sale.customer_phone}</p>}
            {sale.created_by && <p className="text-xs text-slate-400">Vendeur: {sale.created_by}</p>}
            {isCancelled && (
              <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                Vente annulée{sale.cancelled_by ? ` par ${sale.cancelled_by}` : ''}{sale.cancel_reason ? ` — ${sale.cancel_reason}` : ''}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Articles</p>
            <ul className="space-y-1 text-sm">
              {(sale.sale_items ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span className="min-w-0 flex-1 text-slate-700">{it.product_name} · {it.quantity} {it.unit} × {formatFCFA(it.unit_price)}</span>
                  <span className="font-bold text-slate-800">{formatFCFA(it.line_total)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1 border-t border-dashed border-slate-300 pt-2 text-sm">
            <Row label="Total" value={formatFCFA(sale.total)} />
            <Row label="Reçu" value={formatFCFA(sale.amount_received)} />
            <Row label="Reste dû" value={formatFCFA(sale.balance_due)} strong={balance > 0} danger={balance > 0} />
          </div>

          {/* Installments history */}
          {payments.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Versements ({payments.length})</p>
              <ul className="space-y-1 text-xs">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                    <span className="text-slate-600">{formatDateTime(p.created_at)}{p.created_by ? ` · ${p.created_by}` : ''}</span>
                    <span className="font-bold text-green-700">{formatFCFA(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pay installment */}
          {!isCancelled && balance > 0 && (
            <div className="rounded-xl bg-yellow-50 p-3 ring-1 ring-yellow-200">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-yellow-800">Encaisser un versement</p>
              <div className="flex gap-2">
                <input inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Montant" className="min-w-0 flex-1 rounded-lg border border-yellow-300 px-3 py-2 text-sm font-bold outline-none focus:border-yellow-400" />
                <button type="button" onClick={() => setPayAmount(String(Math.round(sale.balance_due)))} className="rounded-lg bg-yellow-200 px-2 text-xs font-bold text-yellow-800">Tout</button>
              </div>
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Note (facultatif)" className="mt-2 w-full rounded-lg border border-yellow-300 px-3 py-2 text-sm outline-none focus:border-yellow-400" />
              <button type="button" disabled={paying} onClick={handlePay} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {paying ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Encaisser
              </button>
            </div>
          )}

          {/* Cancel (gerant only) */}
          {isGerant && !isCancelled && (
            <div>
              {!showCancel ? (
                <button type="button" onClick={() => setShowCancel(true)} className="w-full rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
                  Annuler la vente
                </button>
              ) : (
                <div className="rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
                  <p className="mb-2 text-xs font-bold text-red-800">Confirmer l'annulation ? Le stock sera remis.</p>
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motif (facultatif)" className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm outline-none focus:border-red-400" />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setShowCancel(false)} className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200">Retour</button>
                    <button type="button" disabled={cancelling} onClick={handleCancel} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                      {cancelling ? <Loader2 size={16} className="animate-spin" /> : 'Confirmer'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3.5 text-base font-bold text-white shadow-lg shadow-green-500/20 transition hover:opacity-95 active:scale-[0.99]">
            <Wallet size={20} /> Envoyer le reçu sur WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={classNames(strong ? 'font-extrabold' : '', danger ? 'text-red-600' : 'text-slate-800')}>{value}</span>
    </div>
  );
}
