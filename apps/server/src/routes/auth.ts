import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service';
import { clearSessionCookie, setSessionCookie } from '../auth/http';
import type { SessionService } from '../auth/sessions';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';

const SetupBody = z.object({
  setupCode: z.string().min(1).max(64),
  passcode: z.string().min(1).max(512),
});
const LoginBody = z.object({ passcode: z.string().min(1).max(512) });
const ChangeBody = z.object({
  current: z.string().min(1).max(512),
  next: z.string().min(1).max(512),
});

export interface AuthRouteDeps {
  auth: AuthService;
  sessions: SessionService;
}

/** Routen für Einrichtung, Anmeldung und Sitzung. Jede Antwort enthält nur Codes, keine Pfade. */
export function authRoutes({ auth, sessions }: AuthRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Nur für die eigenen Pfade, damit die Grenze nicht auf andere Routen unter /api durchschlägt.
  app.use('/auth/*', limitBody(16 * 1024));

  // Wo steht die Anmeldung? Das darf auch unangemeldet jeder erfahren.
  app.get('/session', (c) => {
    if (!auth.isConfigured()) return c.json({ state: 'setup' });
    const session = c.get('session');
    if (!session) return c.json({ state: 'locked' });
    return c.json({ state: 'unlocked', csrfToken: session.csrfToken });
  });

  app.post('/auth/setup', async (c) => {
    const body = await readJson(c, SetupBody);
    if (!body.ok) return body.response;

    const result = await auth.setup(body.data);
    if (result.ok) {
      setSessionCookie(c, result.session.token, result.session.maxAgeSeconds);
      return c.json({ csrfToken: result.session.csrfToken }, 201);
    }
    switch (result.reason) {
      case 'already_configured':
        return c.json({ error: 'already_configured' }, 409);
      case 'invalid_setup_code':
        return c.json({ error: 'invalid_setup_code' }, 403);
      case 'passcode_too_short':
      case 'passcode_too_long':
        return c.json({ error: 'invalid_input', field: 'passcode', reason: result.reason }, 400);
      case 'rate_limited':
        c.header('Retry-After', String(result.retryAfterSeconds));
        return c.json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
  });

  app.post('/auth/login', async (c) => {
    const body = await readJson(c, LoginBody);
    if (!body.ok) return body.response;

    const result = await auth.login(body.data.passcode);
    if (result.ok) {
      setSessionCookie(c, result.session.token, result.session.maxAgeSeconds);
      return c.json({ csrfToken: result.session.csrfToken });
    }
    switch (result.reason) {
      case 'not_configured':
        return c.json({ error: 'not_configured' }, 409);
      case 'invalid_passcode':
        return c.json({ error: 'invalid_passcode' }, 401);
      case 'rate_limited':
        c.header('Retry-After', String(result.retryAfterSeconds));
        return c.json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
  });

  app.post('/auth/logout', (c) => {
    sessions.revoke(c.get('sessionToken') ?? undefined);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.post('/auth/passcode', async (c) => {
    if (!c.get('session')) return c.json({ error: 'unauthorized' }, 401);
    const body = await readJson(c, ChangeBody);
    if (!body.ok) return body.response;

    const result = await auth.changePasscode(body.data, c.get('sessionToken') ?? undefined);
    if (result.ok) return c.body(null, 204);
    switch (result.reason) {
      // Bewusst 403 statt 401: Die Oberfläche soll hier nicht zur Anmeldung zurückspringen.
      case 'invalid_passcode':
        return c.json({ error: 'invalid_passcode' }, 403);
      case 'passcode_too_short':
      case 'passcode_too_long':
        return c.json({ error: 'invalid_input', field: 'next', reason: result.reason }, 400);
      case 'rate_limited':
        c.header('Retry-After', String(result.retryAfterSeconds));
        return c.json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
  });

  return app;
}
