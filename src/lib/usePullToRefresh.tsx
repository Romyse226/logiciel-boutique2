import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { classNames } from '@/lib/format';

/** Distance (px) à tirer pour déclencher le rafraîchissement. */
const THRESHOLD = 64;
/** Limite d'étirement (px). */
const MAX_PULL = 96;

/** Vrai si le toucher démarre dans une superposition fixe (modale, barre du bas…). */
function insideOverlay(el: EventTarget | null): boolean {
  let node: Element | null = el instanceof Element ? el : null;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Tirer vers le bas depuis le haut de la page pour rafraîchir / synchroniser.
 * Ne se déclenche que si la page est déjà en haut (window.scrollY === 0).
 */
export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const busyRef = useRef(false);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    function reset() {
      distanceRef.current = 0;
      setDistance(0);
    }

    function onStart(e: TouchEvent) {
      if (busyRef.current || e.touches.length !== 1 || window.scrollY > 0 || insideOverlay(e.target)) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    }

    function onMove(e: TouchEvent) {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        if (dy < 0) startY.current = null;
        if (distanceRef.current !== 0) reset();
        return;
      }
      const next = Math.min(MAX_PULL, dy * 0.5);
      distanceRef.current = next;
      setDistance(next);
      if (e.cancelable) e.preventDefault();
    }

    function onEnd() {
      if (startY.current === null) return;
      startY.current = null;
      if (distanceRef.current < THRESHOLD) { reset(); return; }
      busyRef.current = true;
      setRefreshing(true);
      distanceRef.current = THRESHOLD;
      setDistance(THRESHOLD);
      Promise.resolve()
        .then(() => cbRef.current())
        .catch(() => undefined)
        .then(() => {
          busyRef.current = false;
          setRefreshing(false);
          reset();
        });
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return { distance, refreshing, threshold: THRESHOLD };
}

/** Indicateur circulaire affiché pendant l'étirement puis la synchronisation. */
export function PullToRefreshBar({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  if (distance === 0 && !refreshing) return null;
  return (
    <div className="flex items-end justify-center overflow-hidden" style={{ height: distance }}>
      <Loader2
        size={26}
        className={classNames('mb-1.5 text-orange-500', refreshing ? 'animate-spin' : 'opacity-60')}
      />
    </div>
  );
}
