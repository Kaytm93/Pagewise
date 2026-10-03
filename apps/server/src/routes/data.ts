import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { DataEraser } from '../storage/eraser';

const EraseBody = z.strictObject({ passcode: z.string().min(1).max(512) });

export interface DataRouteDeps {
  auth: AuthService;
  eraser: DataEraser;
}

/** Verwaltung der eigenen Daten. Bisher: „Alles löschen“. */
export function dataRoutes({ auth, eraser }: DataRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/data/*', limitBody(4 * 1024));

  // Löscht alle Inhalte unwiderruflich. Verlangt den Passcode, auch mit gültiger Sitzung.
  app.post('/data/erase', async (c) => {
    const body = await readJson(c, EraseBody);
    if (!body.ok) return body.response;

    const check = await auth.confirmPasscode(body.data.passcode);
    if (!check.ok) {
      if (check.reason === 'rate_limited') {
        c.header('Retry-After', String(check.retryAfterSeconds));
        return c.json({ error: 'rate_limited', retryAfterSeconds: check.retryAfterSeconds }, 429);
      }
      // 403 statt 401: Die Oberfläche soll hier nicht zur Anmeldung zurückspringen.
      return c.json({ error: 'invalid_passcode' }, 403);
    }
    try {
      await eraser.eraseAll();
    } catch {
      // Nie Pfade oder Meldungen weitergeben. Ein erneuter Versuch räumt den Rest auf.
      return c.json({ error: 'erase_failed' }, 500);
    }
    return c.body(null, 204);
  });

  return app;
}
