import {
  Hammer, Wrench, Plug, PaintRoller, HardHat, Lock, Drill, Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryColor } from '@/types';

interface CategoryMeta {
  icon: LucideIcon;
  color: CategoryColor;
}

/**
 * Icône et couleur de secours des 8 catégories de référence.
 * Utilisées quand un produit n'a pas encore d'image (voir `ProductImage`).
 * Les slugs « hérités » pointent vers la catégorie la plus proche afin qu'une
 * base pas encore migrée reste lisible (aucune image cassée, aucune erreur).
 */
const SLUG_MAP: Record<string, CategoryMeta> = {
  // 8 catégories de référence
  'maconnerie':      { icon: HardHat,     color: 'orange' },
  'quincaillerie':   { icon: Hammer,      color: 'slate' },
  'plomberie':       { icon: Wrench,      color: 'blue' },
  'electricite':     { icon: Plug,        color: 'yellow' },
  'peinture':        { icon: PaintRoller, color: 'violet' },
  'menuiserie':      { icon: Lock,        color: 'red' },
  'electroportatif': { icon: Drill,       color: 'cyan' },
  'luminaires':      { icon: Lightbulb,   color: 'amber' },

  // Slugs hérités (anciennes catégories, avant migration)
  'gros-oeuvre':     { icon: HardHat,     color: 'orange' },
  'serrurerie':      { icon: Lock,        color: 'red' },
  'outillage':       { icon: Hammer,      color: 'slate' },
  'materiel-lourd':  { icon: Drill,       color: 'cyan' },
};

const DEFAULT_META: CategoryMeta = { icon: HardHat, color: 'blue' };

export function categoryMeta(slug: string | null | undefined): CategoryMeta {
  if (!slug) return DEFAULT_META;
  return SLUG_MAP[slug] ?? DEFAULT_META;
}
