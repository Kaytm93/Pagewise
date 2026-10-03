import type { ActiveSession } from '../auth/sessions';

/** Was die Middleware an die Routen weitergibt. */
export type AppEnv = {
  Variables: {
    session: ActiveSession | null;
    sessionToken: string | null;
  };
};
