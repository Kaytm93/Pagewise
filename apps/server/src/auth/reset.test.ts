import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, migrateDatabase, openDatabase } from '../db/client';
import { subjects } from '../db/schema';
import { AttemptLimiter } from './attempt-limiter';
import { AuthService } from './auth-service';
import { resetAccess } from './reset';
import { SessionService } from './sessions';

describe('resetAccess', () => {
  let handle: DatabaseHandle;
  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateDatabase(handle);
  });
  afterEach(() => handle.close());

  it('entfernt Passcode und Sitzungen, lässt Fächer unberührt und erlaubt eine neue Einrichtung', async () => {
    const sessions = new SessionService(handle.db);
    const make = () =>
      new AuthService({
        db: handle.db,
        sessions,
        limiter: new AttemptLimiter(),
        scryptParams: { N: 16, r: 8, p: 1 },
      });

    const before = make();
    const code = before.pendingSetupCode();
    const setup = await before.setup({
      setupCode: code ?? '',
      passcode: 'ein erfundener Passcode',
    });
    if (!setup.ok) throw new Error('Testaufbau fehlgeschlagen');
    handle.db.insert(subjects).values({ name: 'Beispielfach' }).run();

    resetAccess(handle.db);

    expect(sessions.validate(setup.session.token)).toBeNull();
    expect(handle.db.select().from(subjects).all()).toHaveLength(1);
    const after = make();
    expect(after.isConfigured()).toBe(false);
    expect(after.pendingSetupCode()).not.toBeNull();
  });
});
