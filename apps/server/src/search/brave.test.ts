import { describe, expect, it, vi } from 'vitest';
import { BRAVE_SEARCH_URL, BraveSearchError, braveSearch, cleanText } from './brave';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const results = (...items: unknown[]) => json({ web: { results: items } });

/** Fälschung für `fetch`: zeichnet Aufrufe auf und liefert die Antwort des Tests. */
function fakeFetch(reply: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => reply());
}

describe('Brave-Suche', () => {
  it('fragt die feste Adresse mit Suchbegriff und Anzahl ab, Schlüssel nur im Kopf', async () => {
    const fetch = fakeFetch(() => results());
    await braveSearch({ apiKey: KEY, query: 'Photosynthese', count: 3, fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(`${parsed.origin}${parsed.pathname}`).toBe(BRAVE_SEARCH_URL);
    expect(parsed.searchParams.get('q')).toBe('Photosynthese');
    expect(parsed.searchParams.get('count')).toBe('3');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ 'X-Subscription-Token': KEY });
    // Der Schlüssel steht nie in der Adresse.
    expect(String(url)).not.toContain(KEY);
  });

  it('gibt Titel, Adresse und Auszug zurück, ohne Markup', async () => {
    const fetch = fakeFetch(() =>
      results({
        title: 'Photo<strong>synthese</strong> &amp; Licht',
        url: 'https://beispiel.example.test/artikel',
        description: 'Pflanzen nutzen <strong>Licht</strong>\n\tund Wasser.',
      }),
    );
    const found = await braveSearch({ apiKey: KEY, query: 'x', count: 5, fetch });
    expect(found).toEqual([
      {
        title: 'Photo synthese &amp; Licht',
        url: 'https://beispiel.example.test/artikel',
        description: 'Pflanzen nutzen Licht und Wasser.',
      },
    ]);
  });

  it('wirft Treffer mit anderen Adressen als http und https weg, auch kaputte', async () => {
    const fetch = fakeFetch(() =>
      results(
        { title: 'Datei', url: 'file:///etc/passwd', description: '' },
        { title: 'Skript', url: 'javascript:alert(1)', description: '' },
        { title: 'Kaputt', url: 'nicht eine adresse', description: '' },
        { title: 'Gut', url: 'http://beispiel.example.test/a', description: 'ok' },
      ),
    );
    const found = await braveSearch({ apiKey: KEY, query: 'x', count: 5, fetch });
    expect(found.map((item) => item.title)).toEqual(['Gut']);
  });

  it('begrenzt Länge und Anzahl', async () => {
    const long = 'a'.repeat(1000);
    const fetch = fakeFetch(() =>
      results(
        ...Array.from({ length: 8 }, (_, n) => ({
          title: `Titel ${n} ${long}`,
          url: `https://beispiel.example.test/${n}`,
          description: long,
        })),
      ),
    );
    const found = await braveSearch({ apiKey: KEY, query: 'x', count: 5, fetch });
    expect(found).toHaveLength(5);
    expect(found[0]?.title.length).toBeLessThanOrEqual(200);
    expect(found[0]?.description.length).toBeLessThanOrEqual(300);
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ] as const)(
    'übersetzt HTTP %i in den Code %s, ohne den Text der Antwort',
    async (status, code) => {
      const fetch = fakeFetch(
        () => new Response(`Fehler mit ${KEY} im Text`, { status: status as number }),
      );
      const error = await braveSearch({ apiKey: KEY, query: 'x', count: 1, fetch }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(BraveSearchError);
      expect((error as BraveSearchError).code).toBe(code);
      expect(String(error)).not.toContain(KEY);
    },
  );

  it('lehnt eine Antwort ab, die nicht das erwartete Format hat', async () => {
    const notJson = fakeFetch(() => new Response('<html>', { status: 200 }));
    await expect(
      braveSearch({ apiKey: KEY, query: 'x', count: 1, fetch: notJson }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
    const wrongShape = fakeFetch(() => json({ web: { results: 'nicht eine Liste' } }));
    await expect(
      braveSearch({ apiKey: KEY, query: 'x', count: 1, fetch: wrongShape }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('meldet eine Zeitüberschreitung als timeout und einen Abbruch durch die Person als aborted', async () => {
    const timeout = fakeFetch(() => {
      throw new DOMException('Die Anfrage lief ab.', 'TimeoutError');
    });
    await expect(
      braveSearch({ apiKey: KEY, query: 'x', count: 1, fetch: timeout }),
    ).rejects.toMatchObject({ code: 'timeout' });

    const controller = new AbortController();
    const hangs = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const pending = braveSearch({
      apiKey: KEY,
      query: 'x',
      count: 1,
      fetch: hangs,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('meldet einen Netzfehler als unavailable', async () => {
    const offline = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(
      braveSearch({ apiKey: KEY, query: 'x', count: 1, fetch: offline }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('cleanText', () => {
  it('entfernt Markup und Steuerzeichen und kürzt mit Auslassung', () => {
    expect(cleanText('<b>Hallo</b>\u0007  Welt', 50)).toBe('Hallo Welt');
    expect(cleanText('abcdefghij', 5)).toBe('abcd…');
  });
});
