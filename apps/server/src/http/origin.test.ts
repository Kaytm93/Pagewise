import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../test-harness';

const HOST = 'pagewise.example.test';

describe('Herkunftsprüfung (strenge CORS-Regel)', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(() => harness.close());

  const corsHeaders = (headers: Headers) =>
    [...headers.keys()].filter((name) => name.startsWith('access-control-'));

  it('lässt Anfragen ohne Origin durch (gleiche Herkunft per GET, Befehlszeile)', async () => {
    const reply = await harness.call('GET', '/api/health');
    expect(reply.status).toBe(200);
  });

  it('lässt die eigene Herkunft durch', async () => {
    const reply = await harness.call('GET', '/api/health', {
      headers: { origin: `https://${HOST}`, host: HOST },
    });
    expect(reply.status).toBe(200);
  });

  it('nimmt hinter einem Proxy den weitergegebenen Rechnernamen', async () => {
    const reply = await harness.call('GET', '/api/health', {
      headers: {
        origin: `https://${HOST}`,
        host: '127.0.0.1:3000',
        'x-forwarded-host': HOST,
      },
    });
    expect(reply.status).toBe(200);
  });

  it.each([
    ['fremde Adresse', 'https://boese.example.test'],
    ['gleicher Name, anderer Port', `https://${HOST}:8443`],
    ['null (z. B. aus einem eingebetteten Rahmen)', 'null'],
    ['kein gültiger Wert', 'kein-origin'],
  ])('lehnt %s ab, ohne etwas auszulösen', async (_name, origin) => {
    for (const [method, path] of [
      ['GET', '/api/health'],
      ['GET', '/api/session'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/data/erase'],
    ] as const) {
      const reply = await harness.call(method, path, {
        headers: { origin, host: HOST },
        body: method === 'POST' ? { passcode: 'egal' } : undefined,
      });
      expect(reply.status, `${method} ${path}`).toBe(403);
      expect(reply.body).toEqual({ error: 'cross_origin' });
      expect(corsHeaders(reply.headers)).toEqual([]);
    }
  });

  it('beantwortet eine Vorabfrage von fremder Herkunft nicht mit Freigaben', async () => {
    const reply = await harness.call('OPTIONS', '/api/chats', {
      headers: {
        origin: 'https://boese.example.test',
        host: HOST,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-csrf-token',
      },
    });
    expect(reply.status).toBe(403);
    expect(corsHeaders(reply.headers)).toEqual([]);
  });

  it('setzt auch bei der eigenen Herkunft nie Access-Control-Header', async () => {
    const reply = await harness.call('GET', '/api/health', {
      headers: { origin: `https://${HOST}`, host: HOST },
    });
    expect(corsHeaders(reply.headers)).toEqual([]);
  });
});
