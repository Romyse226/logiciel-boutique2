import { useState } from 'react';
import type { Product } from '@/types';
import { stockState, pricesOf } from '@/lib/product';
import { classNames, formatFCFA, formatQty, vibrate } from '@/lib/format';
import { X, Search, PackageX, PackageCheck } from 'lucide-react';
import { ProductStockDetailSheet } from './ProductStockDetailSheet';

export type StockKind = 'ok' | 'out';

interface KindMeta {
  kind: StockKind;
  emoji: string;
  label: string;
  title: string;
  icon: typeof PackageCheck;
  wrap: string;
  solid: string;
}

export const STOCK_KINDS: KindMeta[] = [
  { kind: 'ok', emoji: '🟢', label: 'Vert : Stock suffisant', title: 'Stock suffisant', icon: PackageCheck, wrap: 'bg-green-50 ring-green-200 text-green-800', solid: 'bg-green-500' },
  { kind: 'out', emoji: '🔴', label: 'Rouge : Rupture de stock', title: 'Rupture de stock', icon: PackageX, wrap: 'bg-red-50 ring-red-200 text-red-800', solid: 'bg-red-500' },
];

/**
 * Contour sombre léger appliqué au chiffre blanc du cercle « Stock suffisant »
 * (vert) : améliore nettement la lisibilité du blanc sur fond clair sans
 * modifier l'apparence des autres indicateurs.
 */
const OK_COUNT_OUTLINE = { textShadow: '0 0 2px rgba(15,23,42,0.65), 0 1px 1px rgba(15,23,42,0.45)' };

export function productsOfKind(products: Product[], kind: StockKind): Product[] {
  const list = products.filter((p) => stockState(p) === kind);
  // Stock suffisant : du stock le plus bas au plus élevé (du haut vers le bas).
  if (kind === 'ok') list.sort((a, b) => (a.stock_qty ?? 0) - (b.stock_qty ?? 0));
  return list;
}

/** Les gros boutons colorés + le pop-up listant les produits concernés. */
export function StockLegend({ products }: { products: Product[] }) {
  const [open, setOpen] = useState<StockKind | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STOCK_KINDS.map(({ kind, emoji, label, wrap, solid }) => {
          const count = productsOfKind(products, kind).length;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => { vibrate(15); setOpen(kind); }}
              className={classNames('flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition active:scale-[0.98]', wrap)}
            >
              <span
                className={classNames('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white shadow-sm', solid)}
                style={kind === 'ok' ? OK_COUNT_OUTLINE : undefined}
              >
                {count}
              </span>
              <span className="min-w-0 flex-1 text-sm font-bold leading-tight">{emoji} {label}</span>
            </button>
          );
        })}
      </div>
      <StockListSheet
        open={open}
        products={products}
        onClose={() => setOpen(null)}
        onSelect={setSelectedProduct}
      />
      {selectedProduct && (
        <ProductStockDetailSheet
          key={selectedProduct.id}
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
}

/** Pop-up listant les produits d'une catégorie de stock. */
export function StockListSheet({
  open, products, onClose, onSelect,
}: {
  open: StockKind | null;
  products: Product[];
  onClose: () => void;
  onSelect: (p: Product) => void;
}) {
  // Toujours appelé (avant le retour anticipé) : l'ordre des hooks reste stable.
  const [query, setQuery] = useState('');

  if (!open) return null;
  const meta = STOCK_KINDS.find((k) => k.kind === open)!;
  const Icon = meta.icon;
  const all = productsOfKind(products, open);
  const needle = query.trim().toLowerCase();
  const list = needle
    ? all.filter((p) => p.name.toLowerCase().includes(needle) || (p.category?.name ?? '').toLowerCase().includes(needle))
    : all;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className={classNames('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white', meta.solid)}>
            <Icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold text-slate-800">{meta.title}</h2>
            <p className="text-xs text-slate-500">{list.length} produit{list.length > 1 ? 's' : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer">
            <X size={20} />
          </button>
        </div>

        {/* Barre de recherche : retrouver un produit dans la liste (rupture / stock suffisant). */}
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un produit…"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-9 text-sm font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              aria-label="Rechercher un produit dans cette liste"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Effacer la recherche"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {list.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
              {needle ? 'Aucun produit ne correspond à cette recherche.' : 'Aucun produit dans cette catégorie.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {list.map((p) => {
                const { gros, detail } = pricesOf(p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200 transition hover:ring-slate-300"
                    >
                      <span className={classNames('h-3 w-3 shrink-0 rounded-full', meta.solid)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{p.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {p.category?.name ? `${p.category.name} · ` : ''}
                          <span className="font-bold text-slate-700">
                            Stock : {formatQty(p.stock_qty ?? 0)}
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {gros > 0 && <p className="text-xs font-bold text-slate-600">Gros {formatFCFA(gros)}</p>}
                        {detail > 0 && <p className="text-xs font-bold text-slate-600">Détail {formatFCFA(detail)}</p>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-base font-bold text-slate-700">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
