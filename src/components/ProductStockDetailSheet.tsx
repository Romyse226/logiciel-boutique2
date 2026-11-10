import { useEffect, useState } from 'react';
import type { Product, SoldStockTotals, StockMovement } from '@/types';
import { fetchProductStockDetails, fetchSoldStockTotals } from '@/lib/supabase';
import { formatDateTime, formatFCFA, formatQty, vibrate } from '@/lib/format';
import { isDetailUnit, isGrosUnit, pricesOf, UNIT_DETAIL, UNIT_GROS } from '@/lib/product';
import { userMessage } from '@/lib/errors';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import { ProductImage } from './ProductImage';

interface Props {
  product: Product;
  storeId: string | null;
  onClose: () => void;
}

function isOpeningStockMovement(movement: StockMovement): boolean {
  const note = (movement.note ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return movement.reason === 'adjustment' && note.includes('creation du produit');
}

export function ProductStockDetailSheet({ product: initialProduct, storeId, onClose }: Props) {
  const [product, setProduct] = useState(initialProduct);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [sold, setSold] = useState<SoldStockTotals>({ quantity: 0, value: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProduct(initialProduct);
    setLoading(true);
    setError(null);

    Promise.all([
      fetchProductStockDetails(initialProduct.id),
      fetchSoldStockTotals(storeId, initialProduct.id),
    ])
      .then(([details, totals]) => {
        if (!active) return;
        if (details.product) setProduct(details.product);
        setMovements(details.movements);
        setSold(totals);
      })
      .catch((cause: unknown) => {
        if (active) setError(userMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [initialProduct, storeId]);

  const { gros, detail } = pricesOf(product);
  const history = movements
    .filter((movement) => movement.delta !== 0 && !isOpeningStockMovement(movement))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const currentStock = Number(product.stock_qty);
  const initialStock = Number(product.initial_stock_qty);
  const initialStockKnown = product.initial_stock_qty != null && Number.isFinite(initialStock);
  const detailUnit = product.sale_units?.find((unit) => isDetailUnit(unit.unit));
  const grosUnit = product.sale_units?.find((unit) => isGrosUnit(unit.unit));
  const valuationUnit = detailUnit && detailUnit.price > 0
    ? detailUnit
    : grosUnit && grosUnit.price > 0
      ? grosUnit
      : null;
  const stockUnitPrice = valuationUnit && valuationUnit.factor_to_stock > 0
    ? valuationUnit.price / valuationUnit.factor_to_stock
    : null;
  const stockValue = (quantity: number) => (
    stockUnitPrice != null && Number.isFinite(quantity) ? formatFCFA(quantity * stockUnitPrice) : '—'
  );
  const openingMovement = movements.find(isOpeningStockMovement);
  const productCreatedAt = 'created_at' in product && typeof product.created_at === 'string'
    ? product.created_at
    : null;
  let stockAfterMovement = initialStock;
  const movementEvents = history.map((movement) => {
    stockAfterMovement += Number(movement.delta);
    return {
      id: movement.id,
      delta: Number(movement.delta),
      stockAfter: stockAfterMovement,
      created_at: movement.created_at,
      created_by: movement.created_by,
    };
  });
  const timeline = initialStockKnown
    ? [
        {
          id: 'initial-stock',
          delta: initialStock,
          stockAfter: initialStock,
          created_at: openingMovement?.created_at ?? productCreatedAt ?? history[0]?.created_at ?? new Date().toISOString(),
          created_by: openingMovement?.created_by ?? null,
        },
        ...movementEvents,
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Fiche de stock de ${product.name}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fermer la fiche produit"
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={() => { vibrate(15); onClose(); }}
            className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft size={20} /> Retour à la liste
          </button>
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
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
              <ProductImage
                product={product}
                iconSize={40}
                rounded="xl"
                className="flex h-full w-full items-center justify-center"
                imgClassName="h-full w-full object-contain"
                sizes="80px"
              />
            </div>
            <div className="min-w-0">
              <h2 className="break-words text-lg font-extrabold text-slate-900">{product.name}</h2>
              {gros > 0 && (
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {UNIT_GROS} : {formatFCFA(gros)}
                </p>
              )}
              {detail > 0 && (
                <p className="text-sm font-semibold text-slate-600">
                  {UNIT_DETAIL} : {formatFCFA(detail)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-green-50 p-3 ring-1 ring-green-100">
              <p className="text-xs font-semibold text-green-700">Stock vendu</p>
              <p className="mt-1 text-xl font-extrabold text-green-900">
                {formatQty(sold.quantity)}
              </p>
              <p className="mt-0.5 text-sm font-bold text-green-800">
                {formatFCFA(sold.value)}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 p-3 ring-1 ring-blue-100">
              <p className="text-xs font-semibold text-blue-700">Stock restant (actuel)</p>
              <p className="mt-1 text-xl font-extrabold text-blue-900">
                {Number.isFinite(currentStock) ? formatQty(currentStock) : '—'}
              </p>
              <p className="mt-0.5 text-sm font-bold text-blue-800">
                {Number.isFinite(currentStock) ? stockValue(currentStock) : '—'}
              </p>
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-extrabold text-slate-800">Historique du stock</h3>
          {error && (
            <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm font-semibold text-slate-500">
              <Loader2 size={18} className="animate-spin" /> Chargement de l’historique…
            </div>
          ) : (
            <ol className="space-y-2">
              {timeline.map((movement) => {
                const incoming = movement.delta >= 0;
                return (
                  <li key={movement.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                    <span className={`min-w-[4.25rem] rounded-xl px-2 py-1.5 text-center text-sm font-extrabold ${
                      incoming ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {incoming ? '+' : '−'}{formatQty(Math.abs(movement.delta))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-700">
                        {formatDateTime(movement.created_at)}
                      </span>
                      <span className="block truncate text-xs italic text-slate-500">
                        Effectuée par : {movement.created_by?.trim() || 'Nom non renseigné'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-extrabold text-slate-800">
                      {stockValue(movement.stockAfter)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
