import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, migrateDatabase, openDatabase } from '../db/client';
import { AttemptLimiter } from './attempt-limiter';
import { AuthService } from './auth-service';
import { SessionService } from './sessions';

const fast = { N: 16, r: 8, p: 1 };
const passcode = 'ein erfundener Beispiel-Passcode';

describe('AuthService', () => {
  let handle: DatabaseHandle;
  let sessions: SessionService;
  let auth: AuthService;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateDatabase(handle);
    sessions = new SessionService(handle.db);
    auth = new AuthService({
      db: handle.db,
      sessions,
      limiter: new AttemptLimiter({ maxFailures: 3 }),
      scryptParams: fast,
    });
  });
  afterEach(() => handle.close());

  function setupCode(): string {
    const code = auth.pendingSetupCode();
    if (!code) throw new Error('Testaufbau: kein Einrichtungscode vorhanden');
    return code;
  }

  describe('Einrichtung', () => {
    it('beginnt unkonfiguriert und hat einen Einrichtungscode', () => {
      expect(auth.isConfigured()).toBe(false);
      expect(auth.pendingSetupCode()).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    });

    it('richtet mit dem richtigen Code ein, meldet an und verwirft den Code', async () => {
      const result = await auth.setup({ setupCode: setupCode(), passcode });
      expect(result.ok).toBe(true);
      if (result.ok) expect(sessions.validate(result.session.token)).not.toBeNull();
      expect(auth.isConfigured()).toBe(true);
      expect(auth.pendingSetupCode()).toBeNull();
    });

    it('akzeptiert den Code in Kleinschreibung ohne Bindestrich', async () => {
      const code = setupCode().replace('-', '').toLowerCase();
      expect((await auth.setup({ setupCode: code, passcode })).ok).toBe(true);
    });

    it('lehnt einen falschen Code ab und richtet nichts ein', async () => {
      const result = await auth.setup({ setupCode: 'AAAAA-AAAAA', passcode });
      expect(result).toEqual({ ok: false, reason: 'invalid_setup_code' });
      expect(auth.isConfigured()).toBe(false);
    });

    it('sperrt nach zu vielen falschen Codes, auch für den richtigen', async () => {
      for (let i = 0; i < 3; i++) await auth.setup({ setupCode: 'AAAAA-AAAAA', passcode });
      const result = await auth.setup({ setupCode: setupCode(), passcode });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('rate_limited');
      expect(auth.isConfigured()).toBe(false);
    });

    it('lehnt zu kurze und zu lange Passcodes ab, ohne den Code zu verbrauchen', async () => {
      const code = setupCode();
      expect(await auth.setup({ setupCode: code, passcode: 'kurz' })).toEqual({
        ok: false,
        reason: 'passcode_too_short',
      });
      expect(await auth.setup({ setupCode: code, passcode: 'x'.repeat(129) })).toEqual({
        ok: false,
        reason: 'passcode_too_long',
      });
      expect((await auth.setup({ setupCode: code, passcode })).ok).toBe(true);
    });

    it('richtet nur ein einziges Mal ein', async () => {
      const code = setupCode();
      expect((await auth.setup({ setupCode: code, passcode })).ok).toBe(true);
      expect(await auth.setup({ setupCode: code, passcode: 'ein anderer Passcode' })).toEqual({
        ok: false,
        reason: 'already_configured',
      });
    });

    it('lässt bei gleichzeitigen Einrichtungen genau eine gewinnen', async () => {
      const code = setupCode();
      const results = await Promise.all([
        auth.setup({ setupCode: code, passcode: 'erster erfundener Passcode' }),
        auth.setup({ setupCode: code, passcode: 'zweiter erfundener Passcode' }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === 'already_configured')).toHaveLength(1);
    });

    it('erzeugt nach einem Neustart ohne Passcode einen neuen Code und mit Passcode keinen', async () => {
      const first = setupCode();
      const restarted = new AuthService({
        db: handle.db,
        sessions,
        limiter: new AttemptLimiter(),
        scryptParams: fast,
      });
      expect(restarted.pendingSetupCode()).not.toBe(first);

      await auth.setup({ setupCode: first, passcode });
      const afterSetup = new AuthService({
        db: handle.db,
        sessions,
        limiter: new AttemptLimiter(),
        scryptParams: fast,
      });
      expect(afterSetup.pendingSetupCode()).toBeNull();
    });
  });

  describe('Anmeldung', () => {
    beforeEach(async () => {
      await auth.setup({ setupCode: setupCode(), passcode });
    });

    it('meldet mit dem richtigen Passcode an', async () => {
      const result = await auth.login(passcode);
      expect(result.ok).toBe(true);
      if (result.ok) expect(sessions.validate(result.session.token)).not.toBeNull();
    });

    it('lehnt falsche Passcodes ab', async () => {
      expect(await auth.login('falscher Passcode')).toEqual({
        ok: false,
        reason: 'invalid_passcode',
      });
    });

    it('sperrt nach drei Fehlversuchen, auch für den richtigen Passcode', async () => {
      for (let i = 0; i < 3; i++) await auth.login('falscher Passcode');
      const result = await auth.login(passcode);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('rate_limited');
    });

    it('setzt die Zählung nach erfolgreicher Anmeldung zurück', async () => {
      await auth.login('falsch 1');
      await auth.login('falsch 2');
      expect((await auth.login(passcode)).ok).toBe(true);
      await auth.login('falsch 3');
      await auth.login('falsch 4');
      expect((await auth.login(passcode)).ok).toBe(true);
    });

    it('begrenzt auch gleichzeitige Versuche', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => auth.login('falscher Passcode')),
      );
      const checked = results.filter((r) => !r.ok && r.reason === 'invalid_passcode');
      const blocked = results.filter((r) => !r.ok && r.reason === 'rate_limited');
      expect(checked).toHaveLength(3);
      expect(blocked).toHaveLength(9);
    });

    it('meldet vor der Einrichtung „nicht eingerichtet“', async () => {
      const fresh = openDatabase(':memory:');
      migrateDatabase(fresh);
      const other = new AuthService({
        db: fresh.db,
        sessions: new SessionService(fresh.db),
        limiter: new AttemptLimiter(),
        scryptParams: fast,
      });
      expect(await other.login(passcode)).toEqual({ ok: false, reason: 'not_configured' });
      fresh.close();
    });
  });

  describe('Passcode ändern', () => {
    const next = 'ein neuer erfundener Passcode';
    let current: string;

    beforeEach(async () => {
      const setup = await auth.setup({ setupCode: setupCode(), passcode });
      if (!setup.ok) throw new Error('Testaufbau fehlgeschlagen');
      current = setup.session.token;
    });

    it('ändert den Passcode, behält die aktuelle Sitzung und beendet die anderen', async () => {
      const other = await auth.login(passcode);
      if (!other.ok) throw new Error('Testaufbau fehlgeschlagen');

      expect(await auth.changePasscode({ current: passcode, next }, current)).toEqual({ ok: true });

      expect(sessions.validate(current)).not.toBeNull();
      expect(sessions.validate(other.session.token)).toBeNull();
      expect((await auth.login(next)).ok).toBe(true);
      expect((await auth.login(passcode)).ok).toBe(false);
    });

    it('verlangt den aktuellen Passcode', async () => {
      expect(await auth.changePasscode({ current: 'falsch falsch', next }, current)).toEqual({
        ok: false,
        reason: 'invalid_passcode',
      });
      expect((await auth.login(passcode)).ok).toBe(true);
    });

    it('lehnt einen zu kurzen neuen Passcode ab, ohne Fehlversuche zu zählen', async () => {
      for (let i = 0; i < 5; i++) {
        expect(await auth.changePasscode({ current: passcode, next: 'kurz' }, current)).toEqual({
          ok: false,
          reason: 'passcode_too_short',
        });
      }
      expect((await auth.changePasscode({ current: passcode, next }, current)).ok).toBe(true);
    });

    it('sperrt nach zu vielen falschen aktuellen Passcodes', async () => {
      for (let i = 0; i < 3; i++)
        await auth.changePasscode({ current: 'falsch falsch', next }, current);
      const result = await auth.changePasscode({ current: passcode, next }, current);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('rate_limited');
    });
  });
});
