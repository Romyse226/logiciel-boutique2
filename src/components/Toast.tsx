import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { vibrate } from '@/lib/format';

interface ToastItem {
  id: number;
  message: string;
}

interface ToastContextValue {
  notify: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const notify = useCallback((message: string) => {
    vibrate(30);
    const id = (seq.current += 1);
    setItems((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 3500);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
        {items.map((i) => (
          <div
            key={i.id}
            role="status"
            className="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl bg-slate-900/95 px-4 py-3 text-sm font-semibold text-white shadow-xl ring-1 ring-white/10"
          >
            <Info size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <span>{i.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
