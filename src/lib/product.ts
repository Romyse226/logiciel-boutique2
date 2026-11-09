import type { Product, ProductSaleUnit } from '@/types';

/** Unité de vente réservée au prix de gros. */
export const UNIT_GROS = 'Gros';
/** Unité de vente réservée au prix de détail (unité par défaut). */
export const UNIT_DETAIL = 'Détail';

/** Lettres seules, en minuscules : ignore accents, symboles et espaces. */
function lettersOnly(value: string): string {
  return value.normalize('NFC').replace(/[^\p{L}]/gu, '').toLowerCase();
}

/**
 * Reconnaît l'unité « Gros » même si la valeur stockée est légèrement
 * différente (« gros », « Gros », avec espaces…).
 */
export function isGrosUnit(unit: string): boolean {
  return lettersOnly(unit).startsWith('gros');
}

/**
 * Reconnaît l'unité « Détail » de façon tolérante : les anciennes lignes de la
 * base contiennent parfois « DÃ©tail » (erreur d'encodage historique). On ne
 * compare donc pas la chaîne littéralement.
 */
export function isDetailUnit(unit: string): boolean {
  return lettersOnly(unit).endsWith('tail');
}

/**
 * Retrouve l'unité de vente d'un produit à partir du type demandé
 * (« Gros » ou « Détail »), de façon tolérante à l'ancien encodage.
 *
 * Indispensable : certaines lignes de la base contiennent « DÃ©tail » (erreur
 * d'encodage historique). Une comparaison stricte `u.unit === 'Détail'` ne
 * trouvait alors aucune unité : le choix du prix de détail restait sans effet
 * et le parcours de vente se bloquait à l'étape quantité.
 */
export function findUnit(units: ProductSaleUnit[], target: string): ProductSaleUnit | null {
  if (!target) return null;
  const matches = target === UNIT_GROS ? isGrosUnit : isDetailUnit;
  return units.find((u) => u.unit === target) ?? units.find((u) => matches(u.unit)) ?? null;
}

/** Libellé lisible d'une unité de vente (« Gros » / « Détail »), sans ancien encodage. */
export function unitLabel(unit: string): string {
  if (isGrosUnit(unit)) return UNIT_GROS;
  if (isDetailUnit(unit)) return UNIT_DETAIL;
  return unit;
}

/** Les deux prix configurés d'un produit (0 = non configuré). */
export function pricesOf(product: Pick<Product, 'sale_units'>): { gros: number; detail: number } {
  const units = product.sale_units ?? [];
  return {
    gros: units.find((u) => isGrosUnit(u.unit))?.price ?? 0,
    detail: units.find((u) => isDetailUnit(u.unit))?.price ?? 0,
  };
}

/** Unités réellement vendables (prix > 0), dans l'ordre Gros puis Détail. */
export function sellableUnits(product: Pick<Product, 'sale_units'>): ProductSaleUnit[] {
  const units = product.sale_units ?? [];
  return units
    .filter((u) => u.price > 0 && (isGrosUnit(u.unit) || isDetailUnit(u.unit)))
    .sort((a, b) => Number(isDetailUnit(a.unit)) - Number(isDetailUnit(b.unit)));
}

export type StockState = 'ok' | 'out';

export function stockState(product: Pick<Product, 'stock_qty'>): StockState {
  const qty = Number(product.stock_qty);
  if (!Number.isFinite(qty) || qty <= 0) return 'out';
  return 'ok';
}

/** Couleur du point lumineux de stock. */
export const STOCK_DOT: Record<StockState, string> = {
  ok: 'bg-green-500',
  out: 'bg-red-500',
};

export const STOCK_LABEL: Record<StockState, string> = {
  ok: 'Stock bon',
  out: 'Rupture de stock',
};
