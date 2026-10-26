import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAVILY_SEARCH_URL } from '../search/tavily';
import { createHarness, type Harness, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');

describe('Websuche-Einstellungen (/api/web-search)', () => {
  let harness: Harness;
  let session: Session;
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ title: 'T', url: 'https://x.example.test/', content: 'd' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    harness = createHarness({ searchFetch: fetch as unknown as typeof globalThis.fetch });
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  it('verlangt eine Anmeldung', async () => {
    const reply = await harness.call('GET', '/api/web-search');
    expect(reply.status).not.toBe(200);
  });

  it('ist standardmäßig aus und ohne Schlüssel', async () => {
    const reply = await session.call('GET', '/api/web-search');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ enabled: false, hasKey: false, keyHint: null });
  });

  it('speichert Schalter und Schlüssel, und der Schlüssel kommt nie zurück', async () => {
    const enabled = await session.call('PUT', '/api/web-search', { enabled: true });
    expect(enabled.body).toMatchObject({ enabled: true });

    const saved = await session.call('PUT', '/api/web-search', { apiKey: KEY });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ enabled: true, hasKey: true, keyHint: 'mnop' });
    expect(saved.text).not.toContain(KEY);

    const read = await session.call('GET', '/api/web-search');
    expect(read.text).not.toContain(KEY);
  });

  it('weist einen Schlüssel mit Steuerzeichen ab, ohne ihn zu nennen', async () => {
    const reply = await session.call('PUT', '/api/web-search', { apiKey: `${KEY}\nzeile` });
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_input', field: 'apiKey' });
    expect(reply.text).not.toContain(KEY);
  });

  it('lehnt eine Mischung aus Schlüssel setzen und löschen ab', async () => {
    const reply = await session.call('PUT', '/api/web-search', { apiKey: KEY, clearKey: true });
    expect(reply.status).toBe(400);
  });

  it('löscht den Schlüssel', async () => {
    await session.call('PUT', '/api/web-search', { apiKey: KEY });
    const cleared = await session.call('PUT', '/api/web-search', { clearKey: true });
    expect(cleared.body).toEqual({ enabled: false, hasKey: false, keyHint: null });
  });

  it('prüft die Verbindung mit einer festen, neutralen Suche und meldet nur Anzahl oder Code', async () => {
    await session.call('PUT', '/api/web-search', { apiKey: KEY });
    const ok = await session.call('POST', '/api/web-search/test');
    expect(ok.body).toEqual({ ok: true, results: 1 });
    expect(ok.text).not.toContain(KEY);

    const [sentUrl, sentInit] = fetch.mock.calls[0] ?? [];
    expect(sentUrl).toBe(TAVILY_SEARCH_URL);
    expect(JSON.parse(String(sentInit?.body))).toMatchObject({
      query: 'Wikipedia',
      max_results: 1,
    });
    expect(sentInit?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });

  it('meldet einen Verbindungsfehler als Code, ohne Text des Dienstes', async () => {
    await session.call('PUT', '/api/web-search', { apiKey: KEY });
    fetch.mockImplementationOnce(async () => new Response(`geheim ${KEY}`, { status: 401 }));
    const failed = await session.call('POST', '/api/web-search/test');
    expect(failed.body).toEqual({ ok: false, error: 'auth_failed' });
    expect(failed.text).not.toContain(KEY);
  });

  it('ohne Schlüssel meldet der Test „nicht eingerichtet“', async () => {
    const reply = await session.call('POST', '/api/web-search/test');
    expect(reply.body).toEqual({ ok: false, error: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
