import { useCallback, useEffect, useState } from 'react';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; version: string }
  | { status: 'error' };

/** Fragt /api/health ab. `retry` prüft erneut. */
export function useHealth(): { state: HealthState; retry: () => void } {
  const [state, setState] = useState<HealthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` löst die erneute Prüfung aus
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch('/api/health', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { status?: string; version?: string };
        if (body.status !== 'ok') throw new Error('unerwartete Antwort');
        setState({ status: 'ok', version: body.version ?? '?' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}
