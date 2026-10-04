import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Api, createApi } from '../api/api';
import type { ApiClient } from '../api/client';
import { useOnRecovered } from '../connection/ConnectionProvider';
import { LOAD_TIMEOUT_MS, withTimeout } from '../connection/timeout';

/**
 * Wo steht die Anmeldung?
 * - loading / unreachable: der Server wurde noch nicht erreicht bzw. antwortet nicht
 * - setup: noch kein Passcode festgelegt
 * - locked: eingerichtet, aber nicht angemeldet
 * - unlocked: angemeldet
 */
export type SessionStatus = 'loading' | 'unreachable' | 'setup' | 'locked' | 'unlocked';

interface SessionValue {
  status: SessionStatus;
  api: Api;
  reload: () => Promise<void>;
  setup: (setupCode: string, passcode: string) => Promise<void>;
  login: (passcode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession braucht einen SessionProvider');
  return value;
}

export function SessionProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const api = useMemo(() => createApi(client), [client]);
  const [status, setStatus] = useState<SessionStatus>('loading');

  /** `soft`: ein Fehlschlag lässt die geladene Ansicht stehen (kein Vollbild „Server antwortet nicht“). */
  const latest = useRef(0);
  const reload = useCallback(
    async (soft = false) => {
      // Ein spätes Ergebnis einer älteren Anfrage (Zeitlimit, neuer Versuch) darf den Stand nicht überschreiben.
      const mine = ++latest.current;
      try {
        // Ein Mac, der schläft, lässt die Verbindung hängen: nach dem Zeitlimit „nicht erreichbar“ zeigen.
        const info = await withTimeout(api.session(), LOAD_TIMEOUT_MS);
        if (mine !== latest.current) return;
        client.setCsrfToken(info.state === 'unlocked' ? info.csrfToken : null);
        setStatus(info.state);
      } catch {
        if (soft || mine !== latest.current) return;
        client.setCsrfToken(null);
        setStatus('unreachable');
      }
    },
    [api, client],
  );

  // Kommt der Mac nach einem Ausfall zurück, Sitzung nachsehen, ohne die Ansicht zu verlassen (Entwürfe bleiben).
  // Steht die App noch auf „lädt“ oder „nicht erreichbar“, ist das die normale Ladung.
  const statusRef = useRef(status);
  statusRef.current = status;
  useOnRecovered(() => {
    void reload(statusRef.current !== 'loading' && statusRef.current !== 'unreachable');
  });

  // Der Server vergisst die Sitzung (Ablauf, Passcode-Wechsel, Zurücksetzen): neu nachsehen.
  useEffect(() => {
    client.onSessionLost = () => {
      void reload();
    };
    void reload();
    return () => {
      client.onSessionLost = undefined;
    };
  }, [client, reload]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      api,
      reload: async () => {
        setStatus('loading');
        await reload();
      },
      setup: async (setupCode, passcode) => {
        await api.setup(setupCode, passcode);
        setStatus('unlocked');
      },
      login: async (passcode) => {
        await api.login(passcode);
        setStatus('unlocked');
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setStatus('locked');
        }
      },
    }),
    [status, api, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
