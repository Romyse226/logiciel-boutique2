import type { CategoryColor, Product, ProductCategory, ProductSaleUnit } from '@/types';
import { UNIT_GROS, UNIT_DETAIL } from '@/lib/product';
import catalogue from '../../catalogue.json';

/**
 * Catalogue de référence (source de vérité côté application).
 *
 * Toutes les informations proviennent du FICHIER UNIQUE `catalogue.json` placé à
 * la racine du projet : catégories, produits, prix, conditionnements et clés
 * d'image. Pour ajouter un produit, il suffit de modifier ce fichier JSON et de
 * déposer son image dans `images-sources/` : aucun composant n'est à modifier.
 *
 * Ce module sert à trois choses :
 *  1. Alimenter l'application en mode hors ligne (aucune requête réseau) ;
 *  2. Créer/aligner les produits côté Supabase de façon idempotente
 *     (identifiants déterministes, donc jamais de doublon) ;
 *  3. Fournir un nom, un prix et une clé d'image locale pour chaque référence.
 *
 * Ne jamais modifier les identifiants existants : les UUID sont calculés à
 * partir de la clé (`key`) et restent stables d'une version à l'autre.
 *
 * Les images ne sont PAS liées au `key` du produit : elles passent par une clé
 * stable `imageKey` (voir `catalogue.json` et `productImages.ts`).
 */

export interface CatalogCategory {
  slug: string;
  name: string;
  color: CategoryColor;
  sortOrder: number;
}

/** Prix + conditionnement d'un tarif (gros ou détail). */
export interface CatalogPrice {
  /** Prix en FCFA. 0 = non configuré. */
  price: number;
  /** Conditionnement affiché (ex : « sac », « barre », « rouleau »). */
  packaging: string;
}

export interface CatalogItem {
  /** Clé stable (ne jamais renommer : elle détermine l'identifiant du produit). */
  key: string;
  name: string;
  /** Slug de la catégorie (voir `categories` dans `catalogue.json`). */
  category: string;
  /** Unité de stock de référence. */
  stockUnit: string;
  /** Prix de gros + son conditionnement. */
  gros: CatalogPrice;
  /** Prix de détail + son conditionnement. */
  detail: CatalogPrice;
  /**
   * Clé d'image stable (`image_key`), distincte de `key` et de l'identifiant du
   * produit. C'est aussi le nom du fichier source dans `images-sources/`.
   * Plusieurs fiches produit peuvent partager la même clé.
   * Absente = icône de secours de la catégorie.
   */
  imageKey?: string | null;
}

interface CatalogFile {
  version: string;
  images: { sourcesDir: string; standard: string; thumbnails: string; details: string };
  categories: CatalogCategory[];
  products: CatalogItem[];
}

const FILE = catalogue as CatalogFile;

/** Les 8 catégories de référence (uniquement celles-ci). */
export const CATALOG_CATEGORIES: CatalogCategory[] = FILE.categories;

export const CATALOG_CATEGORY_SLUGS: string[] = CATALOG_CATEGORIES.map((c) => c.slug);

/** Dossiers des images, définis dans `catalogue.json`. */
export const CATALOG_IMAGE_DIRS = FILE.images;

/** Version du catalogue : sert à ne synchroniser qu'une fois par version. */
export const CATALOG_VERSION = FILE.version;

// ---------------------------------------------------------------------------
// Identifiants déterministes
// ---------------------------------------------------------------------------

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** UUID déterministe et stable pour une clé de catalogue (format v4 valide). */
export function catalogProductId(key: string): string {
  const [a, b, c, d] = cyrb128(`quincaillerie:${CATALOG_VERSION}:${key}`);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, '0')).join('');
  const chars = hex.split('');
  chars[12] = '4';
  chars[16] = '8';
  const s = chars.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Produits de référence
// ---------------------------------------------------------------------------

export const CATALOG_ITEMS: CatalogItem[] = FILE.products;

export function catalogItem(key: string): CatalogItem | undefined {
  return CATALOG_ITEMS.find((i) => i.key === key);
}

// ---------------------------------------------------------------------------
// Construction d'objets Product locaux (mode hors ligne)
// ---------------------------------------------------------------------------

function localCategory(cat: CatalogCategory): ProductCategory {
  return {
    id: `cat-${cat.slug}`,
    slug: cat.slug,
    name: cat.name,
    color: cat.color,
    icon: null,
    sort_order: cat.sortOrder,
  };
}

function saleUnitsFor(item: CatalogItem, productId: string): ProductSaleUnit[] {
  const units: ProductSaleUnit[] = [];
  if (item.gros.price > 0) {
    units.push({
      id: `local-${productId}-gros`,
      product_id: productId,
      unit: UNIT_GROS,
      price: item.gros.price,
      factor_to_stock: 1,
      is_default: false,
      allow_decimal: false,
    });
  }
  if (item.detail.price > 0) {
    units.push({
      id: `local-${productId}-detail`,
      product_id: productId,
      unit: UNIT_DETAIL,
      price: item.detail.price,
      factor_to_stock: 1,
      is_default: units.length === 0,
      allow_decimal: false,
    });
  }
  return units;
}

/** Catégories locales (disponibles sans réseau). */
export function localCategories(): ProductCategory[] {
  return CATALOG_CATEGORIES.map(localCategory);
}

/** Transforme une entrée de catalogue en `Product` utilisable par l'interface. */
export function catalogItemToProduct(item: CatalogItem): Product {
  const id = catalogProductId(item.key);
  const cat = CATALOG_CATEGORIES.find((c) => c.slug === item.category);
  return {
    id,
    category_id: cat ? `cat-${cat.slug}` : null,
    name: item.name,
    description: null,
    image_url: null,
    image_key: item.imageKey ?? null,
    stock_unit: item.stockUnit,
    stock_qty: 0,
    low_stock_threshold: 0,
    is_active: true,
    is_archived: false,
    category: cat ? localCategory(cat) : null,
    sale_units: saleUnitsFor(item, id),
  };
}

/** Catalogue complet sous forme de `Product[]` (repli hors ligne). */
export function localCatalogProducts(): Product[] {
  return CATALOG_ITEMS
    .map(catalogItemToProduct)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Compacte la liste pour l'écriture distante (colonnes de la table `products`). */
export function catalogRows(): Array<{
  id: string;
  name: string;
  category_slug: string;
  stock_unit: string;
  stock_qty: number;
  price_gros: number;
  price_detail: number;
  image_key: string | null;
}> {
  return CATALOG_ITEMS.map((item) => ({
    id: catalogProductId(item.key),
    name: item.name,
    category_slug: item.category,
    stock_unit: item.stockUnit,
    stock_qty: 0,
    price_gros: item.gros.price,
    price_detail: item.detail.price,
    image_key: item.imageKey ?? null,
  }));
}
