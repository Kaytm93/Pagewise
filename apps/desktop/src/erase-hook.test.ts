import { describe, expect, it } from 'vitest';
import { ERASE_DATA_TYPES, ERASE_PATH, isEraseSuccess } from './erase-hook';

const ORIGIN = 'http://127.0.0.1:3000';
const ok = { method: 'POST', statusCode: 204, url: `${ORIGIN}${ERASE_PATH}` };

describe('„Alles löschen“ leert auch die Fensterdaten', () => {
  it('reagiert nur auf die bestätigte Löschung', () => {
    expect(isEraseSuccess(ok, ORIGIN)).toBe(true);
    expect(isEraseSuccess({ ...ok, statusCode: 403 }, ORIGIN)).toBe(false);
    expect(isEraseSuccess({ ...ok, statusCode: 500 }, ORIGIN)).toBe(false);
    expect(isEraseSuccess({ ...ok, method: 'GET' }, ORIGIN)).toBe(false);
    expect(isEraseSuccess({ ...ok, url: `${ORIGIN}/api/data/erase/` }, ORIGIN)).toBe(false);
    expect(isEraseSuccess({ ...ok, url: 'http://127.0.0.1:3001/api/data/erase' }, ORIGIN)).toBe(
      false,
    );
    expect(isEraseSuccess({ ...ok, url: `${ORIGIN}/api/data/erase?x=1` }, ORIGIN)).toBe(false);
  });

  it('leert Speicher, Cache und Service Worker, aber nicht die Cookies (die Anmeldung bleibt wie im Server)', () => {
    expect([...ERASE_DATA_TYPES].sort()).toEqual(
      ['cache', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'].sort(),
    );
    expect(ERASE_DATA_TYPES as readonly string[]).not.toContain('cookies');
  });
});
