import { useEffect, useMemo, useState } from 'react';
import type { CartLine } from '@/types';
import { classNames, formatFCFA, vibrate, playBeep, normalizeCIphone } from '@/lib/format';
import { X, Check, AlertTriangle, User, Phone, Loader2, ChevronLeft } from 'lucide-react';

export interface PaymentResult {
  status: 'paid' | 'partial';
  amountReceived: number;
  balanceDue: number;
  customerName: string | null;
  customerPhone: string | null;
}

interface Props {
  open: boolean;
  lines: CartLine[];
  total: number;
  processing: boolean;
  error: string | null;
  onClose: () => void;
  /** Retour à l'étape précédente (le panier). */
  onBack: () => void;
  onConfirm: (result: PaymentResult) => void;
}

export function PaymentSheet({ open, lines, total, processing, error, onClose, onBack, onConfirm }: Props) {
  const [mode, setMode] = useState<'paid' | 'partial' | null>(null);
  const [receivedInput, setReceivedInput] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');

  useEffect(() => {
    if (open) {
      setMode(null);
      setReceivedInput('');
      setName('');
      setPhone('');
    }
  }, [open]);

  const received = receivedInput === '' ? 0 : parseFloat(receivedInput);
  const balance = Math.max(0, total - (Number.isNaN(received) ? 0 : received));
  const hasBalance = balance > 0.001;

  const canConfirm = useMemo(() => {
    if (total <= 0) return false;
    if (mode === 'paid') return true;
    if (mode === 'partial') {
      // 0 est une valeur acceptée : la totalité du montant passe alors en crédit.
      if (Number.isNaN(received)) return false;
      if (hasBalance && !name.trim()) return false;
      return true;
    }
    return false;
  }, [mode, received, total, hasBalance, name]);

  if (!open) return null;

  function handleConfirm() {
    if (!canConfirm) return;
    vibrate([20, 30, 20]);
    playBeep(true);
    onConfirm({
      status: mode === 'paid' ? 'paid' : 'partial',
      amountReceived: mode === 'paid' ? total : received,
      balanceDue: mode === 'paid' ? 0 : balance,
      customerName: hasBalance && mode === 'partial' ? name.trim() : null,
      customerPhone: phone.trim() ? normalizeCIphone(phone.trim()) : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={processing ? undefined : onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={onBack}
            disabled={processing}
            className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft size={20} /> Retour
          </button>
          <h2 className="text-base font-extrabold text-slate-800">Paiement</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Articles</span>
              <span className="text-sm font-semibold text-slate-700">{lines.length}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">Total à payer</span>
              <span className="text-xl font-extrabold text-slate-900">{formatFCFA(total)}</span>
            </div>
          </div>

          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Mode de paiement</p>
          <div className="grid grid-cols-2 gap-2">
            <button
  type="button"
  onClick={() => { setMode('partial'); vibrate(15); }}
  className={classNames(
    'flex flex-col items-center gap-1 rounded-2xl px-3 py-3 text-sm font-bold ring-2 transition',
    mode === 'partial' ? 'bg-yellow-50 text-yellow-700 ring-yellow-500' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
  )}
>
  <AlertTriangle size={22} className="text-yellow-600" />
  À crédit
</button>

<button
  type="button"
  onClick={() => { setMode('paid'); vibrate(15); }}
  className={classNames(
    'flex flex-col items-center gap-1 rounded-2xl px-3 py-3 text-sm font-bold ring-2 transition',
    mode === 'paid' ? 'bg-green-50 text-green-700 ring-green-500' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
  )}
>
  <Check size={22} className="text-green-600" />
  Tout payé
</button>

          </div>

          {mode === 'partial' && (
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Avance versée
                </label>
                {/* Suffixe « F » : purement visuel, jamais enregistré dans la valeur. */}
                <div className="flex items-center rounded-xl border-2 border-slate-200 focus-within:border-yellow-400">
                  <input
                    inputMode="decimal"
                    value={receivedInput}
                    onChange={(e) => setReceivedInput(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    aria-label="Avance versée en FCFA"
                    className="min-w-0 flex-1 rounded-l-xl bg-transparent px-2 py-3 text-lg font-bold text-slate-800 outline-none"
                  />
                  <span className="pl-1 pr-3 text-lg font-bold text-slate-500" aria-hidden>F</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="text-sm font-semibold text-slate-600">Reste à payer</span>
                <span className={classNames('text-base font-extrabold', hasBalance ? 'text-red-600' : 'text-green-600')}>
                  {formatFCFA(balance)}
                </span>
              </div>
              {hasBalance && (
                <div className="space-y-2 rounded-xl bg-yellow-50 p-3 ring-1 ring-yellow-200">
                  <p className="text-xs font-semibold text-yellow-800">
                    Entrez les infos du client pour finaliser.
                  </p>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-3.5 text-slate-400" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Nom du client"
                      className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-yellow-400"
                    />
                  </div>
                  <div className="relative">
                    <Phone size={16} className="absolute left-3 top-3.5 text-slate-400" />
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      placeholder="Téléphone (ex: 07 07 07 07 07)"
                      className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-yellow-400"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!canConfirm || processing}
            onClick={handleConfirm}
            className={classNames(
              'flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-bold text-white shadow transition active:scale-[0.99]',
              canConfirm && !processing
                ? 'bg-gradient-to-r from-green-500 to-green-600 hover:opacity-95'
                : 'bg-slate-300 cursor-not-allowed',
            )}
          >
            {processing ? (
              <><Loader2 size={20} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Check size={20} /> Confirmer la vente</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
