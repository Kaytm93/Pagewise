import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '../services';
import { createHarness, type Harness, TEST_PASSCODE } from '../test-harness';

const passcode = TEST_PASSCODE;

describe('Auth-API', () => {
  let harness: Harness;
  let services: Services;

  beforeEach(() => {
    harness = createHarness();
    services = harness.services;
  });
  afterEach(() => harness.close());

  const call: Harness['call'] = (method, path, options) => harness.call(method, path, options);
  const pair = (setCookie: string | null): string => harness.pair(setCookie);
  async function setUp(): Promise<{ cookie: string; csrf: string }> {
    const { cookie, csrf } = await harness.signIn();
    return { cookie, csrf };
  }

  describe('GET /api/session', () => {
    it('meldet vor der Einrichtung „setup“ und verrät keinen Code', async () => {
      const reply = await call('GET', '/api/session');
      expect(reply.body).toEqual({ state: 'setup' });
      expect(reply.text).not.toContain(services.auth.pendingSetupCode() ?? 'kein-code');
    });

    it('meldet nach der Einrichtung „locked“ ohne und „unlocked“ mit Sitzung', async () => {
      const { cookie, csrf } = await setUp();
      expect((await call('GET', '/api/session')).body).toEqual({ state: 'locked' });
      expect((await call('GET', '/api/session', { cookie })).body).toEqual({
        state: 'unlocked',
        csrfToken: csrf,
      });
    });

    it('behandelt einen unbekannten Cookie als abgemeldet', async () => {
      await setUp();
      const reply = await call('GET', '/api/session', {
        cookie: `pagewise_session=${'a'.repeat(43)}`,
      });
      expect(reply.body).toEqual({ state: 'locked' });
    });
  });

  describe('Einrichtung', () => {
    it('lehnt einen falschen Einrichtungscode mit 403 ab', async () => {
      const reply = await call('POST', '/api/auth/setup', {
        body: { setupCode: 'AAAAA-AAAAA', passcode },
      });
      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ error: 'invalid_setup_code' });
      expect(reply.cookie).toBeNull();
    });

    it('lehnt einen zu kurzen Passcode mit 400 ab', async () => {
      const reply = await call('POST', '/api/auth/setup', {
        body: { setupCode: services.auth.pendingSetupCode(), passcode: 'kurz' },
      });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({
        error: 'invalid_input',
        field: 'passcode',
        reason: 'passcode_too_short',
      });
    });

    it('legt Passcode und Sitzung an und setzt einen sicheren Cookie', async () => {
      const reply = await call('POST', '/api/auth/setup', {
        body: { setupCode: services.auth.pendingSetupCode(), passcode },
      });
      expect(reply.status).toBe(201);
      expect(typeof reply.body.csrfToken).toBe('string');
      expect(reply.cookie).toMatch(/^pagewise_session=[A-Za-z0-9_-]{43};/);
      expect(reply.cookie).toContain('HttpOnly');
      expect(reply.cookie).toContain('SameSite=Strict');
      expect(reply.cookie).toContain('Path=/');
      expect(reply.cookie).toMatch(/Max-Age=\d+/);
      expect(reply.cookie).not.toContain('Secure');
      expect(reply.text).not.toContain(passcode);
    });

    it('setzt „Secure“, wenn die Anfrage per HTTPS ankam (Tailscale Serve)', async () => {
      const reply = await call('POST', '/api/auth/setup', {
        body: { setupCode: services.auth.pendingSetupCode(), passcode },
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(reply.cookie).toContain('Secure');
    });

    it('richtet nur einmal ein', async () => {
      const code = services.auth.pendingSetupCode();
      await call('POST', '/api/auth/setup', { body: { setupCode: code, passcode } });
      const second = await call('POST', '/api/auth/setup', {
        body: { setupCode: code, passcode: 'ein anderer Passcode' },
      });
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'already_configured' });
    });
  });

  describe('Anmeldung', () => {
    beforeEach(async () => {
      await setUp();
    });

    it('meldet mit dem richtigen Passcode an', async () => {
      const reply = await call('POST', '/api/auth/login', { body: { passcode } });
      expect(reply.status).toBe(200);
      expect(reply.cookie).toContain('HttpOnly');
      expect(reply.text).not.toContain(passcode);
      const session = await call('GET', '/api/session', { cookie: pair(reply.cookie) });
      expect(session.body.state).toBe('unlocked');
    });

    it('antwortet auf einen falschen Passcode mit 401 und setzt keinen Cookie', async () => {
      const reply = await call('POST', '/api/auth/login', {
        body: { passcode: 'falscher Passcode' },
      });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'invalid_passcode' });
      expect(reply.cookie).toBeNull();
    });

    it('sperrt nach drei Fehlversuchen mit 429 und Retry-After', async () => {
      for (let i = 0; i < 3; i++) {
        await call('POST', '/api/auth/login', { body: { passcode: 'falscher Passcode' } });
      }
      const reply = await call('POST', '/api/auth/login', { body: { passcode } });
      expect(reply.status).toBe(429);
      expect(reply.body.error).toBe('rate_limited');
      expect(Number(reply.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(reply.cookie).toBeNull();
    });
  });

  describe('Abmelden und CSRF-Schutz', () => {
    it('verlangt das CSRF-Token bei ändernden Anfragen mit Sitzung', async () => {
      const { cookie, csrf } = await setUp();
      const missing = await call('POST', '/api/auth/logout', { cookie });
      expect(missing.status).toBe(403);
      expect(missing.body).toEqual({ error: 'csrf' });

      const wrong = await call('POST', '/api/auth/logout', { cookie, csrf: `${csrf}x` });
      expect(wrong.status).toBe(403);

      // Die Sitzung lebt noch.
      expect((await call('GET', '/api/session', { cookie })).body.state).toBe('unlocked');
    });

    it('beendet die Sitzung mit dem richtigen Token und löscht den Cookie', async () => {
      const { cookie, csrf } = await setUp();
      const reply = await call('POST', '/api/auth/logout', { cookie, csrf });
      expect(reply.status).toBe(204);
      expect(reply.cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      expect((await call('GET', '/api/session', { cookie })).body.state).toBe('locked');
    });

    it('lehnt Anfragen ab, die der Browser als Cross-Site kennzeichnet', async () => {
      await setUp();
      for (const site of ['cross-site', 'same-site']) {
        const reply = await call('POST', '/api/auth/login', {
          body: { passcode },
          headers: { 'sec-fetch-site': site },
        });
        expect(reply.status).toBe(403);
        expect(reply.body).toEqual({ error: 'csrf' });
      }
      const sameOrigin = await call('POST', '/api/auth/login', {
        body: { passcode },
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(sameOrigin.status).toBe(200);
    });
  });

  describe('Passcode ändern', () => {
    it('verlangt eine Sitzung', async () => {
      await setUp();
      const reply = await call('POST', '/api/auth/passcode', {
        body: { current: passcode, next: 'ein neuer erfundener Passcode' },
      });
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ error: 'unauthorized' });
    });

    it('antwortet auf einen falschen aktuellen Passcode mit 403 (nicht 401)', async () => {
      const { cookie, csrf } = await setUp();
      const reply = await call('POST', '/api/auth/passcode', {
        cookie,
        csrf,
        body: { current: 'falscher Passcode', next: 'ein neuer erfundener Passcode' },
      });
      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ error: 'invalid_passcode' });
    });

    it('ändert den Passcode und beendet andere Sitzungen', async () => {
      const { cookie, csrf } = await setUp();
      const other = await call('POST', '/api/auth/login', { body: { passcode } });
      const next = 'ein neuer erfundener Passcode';

      const reply = await call('POST', '/api/auth/passcode', {
        cookie,
        csrf,
        body: { current: passcode, next },
      });
      expect(reply.status).toBe(204);

      expect((await call('GET', '/api/session', { cookie })).body.state).toBe('unlocked');
      expect((await call('GET', '/api/session', { cookie: pair(other.cookie) })).body.state).toBe(
        'locked',
      );
      expect((await call('POST', '/api/auth/login', { body: { passcode: next } })).status).toBe(
        200,
      );
    });
  });

  describe('Eingaben', () => {
    it('antwortet auf ungültiges JSON mit 400', async () => {
      const reply = await call('POST', '/api/auth/login', {
        rawBody: '{kaputt',
        headers: { 'content-type': 'application/json' },
      });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_json' });
    });

    it('nennt bei fehlenden Feldern den Feldnamen, nie die Eingabe', async () => {
      const reply = await call('POST', '/api/auth/login', { body: { passwort: 'falsches Feld' } });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'passcode' });
      expect(reply.text).not.toContain('falsches Feld');
    });

    it('lehnt zu große Körper mit 413 ab', async () => {
      const reply = await call('POST', '/api/auth/login', {
        rawBody: JSON.stringify({ passcode: 'x'.repeat(20_000) }),
        headers: { 'content-type': 'application/json' },
      });
      expect(reply.status).toBe(413);
      expect(reply.body).toEqual({ error: 'payload_too_large' });
    });
  });

  it('lässt /api/health ohne Anmeldung zu und verbietet Caching der Auth-Antworten', async () => {
    expect((await call('GET', '/api/health')).status).toBe(200);
    const reply = await call('GET', '/api/session');
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it('antwortet auf unbekannte API-Pfade weiter mit 404', async () => {
    const reply = await call('GET', '/api/gibt-es-nicht');
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ error: 'not_found' });
  });
});
