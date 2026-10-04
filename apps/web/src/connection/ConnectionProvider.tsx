import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ApiClient } from '../api/client';
import { ConnectionMonitor, type ConnectionSnapshot, probeHealth } from './monitor';

const ConnectionContext = createContext<ConnectionMonitor | null>(null);

const ONLINE: ConnectionSnapshot = { status: 'online', checking: false };

/** Hält den Monitor und startet ihn, solange die App läuft. `monitor` ersetzt ihn nur in Tests. */
export function ConnectionProvider({
  client,
  monitor: given,
  children,
}: {
  client: ApiClient;
  monitor?: ConnectionMonitor;
  children: ReactNode;
}) {
  const monitor = useMemo(
    () => given ?? new ConnectionMonitor({ probe: () => probeHealth(client.fetcher) }),
    [given, client],
  );

  // Layout-Effekt, damit der Hook vor den ersten Anfragen der Kinder steht (deren Effekte laufen danach): Ein Mac,
  // der beim Start schläft, wird so sofort erkannt und die App lädt von selbst, sobald er antwortet.
  useLayoutEffect(() => {
    const stop = monitor.start();
    client.onNetworkError = () => monitor.noteNetworkError();
    return () => {
      stop();
      client.onNetworkError = undefined;
    };
  }, [monitor, client]);

  return <ConnectionContext.Provider value={monitor}>{children}</ConnectionContext.Provider>;
}

/** Zustand der Verbindung. Ohne Provider (Tests einzelner Ansichten) gilt „online“. */
export function useConnection(): ConnectionSnapshot & { retry: () => void } {
  const monitor = useContext(ConnectionContext);
  const snapshot = useSyncExternalStore(
    monitor?.subscribe ?? (() => () => {}),
    monitor?.getSnapshot ?? (() => ONLINE),
  );
  return { ...snapshot, retry: () => void monitor?.check() };
}

/** Ruft `handler`, wenn der Server nach einem Ausfall wieder antwortet. */
export function useOnRecovered(handler: () => void): void {
  const monitor = useContext(ConnectionContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => monitor?.onRecovered(() => latest.current()), [monitor]);
}
