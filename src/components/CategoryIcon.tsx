import { categoryMeta } from '@/lib/categoryMeta';
import { colorOf } from '@/lib/colors';
import { classNames } from '@/lib/format';
import type { LucideIcon } from 'lucide-react';

interface Props {
  slug: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: 'md' | 'lg' | 'xl' | 'full';
}

export function CategoryIcon({ slug, size = 24, className, rounded = 'xl' }: Props) {
  const { icon: Icon, color } = categoryMeta(slug);
  const c = colorOf(color);
  const roundClass = rounded === 'full' ? 'rounded-full' : `rounded-${rounded}`;
  return (
    <span
      className={classNames(
        'inline-flex items-center justify-center text-white shadow-sm shrink-0',
        c.bg,
        roundClass,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={2.2} />
    </span>
  );
}

export function categoryIconComponent(slug: string | null | undefined): LucideIcon {
  return categoryMeta(slug).icon;
}
