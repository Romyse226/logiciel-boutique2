import { useEffect, useState } from 'react';
import type { Product, StockMovement } from '@/types';
import { fetchProductStockDetails } from '@/lib/supabase';
import { formatDateTime, formatFCFA, formatQty, vibrate } from '@/lib/format';
import { pricesOf, UNIT_DETAIL, UNIT_GROS } from '@/lib/product';
import { userMessage } from '@/lib/errors';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import { ProductImage } from './ProductImage';

interface Props {
  product: Product;
  onClose: () => void;
}

function isOpeningStockMovement(movement: StockMovement): boolean {
  const note = (movement.note ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return movement.reason === 'adjustment' && note.includes('creation du produit');
}

export function ProductStockDetailSheet({ product: initialProduct, onClose }: Props) {
  const [product, setProduct] = useState(initialProduct);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProduct(initialProduct);
    setLoading(true);
    setError(null);

    fetchProductStockDetails(initialProduct.id)
      .then((details) => {
        if (!active) return;
        if (details.product) setProduct(details.product);
        setMovements(details.movements);
      })
      .catch((cause: unknown) => {
        if (active) setError(userMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [initialProduct]);

  const { gros, detail } = pricesOf(product);
  const history = movements
    .filter((movement) => movement.delta !== 0 && !isOpeningStockMovement(movement))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const currentStock = Number(product.stock_qty);
  const initialStock = product.initial_stock_qty;

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
            <div className="rounded-2xl bg-blue-50 p-3 ring-1 ring-blue-100">
              <p className="text-xs font-semibold text-blue-700">Stock actuel</p>
              <p className="mt-1 text-xl font-extrabold text-blue-900">
                {Number.isFinite(currentStock) ? formatQty(currentStock) : '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs font-semibold text-slate-600">Stock de base</p>
              <p className="mt-1 text-xl font-extrabold text-slate-900">
                {initialStock != null && Number.isFinite(Number(initialStock))
                  ? formatQty(Number(initialStock))
                  : '—'}
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
          ) : history.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500">
              Aucun mouvement enregistré.
            </p>
          ) : (
            <ol className="space-y-2">
              {history.map((movement) => {
                const incoming = movement.delta > 0;
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
                      <span className="block truncate text-xs text-slate-500">
                        {movement.created_by?.trim() || 'Nom non renseigné'}
                      </span>
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
