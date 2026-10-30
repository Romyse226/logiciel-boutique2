import { useEffect, useState } from 'react';
import type { Sale } from '@/types';
import type { StoreInfo } from '@/types';
import { classNames, formatFCFA, formatQty, formatDateTime } from '@/lib/format';
import { X, Share2, Copy, Check, Printer, Store } from 'lucide-react';

interface Props {
  open: boolean;
  sale: Sale | null;
  store: StoreInfo | null;
  onClose: () => void;
  onNewSale: () => void;
}

function buildReceiptText(sale: Sale, store: StoreInfo | null): string {
  const lines: string[] = [];
  lines.push(`*${store?.name ?? 'Quincaillerie'}*`);
  if (store?.address) lines.push(store.address);
  if (store?.phone) lines.push(`Tél: ${store.phone}`);
  lines.push('------------------------------');
  lines.push(`Reçu: ${sale.reference}`);
  lines.push(`Date: ${formatDateTime(sale.created_at)}`);
  if (sale.customer_name) lines.push(`Client: ${sale.customer_name}`);
  lines.push('------------------------------');
  lines.push('Articles:');
  for (const it of sale.sale_items ?? []) {
    lines.push(`- ${it.product_name}`);
    lines.push(`  ${formatQty(it.quantity)} ${it.unit} x ${formatFCFA(it.unit_price)} = ${formatFCFA(it.line_total)}`);
  }
  lines.push('------------------------------');
  lines.push(`Total: ${formatFCFA(sale.total)}`);
  lines.push(`Reçu: ${formatFCFA(sale.amount_received)}`);
  lines.push(`Reste dû: ${formatFCFA(sale.balance_due)}`);
  lines.push(`Statut: ${sale.status === 'paid' ? 'Payé' : 'Partiel'}`);
  lines.push('------------------------------');
  lines.push('Merci de votre confiance !');
  return lines.join('\n');
}

export function ReceiptSheet({ open, sale, store, onClose, onNewSale }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  if (!open || !sale) return null;

  const text = buildReceiptText(sale, store);
  const encoded = encodeURIComponent(text);
  const normalizedPhone = sale.customer_phone ?? null;
  const whatsappUrl = normalizedPhone
    ? `https://wa.me/${normalizedPhone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  async function share() {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: `Reçu ${sale!.reference}`, text });
        return;
      } catch { /* fall through to WhatsApp */ }
    }
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  function print() {
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) return;
    const html = `<pre style="font-family: monospace; padding: 16px; font-size: 13px; white-space: pre-wrap;">${text.replace(/</g, '&lt;')}</pre>`;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700">
              <Check size={18} />
            </div>
            <h2 className="text-base font-extrabold text-slate-800">Vente enregistrée</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-sm rounded-2xl bg-white p-4 font-mono text-[13px] leading-relaxed text-slate-800 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-center gap-2 text-center">
              <Store size={16} className="text-orange-600" />
              <p className="font-bold">{store?.name ?? 'Quincaillerie'}</p>
            </div>
            {store?.address && <p className="text-center text-slate-600">{store.address}</p>}
            {store?.phone && <p className="text-center text-slate-600">Tél: {store.phone}</p>}
            <hr className="my-2 border-dashed border-slate-300" />
            <p>Reçu: <b>{sale.reference}</b></p>
            <p>Date: {formatDateTime(sale.created_at)}</p>
            {sale.customer_name && <p>Client: {sale.customer_name}</p>}
            <hr className="my-2 border-dashed border-slate-300" />
            <p className="font-bold">Articles</p>
            <ul className="space-y-1">
              {(sale.sale_items ?? []).map((it) => (
                <li key={it.id}>
                  <p>{it.product_name}</p>
                  <p className="text-slate-600">
                    {formatQty(it.quantity)} {it.unit} × {formatFCFA(it.unit_price)} = {formatFCFA(it.line_total)}
                  </p>
                </li>
              ))}
            </ul>
            <hr className="my-2 border-dashed border-slate-300" />
            <div className="flex justify-between"><span>Total</span><b>{formatFCFA(sale.total)}</b></div>
            <div className="flex justify-between"><span>Reçu</span><span>{formatFCFA(sale.amount_received)}</span></div>
            <div className="flex justify-between">
              <span>Reste dû</span>
              <span className={sale.balance_due > 0 ? 'text-red-600 font-bold' : ''}>{formatFCFA(sale.balance_due)}</span>
            </div>
            <div className="flex justify-between">
              <span>Statut</span>
              <span className={sale.status === 'paid' ? 'text-green-600 font-bold' : 'text-yellow-700 font-bold'}>
                {sale.status === 'paid' ? 'Payé' : 'Partiel'}
              </span>
            </div>
            <hr className="my-2 border-dashed border-slate-300" />
            <p className="text-center text-slate-600">Merci de votre confiance !</p>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { /* user taps send manually */ }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3.5 text-base font-bold text-white shadow-lg shadow-green-500/20 transition hover:opacity-95 active:scale-[0.99]"
          >
            <Share2 size={20} />
            Envoyer le reçu sur WhatsApp
          </a>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={copy}
              className={classNames(
                'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ring-1 transition',
                copied ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300',
              )}
            >
              {copied ? <><Check size={16} /> Copié</> : <><Copy size={16} /> Copier</>}
            </button>
            <button
              type="button"
              onClick={print}
              className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
            >
              <Printer size={16} /> Imprimer
            </button>
          </div>
          <button
            type="button"
            onClick={onNewSale}
            className="w-full rounded-xl bg-orange-500 px-4 py-3 text-base font-bold text-white hover:bg-orange-600 active:scale-[0.99]"
          >
            Nouvelle vente
          </button>
          <p className="text-center text-[11px] text-slate-400">
            WhatsApp s'ouvre avec le message prérempli. Appuyez vous-même sur Envoyer.
          </p>
        </div>
      </div>
    </div>
  );
}
