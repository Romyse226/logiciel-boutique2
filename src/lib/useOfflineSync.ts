import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingOperation, ProductInput } from '@/types';
import { registerSale, recordArrival, saveProduct, isSupabaseConfigured, pingSupabase } from '@/lib/supabase';
import type { RegisterSaleInput, Actor } from '@/lib/supabase';

const STORAGE_KEY = 'quincaillerie.pendingOps';

function loadPending(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PendingOperation[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function savePending(ops: PendingOperation[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ops)); } catch { /* ignore */ }
}

export interface OfflineState {
  online: boolean;
  pending: PendingOperation[];
  syncing: boolean;
  lastSyncError: string | null;
  enqueue: (op: Omit<PendingOperation, 'id' | 'createdAt' | 'attempts'>) => void;
  removePending: (id: string) => void;
  syncNow: () => Promise<void>;
}

export function useOfflineSync(): OfflineState {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  const [pending, setPending] = useState<PendingOperation[]>(() => loadPending());
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const tickRef = useRef(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => { savePending(pending); }, [pending]);

  const enqueue = useCallback((op: Omit<PendingOperation, 'id' | 'createdAt' | 'attempts'>) => {
    const item: PendingOperation = {
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      attempts: 0,
      ...op,
    };
    setPending((prev) => [...prev, item]);
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    if (!isSupabaseConfigured) { setLastSyncError('Supabase non configuré'); return; }
    setSyncing(true);
    setLastSyncError(null);
    try {
      const ok = await pingSupabase();
      setOnline(ok);
      if (!ok) { setLastSyncError('Cloud injoignable'); setSyncing(false); return; }

      const ops = loadPending();
      const stillPending: PendingOperation[] = [];
      for (const op of ops) {
        try {
          if (op.type === 'sale') {
            const payload = op.payload as RegisterSaleInput;
            const res = await registerSale(payload);
            if (!res.ok) throw new Error(res.error ?? 'Échec vente');
          } else if (op.type === 'arrival') {
            const payload = op.payload as { productId: string; quantity: number; note: string | null; createdBy: string | null };
            const res = await recordArrival(payload.productId, payload.quantity, payload.note, payload.createdBy);
            if (!res.ok) throw new Error(res.error ?? 'Échec arrivage');
          } else if (op.type === 'adjust_stock') {
            const payload = op.payload as { mode: 'create' | 'update' | 'archive'; input: ProductInput; actor: Actor };
            const res = await saveProduct(payload.mode, payload.input, payload.actor);
            if (!res.ok) throw new Error(res.error ?? 'Échec modification du stock');
          }
        } catch (e) {
          stillPending.push({ ...op, attempts: op.attempts + 1, lastError: (e as Error).message });
        }
      }
      setPending(stillPending);
      if (stillPending.length > 0) {
        setLastSyncError(`${stillPending.length} opération(s) en échec`);
      }
    } catch (e) {
      setLastSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // Auto-sync when back online
  useEffect(() => {
    if (online && pending.length > 0 && !syncing) {
      tickRef.current += 1;
      syncNow();
    }
  }, [online, pending.length, syncing, syncNow]);

  return { online, pending, syncing, lastSyncError, enqueue, removePending, syncNow };
}
