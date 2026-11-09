import { useEffect, useMemo, useState } from 'react';
import type { Product } from '@/types';
import { ProductImage } from './ProductImage';
import { classNames, formatFCFA, vibrate, playBeep } from '@/lib/format';
import { colorOf } from '@/lib/colors';
import { pricesOf, sellableUnits, findUnit, isGrosUnit, stockState, UNIT_GROS, UNIT_DETAIL } from '@/lib/product';
import { Minus, Plus, X, Check, ShoppingBasket, ChevronLeft, Package, ShoppingBag } from 'lucide-react';

interface Props {
  product: Product | null;
  onClose: () => void;
  onAdd: (product: Product, unit: string, quantity: number) => void;
}

export function AddToCartSheet({ product, onClose, onAdd }: Props) {
  const units = useMemo(() => (product ? sellableUnits(product) : []), [product]);
  const [unit, setUnit] = useState<string>('');
  const [qty, setQty] = useState<number>(1);
  const [qtyInput, setQtyInput] = useState<string>('1');

  const needUnitChoice = units.length > 1;
  const showQty = !needUnitChoice || unit !== '';

  useEffect(() => {
    if (!product) return;
    const u = sellableUnits(product);
    if (u.length === 1) setUnit(u[0].unit);
    else setUnit('');
    setQty(1);
    setQtyInput('1');
  }, [product]);

  if (!product) return null;

  const c = colorOf(product.category?.color);
  const { gros, detail } = pricesOf(product);
  const outOfStock = stockState(product) === 'out';
  // Recherche tolérante : l'unité stockée peut être « DÃ©tail » (ancien encodage).
  const selectedPsu = findUnit(units, unit);

  function commitQty(n: number) {
    let v = Math.floor(n);
    if (v < 0) v = 0;
    setQty(v);
    setQtyInput(v === 0 ? '' : String(v));
  }

  function pressDigit(d: string) {
    vibrate(15);
    let s = qtyInput;
    if (d === 'del') s = s.slice(0, -1);
    else s = s + d;
    const num = s === '' ? 0 : parseInt(s, 10);
    setQtyInput(s);
    setQty(Number.isNaN(num) ? 0 : num);
  }

  const lineTotal = selectedPsu ? selectedPsu.price * qty : 0;
  const canAdd = !!selectedPsu && qty > 0 && selectedPsu.price > 0 && !outOfStock;

  function handleAdd() {
    if (!selectedPsu || !canAdd) return;
    playBeep(true);
    vibrate([20, 30, 20]);
    onAdd(product!, selectedPsu.unit, qty);
    onClose();
  }

  function handleBack() {
    if (needUnitChoice && unit !== '') { setUnit(''); return; }
    onClose();
  }

  const hasNoPrice = units.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft size={20} /> Retour
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Photo du produit si elle existe, sinon icône de la catégorie. */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
              <ProductImage
                product={product}
                iconSize={22}
                rounded="xl"
                className="flex h-full w-full items-center justify-center"
                imgClassName="h-full w-full object-contain"
                sizes="40px"
                lazy={false}
              />
            </div>
            <h2 className="truncate text-sm font-bold text-slate-800">{product.name}</h2>
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

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {hasNoPrice && (
            <p className="rounded-2xl bg-yellow-50 p-4 text-sm font-semibold text-yellow-800 ring-1 ring-yellow-200">
              Les prix de ce produit ne sont pas encore configurés. Demandez au boss de les renseigner.
            </p>
          )}
          {outOfStock && (
            <p className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700 ring-1 ring-red-200">
              Ce produit est en rupture de stock et ne peut pas être vendu.
            </p>
          )}

          {/* Étape 1 : choix Gros / Détail (2 grandes cartes tactiles) */}
          {needUnitChoice && !showQty && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-600">Choisissez le type de vente</p>
              {gros > 0 && (
                <button
                  type="button"
                  onClick={() => { vibrate(15); setUnit(UNIT_GROS); }}
                  className="text-outline flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-5 text-white shadow-lg shadow-blue-500/20 transition hover:opacity-95 active:scale-[0.99]"
                >
                  <span className="flex items-center gap-3 text-lg font-extrabold"><Package size={26} /> En Gros</span>
                  <span className="text-xl font-extrabold">{formatFCFA(gros)}</span>
                </button>
              )}
              {detail > 0 && (
                <button
                  type="button"
                  onClick={() => { vibrate(15); setUnit(UNIT_DETAIL); }}
                  className={classNames('text-outline flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-5 text-white shadow-lg transition hover:opacity-95 active:scale-[0.99]', c.bg)}
                >
                  <span className="flex items-center gap-3 text-lg font-extrabold"><ShoppingBag size={26} /> En Détail</span>
                  <span className="text-xl font-extrabold">{formatFCFA(detail)}</span>
                </button>
              )}
            </div>
          )}

          {/* Étape 2 : quantité */}
          {showQty && selectedPsu && (
            <div>
              <div className="mb-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <div className={classNames('flex items-center', needUnitChoice ? 'justify-between' : 'justify-end')}>
                  {needUnitChoice && (
                    <span className="text-sm font-bold text-slate-700">
                      {isGrosUnit(selectedPsu.unit) ? '📦 En Gros' : '🛍️ En Détail'}
                    </span>
                  )}
                  <span className={classNames('text-sm font-extrabold', c.textStrong)}>{formatFCFA(selectedPsu.price)}</span>
                </div>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <p className="text-xl font-extrabold text-slate-800">Quelle quantité ?</p>
                <p className={classNames('text-sm font-bold', c.textStrong)}>Total : {formatFCFA(lineTotal)}</p>
              </div>

              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => commitQty(qty - 1)}
                  className="flex w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95"
                  aria-label="Diminuer"
                >
                  <Minus size={22} />
                </button>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={qtyInput}
                  onChange={(e) => {
                    const s = e.target.value.replace(/[^0-9]/g, '');
                    setQtyInput(s);
                    setQty(s === '' ? 0 : parseInt(s, 10));
                  }}
                  className={classNames(
                    'min-w-0 flex-1 rounded-xl border-2 text-center text-2xl font-extrabold text-slate-800 outline-none',
                    qty > 0 ? 'border-slate-200 focus:border-slate-400' : 'border-yellow-300',
                  )}
                />
                <button
                  type="button"
                  onClick={() => commitQty(qty + 1)}
                  className={classNames('flex w-14 items-center justify-center rounded-xl text-white active:scale-95', c.bg)}
                  aria-label="Augmenter"
                >
                  <Plus size={22} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((d, i) => {
                  if (d === '') return <div key={`sp-${i}`} />;
                  const isDel = d === 'del';
                  return (
                    <button
                      key={d + i}
                      type="button"
                      onClick={() => pressDigit(d)}
                      className={classNames(
                        'h-12 rounded-xl text-lg font-bold transition active:scale-95',
                        isDel ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-100 hover:bg-slate-100',
                      )}
                      aria-label={isDel ? 'Effacer' : d}
                    >
                      {isDel ? '⌫' : d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!canAdd}
            onClick={handleAdd}
            className={classNames(
              'text-outline flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-bold text-white shadow transition active:scale-[0.99]',
              canAdd ? classNames(c.bg, 'hover:opacity-90') : 'cursor-not-allowed bg-slate-300',
            )}
          >
            <ShoppingBasket size={20} />
            {outOfStock ? 'Rupture de stock' : 'Ajouter au panier'}
            {canAdd && <Check size={18} className="ml-1 opacity-80" />}
          </button>
        </div>
      </div>
    </div>
  );
}
