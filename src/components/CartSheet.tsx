import type { CartLine } from '@/types';
import { classNames, formatFCFA, formatQty, vibrate, playBeep } from '@/lib/format';
import { colorOf } from '@/lib/colors';
import { unitLabel } from '@/lib/product';
import { ProductImage } from './ProductImage';
import { X, Minus, Plus, Trash2, ShoppingCart, CreditCard, ChevronLeft } from 'lucide-react';

interface Props {
  open: boolean;
  lines: CartLine[];
  total: number;
  onClose: () => void;
  onSetQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onCheckout: () => void;
  onContinueShopping: () => void;
}

export function CartSheet({ open, lines, total, onClose, onSetQty, onRemove, onCheckout, onContinueShopping }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft size={20} /> Retour
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <ShoppingCart className="text-orange-600" size={22} />
            <h2 className="text-base font-extrabold text-slate-800">Panier</h2>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
              {lines.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fermer le panier"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="rounded-full bg-slate-100 p-4">
                <ShoppingCart className="text-slate-400" size={32} />
              </div>
              <p className="text-sm text-slate-500">Votre panier est vide.</p>
              <button
                type="button"
                onClick={onContinueShopping}
                className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600"
              >
                Continuer la vente
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => {
                const c = colorOf(l.product.category?.color);
                return (
                  <li
                    key={l.key}
                    className="flex items-center gap-3 rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-100"
                  >
                    {/* Photo du produit si elle existe, sinon icône de la catégorie. */}
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                      <ProductImage
                        product={l.product}
                        iconSize={24}
                        rounded="xl"
                        className="flex h-full w-full items-center justify-center"
                        imgClassName="h-full w-full object-contain"
                        sizes="44px"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{l.product.name}</p>
                      <p className="text-xs text-slate-500">
                        {formatFCFA(l.price)} / {unitLabel(l.unit)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { vibrate(15); onSetQty(l.key, +(l.quantity - (l.allowDecimal ? 0.5 : 1)).toFixed(3)); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200 active:scale-90"
                          aria-label="Diminuer"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="min-w-[2.5rem] text-center text-sm font-extrabold text-slate-800">
                          {formatQty(l.quantity)}
                        </span>
                        <button
                          type="button"
                          onClick={() => { vibrate(15); onSetQty(l.key, +(l.quantity + (l.allowDecimal ? 0.5 : 1)).toFixed(3)); }}
                          className={classNames('flex h-8 w-8 items-center justify-center rounded-lg text-white active:scale-90', c.bg)}
                          aria-label="Augmenter"
                        >
                          <Plus size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { vibrate([20]); playBeep(false); onRemove(l.key); }}
                          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100 active:scale-90"
                          aria-label="Retirer"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={classNames('text-sm font-extrabold', c.textStrong)}>
                        {formatFCFA(l.price * l.quantity)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">Total</span>
              <span className="text-xl font-extrabold text-slate-900">{formatFCFA(total)}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/20 transition hover:opacity-95 active:scale-[0.99]"
            >
              <CreditCard size={20} />
              Passer au paiement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
