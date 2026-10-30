import { useEffect, useState } from 'react';
import { classNames } from '@/lib/format';
import type { Product } from '@/types';
import { CategoryIcon } from './CategoryIcon';
import { resolveProductImageSrc, resolveProductImageSrcSet } from '@/lib/productImages';

type ImageProduct = Pick<Product, 'name'> & {
  image_url?: string | null;
  image_key?: string | null;
  category?: { slug: string } | null;
};

interface Props {
  product: ImageProduct;
  /** Taille de l'icône de secours (px). */
  iconSize?: number;
  /** Arrondi de l'icône de secours. */
  rounded?: 'md' | 'lg' | 'xl' | 'full';
  /** Classes du conteneur. */
  className?: string;
  /** Classes de l'image. */
  imgClassName?: string;
  /** Classes supplémentaires de l'icône de secours. */
  iconClassName?: string;
  /** Taille réelle d'affichage, utilisée pour choisir la variante via `srcset`. */
  sizes?: string;
  /** false = chargement immédiat (image visible d'entrée). */
  lazy?: boolean;
}

/**
 * Image d'un produit avec repli automatique, dans cet ordre :
 *   1. photo personnalisée du commerçant (`image_url`) ;
 *   2. image standard correspondant à `image_key` ;
 *   3. icône de la catégorie.
 *
 * Aucune image cassée n'est jamais affichée : si le fichier est absent ou si le
 * hors-ligne n'a pas encore la ressource, on retombe sur l'icône et la vente
 * n'est jamais bloquée.
 */
export function ProductImage({
  product,
  iconSize = 40,
  rounded = 'full',
  className,
  imgClassName,
  iconClassName,
  sizes = '160px',
  lazy = true,
}: Props) {
  const src = resolveProductImageSrc(product);
  const srcSet = resolveProductImageSrcSet(product);
  const [broken, setBroken] = useState(false);

  // Nouvelle source (ou nouveau produit) : on retente l'affichage de l'image.
  useEffect(() => { setBroken(false); }, [src]);

  // Les attributs `width`/`height` donnent les dimensions intrinsèques : le
  // navigateur réserve la place avant le chargement (aucun décalage de mise en
  // page). Le rendu réel reste piloté par les classes CSS de l'appelant.
  if (src && !broken) {
    return (
     <img
  src={src}
  srcSet={srcSet}
  sizes={srcSet ? sizes : undefined}
  width={256}
  height={256}
  alt={product.name}
  loading={lazy ? 'lazy' : 'eager'}
  decoding="async"
  draggable={false}
  onError={() => setBroken(true)}
  className={classNames('block h-full w-full object-contain', imgClassName)}
/>
    );
  }

  return (
    <div className={className}>
      <CategoryIcon slug={product.category?.slug} size={iconSize} rounded={rounded} className={iconClassName} />
    </div>
  );
}
