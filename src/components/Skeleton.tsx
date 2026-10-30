import { classNames } from '@/lib/format';

/** Bloc gris animé utilisé pendant le chargement des données. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={classNames('animate-pulse rounded-xl bg-slate-200/70', className)} />;
}

/** Carte squelette façon produit / liste. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <Skeleton className="h-24 w-full rounded-xl" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={classNames('mt-2 h-3', i === 0 ? 'w-3/4' : 'w-1/2')} />
      ))}
    </div>
  );
}

/** Ligne squelette pour les listes (historique, employés…). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100">
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-12 shrink-0" />
    </div>
  );
}
