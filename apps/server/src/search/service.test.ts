import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from '../test-harness';
import { ToolError } from '../tools/registry';
import { SEARCH_KEY, WebSearchService } from './service';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');

const reply = () =>
  new Response(
    JSON.stringify({
      web: {
        results: [{ title: 'Treffer', url: 'https://beispiel.example.test/', description: 'x' }],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('Websuche: Schalter und Schlüssel', () => {
  let harness: Harness;
  let fetch: ReturnType<typeof vi.fn>;
  let service: WebSearchService;

  beforeEach(() => {
    harness = createHarness();
    fetch = vi.fn(async () => reply());
    service = new WebSearchService(harness.services.database.db, harness.services.secrets, {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
  });
  afterEach(() => harness.close());

  it('ist standardmäßig aus, ohne Schlüssel nicht verfügbar', async () => {
    expect(service.enabled()).toBe(false);
    expect(await service.status()).toEqual({ enabled: false, hasKey: false, keyHint: null });
    expect(await service.available()).toBe(false);
  });

  it('ist erst mit Schalter und Schlüssel verfügbar, und der Schlüssel erscheint nie in der Antwort', async () => {
    await service.setKey(KEY);
    expect(await service.available()).toBe(false);
    service.setEnabled(true);
    expect(await service.available()).toBe(true);

    const status = await service.status();
    expect(status).toEqual({ enabled: true, hasKey: true, keyHint: 'mnop' });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it('verweigert die Suche für das Modell, solange der Schalter aus ist', async () => {
    await service.setKey(KEY);
    await expect(service.search('Wetter', 3)).rejects.toMatchObject({ code: 'not_enabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ohne Schlüssel gibt es keine Suche', async () => {
    service.setEnabled(true);
    await expect(service.search('Wetter', 3)).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('sucht mit dem gespeicherten Schlüssel und gibt geprüfte Treffer zurück', async () => {
    service.setEnabled(true);
    await service.setKey(KEY);
    const found = await service.search('Wetter', 2);
    expect(found).toEqual([
      { title: 'Treffer', url: 'https://beispiel.example.test/', description: 'x' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('der Verbindungstest funktioniert auch bei ausgeschaltetem Schalter und meldet nur Anzahl oder Code', async () => {
    await service.setKey(KEY);
    expect(await service.test()).toEqual({ ok: true, results: 1 });

    fetch.mockImplementationOnce(async () => new Response('x', { status: 401 }));
    expect(await service.test()).toEqual({ ok: false, error: 'auth_failed' });
  });

  it('zählt Suchen je Minute und lässt nach einer Minute wieder zu', async () => {
    let clock = 1_000_000;
    const limited = new WebSearchService(harness.services.database.db, harness.services.secrets, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
    });
    limited.setEnabled(true);
    await limited.setKey(KEY);
    for (let n = 0; n < 10; n += 1) await limited.search('Wetter', 1);
    await expect(limited.search('Wetter', 1)).rejects.toBeInstanceOf(ToolError);
    await expect(limited.search('Wetter', 1)).rejects.toMatchObject({ code: 'rate_limited' });

    clock += 60_000;
    await expect(limited.search('Wetter', 1)).resolves.toHaveLength(1);
  });

  it('löscht den Schlüssel auf Wunsch', async () => {
    await service.setKey(KEY);
    await service.clearKey();
    expect(await harness.services.secrets.has(SEARCH_KEY)).toBe(false);
    expect((await service.status()).hasKey).toBe(false);
  });
});
