import { useEffect } from 'react';
import type { SeamsWeb } from '@/SeamsWeb';

type IdleCapableWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function useEagerPrewarm(seams: SeamsWeb, eager?: boolean) {
  useEffect(() => {
    if (!eager) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const win = window as IdleCapableWindow;

    const run = async () => {
      if (cancelled) return;
      try {
        await seams.prewarm({ iframe: true, workers: true });
      } catch {
        // best-effort
      }
    };

    let idleId: number | undefined;
    let timeoutId: number | undefined;

    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(
        () => {
          void run();
        },
        { timeout: 1500 },
      ) as number;
    } else {
      timeoutId = window.setTimeout(() => {
        void run();
      }, 600);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof win.cancelIdleCallback === 'function') {
        try {
          win.cancelIdleCallback(idleId);
        } catch {}
      }
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    };
  }, [eager, seams]);
}
