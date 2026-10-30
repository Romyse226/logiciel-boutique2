import { classNames } from '@/lib/format';

interface Props {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  error: string | null;
  onSync: () => void;
}

export function OfflineBanner({ online, pendingCount, syncing, error, onSync }: Props) {
  if (online && pendingCount === 0 && !error) return null;
  return (
    <div className={classNames(
      'mb-3 flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold ring-1',
      online ? 'bg-blue-50 text-blue-800 ring-blue-200' : 'bg-amber-50 text-amber-900 ring-amber-200',
    )}>
      <div className="flex items-center gap-2">
        <span className={classNames('h-2.5 w-2.5 rounded-full', online ? 'bg-blue-500' : 'bg-amber-500 animate-pulse')} />
        {online
          ? `${pendingCount} opération(s) en attente de synchronisation`
          : `Mode hors-ligne — ${pendingCount} opération(s) seront envoyées au retour du réseau`}
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={!online || syncing}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
      >
        {syncing ? 'Sync…' : 'Synchroniser'}
      </button>
    </div>
  );
}
