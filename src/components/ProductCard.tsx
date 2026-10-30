import type { Product } from '@/types';
import { ProductImage } from './ProductImage';
import { colorOf } from '@/lib/colors';
import { classNames, formatFCFA } from '@/lib/format';
import { pricesOf, stockState, STOCK_DOT, STOCK_LABEL } from '@/lib/product';
import { Pencil, Trash2 } from 'lucide-react';

interface Props {
  product: Product;
  onSelect: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  /** Autorisation "modifier les informations du stock". */
  canEdit: boolean;
  /** Appelé quand une action est refusée faute d'autorisation. */
  onDenied: () => void;
  /**
   * Mode édition (bouton crayon de la section « Vendre »).
   * - affiche les icônes « modifier » et « supprimer » sous la carte ;
   * - DÉSACTIVE l'ouverture du parcours de vente : aucun clic (prix, image,
   *   nom, autre zone) ne peut démarrer une vente pendant ce mode.
   */
  editMode?: boolean;
}

export function ProductCard({ product, onSelect, onEdit, onDelete, canEdit, onDenied, editMode = false }: Props) {
  const c = colorOf(product.category?.color);
  const { gros, detail } = pricesOf(product);
  const st = stockState(product);
  const configured = gros > 0 || detail > 0;

  function handleSelect() {
    if (editMode) return;
    onSelect(product);
  }

  return (
    <div
      role={editMode ? undefined : 'button'}
      tabIndex={editMode ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={(e) => { if (!editMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleSelect(); } }}
      className={classNames(
        'group relative flex w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition-all',
        editMode ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:ring-slate-300 active:scale-[0.99] focus:outline-none focus:ring-2',
        c.ring,
      )}
    >
      {/* Cadre carré : la photo remplit le carré 1:1 (recadrage centré, sans
          déformation), quelle que soit son orientation d'origine (portrait,
          paysage…). `object-contain` laissait des bandes vides qui donnaient
          l'impression que la photo gardait son format d'origine. */}
      <div className={classNames('relative aspect-square w-full bg-gradient-to-br', c.gradient)}>
        <ProductImage
          product={product}
          iconSize={56}
          rounded="full"
          className="flex h-full w-full items-center justify-center"
          imgClassName="h-full w-full object-contain"
          iconClassName="bg-white/20 backdrop-blur"
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 260px"
        />

{/* Feu tricolore : un seul point lumineux */}
        <span        
          className={classNames('absolute left-2 top-2 h-3.5 w-3.5 rounded-full shadow ring-2 ring-white', STOCK_DOT[st])}
          title={STOCK_LABEL[st]}
          aria-label={STOCK_LABEL[st]}
        />
      </div>

      {/* Actions (modifier / supprimer) : visibles uniquement en mode édition */}
      {editMode && (
        <div className="flex gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (canEdit) onEdit(product); else onDenied(); }}
            className="flex flex-1 items-center justify-center rounded-xl border-2 border-slate-200 bg-white py-2 text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 active:scale-95"
            aria-label="Modifier le produit"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (canEdit) onDelete(product); else onDenied(); }}
            className="flex flex-1 items-center justify-center rounded-xl border-2 border-red-200 bg-white py-2 text-red-600 shadow-sm transition hover:border-red-400 hover:bg-red-50 active:scale-95"
            aria-label="Supprimer le produit"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1 px-3 pb-3 pt-2">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug text-slate-800">
          {product.name}
        </h3>

        <div className="mt-auto space-y-0.5 pt-1">
          {configured ? (
            gros > 0 && detail > 0 ? (
              <>
                <p className="text-xs font-bold text-slate-600">
                  📦 Gros : <span className={c.textStrong}>{formatFCFA(gros)}</span>
                </p>
                <p className="text-xs font-bold text-slate-600">
                  🛍️ Détail : <span className={c.textStrong}>{formatFCFA(detail)}</span>
                </p>
              </>
            ) : (
              /* Un seul prix renseigné : on l'affiche seul, sans mention « Gros » / « Détail ». */
              <p className="text-sm font-extrabold">
                <span className={c.textStrong}>{formatFCFA(gros > 0 ? gros : detail)}</span>
              </p>
            )
          ) : (
            <p className="text-sm font-semibold text-slate-400">Prix à configurer</p>
          )}
        </div>
      </div>
    </div>
  );
}
