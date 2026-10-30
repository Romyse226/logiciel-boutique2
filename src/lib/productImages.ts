import catalogue from '../../catalogue.json';

/**
 * Correspondance centrale « identifiant d'image (image_key) -> fichier ».
 *
 * L'application ne stocke JAMAIS d'URL externe ici : toutes les images
 * standards sont des fichiers locaux servis par l'application (`/images/...`),
 * donc disponibles hors ligne dès que la PWA est installée.
 *
 * Convention de nommage (voir `catalogue.json` et `scripts/optimize-images.mjs`) :
 *
 *   public/images/products/thumbnails/{image_key}.webp   -> miniature 256 px
 *   public/images/products/{image_key}.webp              -> image standard 640 px
 *   public/images/products/details/{image_key}-1200.webp -> image de détail 1200 px
 *
 * Pour ajouter un produit standard plus tard :
 *   1. déposer l'image source dans `images-sources/` (nom = `imageKey`) ;
 *   2. ajouter le produit dans `catalogue.json` ;
 *   3. lancer `npm run catalogue:sync` (optimise les images + prépare le SQL).
 * Aucun composant de l'application n'a besoin d'être modifié.
 *
 * La clé `image_key` est distincte :
 *   - de l'identifiant du produit en stock (`products.id`) ;
 *   - de la photo personnalisée du commerçant (`products.image_url`).
 * Plusieurs fiches produit peuvent partager la même `image_key` (modèles).
 */

const DIRS = catalogue.images;

/**
 * Clés d'image (image_key) déclarées dans `catalogue.json`, avec le nom du
 * produit associé. Utilisé par les scripts de validation pour détecter une
 * image présente mais orpheline, ou une clé déclarée sans fichier.
 */
export const CATALOG_IMAGE_KEYS: ReadonlyArray<{ key: string; name: string; category: string }> =
  catalogue.products
    .filter((p) => typeof p.imageKey === 'string' && p.imageKey.trim().length > 0)
    .map((p) => ({ key: (p.imageKey as string).trim(), name: p.name, category: p.category }));

/** Dossier des images standards (640 px). */
export const PRODUCT_IMAGE_DIR: string = DIRS.standard;
/** Dossier des miniatures (256 px). */
export const PRODUCT_THUMB_DIR: string = DIRS.thumbnails;
/** Dossier des images de détail (1200 px). */
export const PRODUCT_DETAIL_DIR: string = DIRS.details;

/** Largeur des variantes disponibles. */
export const THUMB_SIZE = 256;
export const STANDARD_WIDTH = 640;
export const DETAIL_WIDTH = 1200;

/** Miniature 256 px : listes, cartes produit et parcours de vente. */
export function productThumbnail(imageKey: string): string {
  return `${PRODUCT_THUMB_DIR}/${imageKey}.webp`;
}

/** Image standard 640 px (aperçu produit sur téléphone). */
export function productStandard(imageKey: string): string {
  return `${PRODUCT_IMAGE_DIR}/${imageKey}.webp`;
}

/** Image de détail 1200 px (grands écrans). */
export function productDetail(imageKey: string): string {
  return `${PRODUCT_DETAIL_DIR}/${imageKey}-${DETAIL_WIDTH}.webp`;
}

/**
 * `srcset` des trois variantes (miniature / standard / détail), du plus léger au
 * plus lourd. Le navigateur choisit la variante adaptée à la taille réelle
 * d'affichage (`sizes`) et à la densité de l'écran : un petit téléphone ne
 * télécharge jamais l'image de 1200 px.
 */
export function productImageSrcSet(imageKey: string): string {
  return `${productThumbnail(imageKey)} ${THUMB_SIZE}w, ${productStandard(imageKey)} ${STANDARD_WIDTH}w, ${productDetail(imageKey)} ${DETAIL_WIDTH}w`;
}

/** `image_key` valide d'un produit (ou null). */
export function productImageKey(product: { image_key?: string | null } | null | undefined): string | null {
  const key = (product?.image_key ?? '').trim();
  return key.length > 0 ? key : null;
}

/**
 * Source à afficher pour un produit, par ordre de priorité :
 *   1. la photo personnalisée du commerçant (`image_url`) ;
 *   2. la miniature 256 px correspondant à `image_key` ;
 *   3. `null` -> l'appelant affiche l'icône de secours de la catégorie.
 *
 * Retourne `null` (jamais une image cassée) quand aucune image n'est connue.
 */
export function resolveProductImageSrc(product: {
  image_url?: string | null;
  image_key?: string | null;
}): string | null {
  if (product.image_url) return product.image_url;
  const key = productImageKey(product);
  return key ? productThumbnail(key) : null;
}

/**
 * `srcset` applicable à un produit : `null` pour une photo personnalisée (une
 * seule variante disponible) ou pour un produit sans `image_key`.
 */
export function resolveProductImageSrcSet(product: {
  image_url?: string | null;
  image_key?: string | null;
}): string | undefined {
  if (product.image_url) return undefined;
  const key = productImageKey(product);
  return key ? productImageSrcSet(key) : undefined;
}
