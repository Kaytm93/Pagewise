import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, migrateDatabase, openDatabase } from '../db/client';
import { sessions as sessionsTable } from '../db/schema';
import { SessionService } from './sessions';

const DAY = 24 * 60 * 60 * 1000;

describe('SessionService', () => {
  let handle: DatabaseHandle;
  let now: number;
  let service: SessionService;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateDatabase(handle);
    now = Date.UTC(2026, 9, 3, 12, 0, 0);
    service = new SessionService(handle.db, { now: () => new Date(now) });
  });
  afterEach(() => handle.close());

  it('legt eine Sitzung an und erkennt sie wieder', () => {
    const created = service.create();
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.csrfToken).not.toBe(created.token);
    expect(created.maxAgeSeconds).toBe(30 * 24 * 60 * 60);

    const active = service.validate(created.token);
    expect(active?.csrfToken).toBe(created.csrfToken);
  });

  it('speichert nur den Hash des Tokens, nie das Token selbst', () => {
    const created = service.create();
    const rows = handle.db.select().from(sessionsTable).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(created.token);
  });

  it.each([undefined, '', 'kurz', 'x'.repeat(44), `${'a'.repeat(42)}!`, 'a'.repeat(43)])(
    'lehnt das Token %j ab',
    (token) => {
      service.create();
      expect(service.validate(token)).toBeNull();
    },
  );

  it('lässt eine Sitzung nach 30 Tagen Untätigkeit ablaufen und entfernt sie', () => {
    const { token } = service.create();
    now += 30 * DAY;
    expect(service.validate(token)).toBeNull();
    expect(handle.db.select().from(sessionsTable).all()).toEqual([]);
  });

  it('verlängert die Laufzeit bei Nutzung, höchstens einmal pro Minute', () => {
    const { token } = service.create();
    now += 10_000;
    expect(service.validate(token)?.renewed).toBe(false);
    now += 60_000;
    const renewed = service.validate(token);
    expect(renewed?.renewed).toBe(true);
    expect(renewed?.maxAgeSeconds).toBe(30 * 24 * 60 * 60);

    now += 20 * DAY;
    expect(service.validate(token)).not.toBeNull();
    now += 20 * DAY;
    expect(service.validate(token)).not.toBeNull();
  });

  it('beendet jede Sitzung spätestens nach 90 Tagen, auch bei Dauernutzung', () => {
    const { token } = service.create();
    for (let day = 1; day <= 89; day++) {
      now += DAY;
      expect(service.validate(token)).not.toBeNull();
    }
    now += DAY;
    expect(service.validate(token)).toBeNull();
  });

  it('kappt die verbleibende Laufzeit am 90-Tage-Ende', () => {
    const { token } = service.create();
    let active = service.validate(token);
    for (let step = 0; step < 4; step++) {
      now += 20 * DAY;
      active = service.validate(token);
    }
    expect(active?.maxAgeSeconds).toBe(10 * 24 * 60 * 60);
  });

  it('beendet eine Sitzung mit revoke()', () => {
    const { token } = service.create();
    service.revoke(token);
    expect(service.validate(token)).toBeNull();
    expect(() => service.revoke(undefined)).not.toThrow();
  });

  it('beendet alle Sitzungen außer der angegebenen', () => {
    const keep = service.create();
    const other = service.create();
    service.revokeAll(keep.token);
    expect(service.validate(keep.token)).not.toBeNull();
    expect(service.validate(other.token)).toBeNull();

    service.revokeAll();
    expect(service.validate(keep.token)).toBeNull();
  });

  it('räumt abgelaufene Sitzungen auf', () => {
    service.create();
    service.create();
    now += 31 * DAY;
    const fresh = service.create();
    expect(service.purgeExpired()).toBe(2);
    expect(service.validate(fresh.token)).not.toBeNull();
  });
});
