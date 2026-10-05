import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppState } from '../../shared/types';

/** Strips Electron's "Error invoking remote method …" wrapper from IPC errors. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/**
 * The main window's copy of the app state. Loaded once, then kept current by
 * patches from main. Patches that arrive before the first load are queued so
 * none of them is lost.
 */
export function useAppState(): [AppState | null, (next: AppState) => void] {
  const [state, setState] = useState<AppState | null>(null);
  const queued = useRef<Array<Partial<AppState>>>([]);
  const loaded = useRef(false);

  useEffect(() => {
    let mounted = true;

    const offPatch = window.yap.onStatePatch((patch) => {
      if (!loaded.current) {
        queued.current.push(patch);
        return;
      }
      setState((previous) => (previous ? { ...previous, ...patch } : previous));
    });
    const offStatus = window.yap.onStatus((status) => {
      setState((previous) => (previous ? { ...previous, status } : previous));
    });

    void window.yap.getState().then((initial) => {
      if (!mounted) return;
      loaded.current = true;
      const merged = queued.current.reduce<AppState>((accumulated, patch) => ({ ...accumulated, ...patch }), initial);
      queued.current = [];
      setState(merged);
    });

    return () => {
      mounted = false;
      offPatch();
      offStatus();
    };
  }, []);

  const replace = useCallback((next: AppState) => setState(next), []);
  return [state, replace];
}

/** Runs async UI actions with a busy flag and a readable error. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(describeError(caught));
      return undefined;
    } finally {
      setBusy((current) => (current === label ? null : current));
    }
  }, []);

  return { busy, error, run, clearError: () => setError(null) };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export const isMac = navigator.userAgent.includes('Mac');
