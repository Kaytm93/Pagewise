import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type Api, createApi } from '../api/api';
import type { ApiClient } from '../api/client';

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

  const reload = useCallback(async () => {
    try {
      const info = await api.session();
      client.setCsrfToken(info.state === 'unlocked' ? info.csrfToken : null);
      setStatus(info.state);
    } catch {
      client.setCsrfToken(null);
      setStatus('unreachable');
    }
  }, [api, client]);

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
