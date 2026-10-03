import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const KEY_TWO = ['beispiel', 'schluessel', 'zyxwvutsrqponmlk'].join('-');
const SECOND_URL = 'https://zweiter-anbieter.example.test/v1';

interface Seen {
  url: string;
  method: string;
  authorization: string | undefined;
}

describe('Anbieter und Modellwahl', () => {
  let harness: Harness;
  let session: Session;
  let seen: Seen[];
  let respond: (url: string, method: string) => Response;

  beforeEach(async () => {
    seen = [];
    respond = () => new Response('{}', { status: 200 });
    const fakeFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: headers.Authorization,
      });
      return respond(String(input), init?.method ?? 'GET');
    }) as typeof fetch;
    harness = createHarness({ fetch: fakeFetch });
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  async function addOpenRouter(apiKey = KEY) {
    const reply = await session.call('POST', '/api/providers', {
      name: 'Beispiel-OpenRouter',
      preset: 'openrouter',
      apiKey,
    });
    return reply.body as {
      id: string;
      models: { id: string; free: boolean }[];
      hasKey: boolean;
      keyHint: string | null;
    };
  }
  async function addSecond(models = [{ id: 'zweit/modell' }, { id: 'zweit/anderes' }]) {
    const reply = await session.call('POST', '/api/providers', {
      name: 'Zweiter Anbieter',
      baseUrl: SECOND_URL,
      apiKey: KEY_TWO,
      models,
    });
    return reply.body as { id: string };
  }

  it.each([
    ['GET', '/api/providers'],
    ['POST', '/api/providers'],
    ['GET', '/api/provider-presets'],
    ['GET', '/api/model-settings'],
    ['PUT', '/api/model-settings'],
    ['POST', '/api/providers/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/test'],
    ['GET', '/api/providers/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/available-models'],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: {} });
    expect(reply.status).toBe(401);
  });

  it('startet ohne Anbieter und ohne Modellwahl', async () => {
    expect((await session.call('GET', '/api/providers')).body).toEqual({ providers: [] });
    expect((await session.call('GET', '/api/model-settings')).body).toEqual({
      default: null,
      fallback: [],
    });
  });

  it('nennt die Voreinstellungen, darunter OpenRouter mit den Standardmodellen', async () => {
    const reply = await session.call('GET', '/api/provider-presets');
    const presets = (
      reply.body as { presets: { id: string; baseUrl: string; models: { id: string }[] }[] }
    ).presets;
    expect(presets.map((preset) => preset.id)).toEqual([
      'openrouter',
      'zai',
      'ollama',
      'lmstudio',
      'custom',
    ]);
    const openrouter = presets.find((preset) => preset.id === 'openrouter');
    expect(openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(openrouter?.models.map((model) => model.id)).toEqual([
      'z-ai/glm-5.3-flash',
      'openrouter/free',
    ]);
    expect(presets.find((preset) => preset.id === 'zai')?.baseUrl).toBe(
      'https://api.z.ai/api/paas/v4',
    );
    for (const preset of presets) expect(preset.baseUrl).not.toMatch(/\/api\/coding/);
  });

  describe('Anlegen', () => {
    it('legt OpenRouter aus der Voreinstellung an und setzt Standardmodell und Fallback', async () => {
      const provider = await addOpenRouter();
      expect(provider.hasKey).toBe(true);
      expect(provider.keyHint).toBe(KEY.slice(-4));
      expect(provider.models.map((model) => [model.id, model.free])).toEqual([
        ['z-ai/glm-5.3-flash', false],
        ['openrouter/free', true],
      ]);
      const flash = { providerId: provider.id, model: 'z-ai/glm-5.3-flash' };
      expect((await session.call('GET', '/api/model-settings')).body).toEqual({
        default: flash,
        fallback: [flash],
      });
    });

    it('legt einen zweiten, frei konfigurierten Anbieter ohne Code-Änderung an', async () => {
      const first = await addOpenRouter();
      const second = await addSecond();
      const list = (await session.call('GET', '/api/providers')).body as {
        providers: { id: string; name: string; baseUrl: string; preset: string }[];
      };
      expect(
        list.providers.map((provider) => [provider.name, provider.baseUrl, provider.preset]),
      ).toEqual([
        ['Beispiel-OpenRouter', 'https://openrouter.ai/api/v1', 'openrouter'],
        ['Zweiter Anbieter', SECOND_URL, 'custom'],
      ]);
      // Die Wahl des ersten Anbieters bleibt bestehen.
      const settings = (await session.call('GET', '/api/model-settings')).body as {
        default: { providerId: string };
      };
      expect(settings.default.providerId).toBe(first.id);
      expect(second.id).not.toBe(first.id);
    });

    it('setzt für einen ersten benutzerdefinierten Anbieter keine Wahl, die der Nutzer nicht getroffen hat', async () => {
      await addSecond();
      expect((await session.call('GET', '/api/model-settings')).body).toEqual({
        default: null,
        fallback: [],
      });
    });

    it('legt lokale Anbieter ohne Schlüssel an', async () => {
      const reply = await session.call('POST', '/api/providers', {
        name: 'Lokaler Server',
        preset: 'ollama',
      });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({
        baseUrl: 'http://localhost:11434/v1',
        hasKey: false,
        keyHint: null,
        models: [],
      });
    });

    it('verbietet doppelte Namen ohne Beachtung der Schreibweise', async () => {
      await addSecond();
      const again = await session.call('POST', '/api/providers', {
        name: 'zweiter ANBIETER',
        baseUrl: SECOND_URL,
      });
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ error: 'name_taken' });
    });

    it.each([
      ['ohne Adresse', { preset: 'custom' }, 'invalid'],
      ['kein URL', { baseUrl: 'das ist keine adresse' }, 'invalid'],
      ['anderes Protokoll', { baseUrl: 'ftp://anbieter.example.test/v1' }, 'invalid'],
      [
        'mit Zugangsdaten',
        { baseUrl: 'https://nutzer:passwort@anbieter.example.test/v1' },
        'invalid',
      ],
      ['mit Query', { baseUrl: `https://anbieter.example.test/v1?key=${KEY}` }, 'invalid'],
      ['mit Fragment', { baseUrl: 'https://anbieter.example.test/v1#x' }, 'invalid'],
      ['Klartext-HTTP im Netz', { baseUrl: 'http://anbieter.example.test/v1' }, 'insecure'],
      ['Klartext-HTTP im Heimnetz', { baseUrl: 'http://192.168.0.5:11434/v1' }, 'insecure'],
    ])('lehnt eine Adresse ab: %s', async (_label, extra, reason) => {
      const reply = await session.call('POST', '/api/providers', { name: 'Test', ...extra });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'baseUrl', reason });
      expect(reply.text).not.toContain(KEY);
      expect((await session.call('GET', '/api/providers')).body).toEqual({ providers: [] });
    });

    it.each(['http://localhost:1234/v1', 'http://127.0.0.1:8080', 'http://[::1]:11434/v1'])(
      'erlaubt Klartext-HTTP nur auf dem eigenen Rechner (%s)',
      async (baseUrl) => {
        const reply = await session.call('POST', '/api/providers', { name: 'Lokal', baseUrl });
        expect(reply.status).toBe(201);
      },
    );

    it('bereinigt die Adresse (Leerraum, abschließende Schrägstriche)', async () => {
      const reply = await session.call('POST', '/api/providers', {
        name: 'Test',
        baseUrl: '  https://anbieter.example.test/v1//  ',
      });
      expect(reply.body).toMatchObject({ baseUrl: 'https://anbieter.example.test/v1' });
    });

    it('lehnt einen unbrauchbaren Schlüssel ab und legt dann nichts an', async () => {
      const reply = await session.call('POST', '/api/providers', {
        name: 'Test',
        baseUrl: SECOND_URL,
        apiKey: 'zwei\nZeilen',
      });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'apiKey' });
      expect(reply.text).not.toContain('Zeilen');
      expect((await session.call('GET', '/api/providers')).body).toEqual({ providers: [] });
    });

    it.each([
      ['unbekanntes Feld', { name: 'T', baseUrl: SECOND_URL, extra: 1 }, null],
      ['unbekannte Voreinstellung', { name: 'T', preset: 'gibtsnicht' }, 'preset'],
      [
        'doppelte Modelle',
        { name: 'T', baseUrl: SECOND_URL, models: [{ id: 'a' }, { id: 'a' }] },
        'models',
      ],
      [
        'Modell-ID mit Leerzeichen',
        { name: 'T', baseUrl: SECOND_URL, models: [{ id: 'a b' }] },
        'models',
      ],
      ['Name fehlt', { baseUrl: SECOND_URL }, 'name'],
      [
        'zu viele Modelle',
        {
          name: 'T',
          baseUrl: SECOND_URL,
          models: Array.from({ length: 101 }, (_, i) => ({ id: `m${i}` })),
        },
        'models',
      ],
    ])('lehnt ab: %s', async (_label, body, field) => {
      const reply = await session.call('POST', '/api/providers', body);
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field });
    });

    it('ergänzt bei Modellen die Standardfähigkeiten', async () => {
      const reply = await session.call('POST', '/api/providers', {
        name: 'T',
        baseUrl: SECOND_URL,
        models: [{ id: 'zweit/modell', vision: true }],
      });
      expect(reply.body).toMatchObject({
        models: [
          {
            id: 'zweit/modell',
            vision: true,
            tools: false,
            reasoning: false,
            streaming: true,
            free: false,
          },
        ],
      });
    });
  });

  describe('Schlüssel', () => {
    it('liegen im Secret-Speicher, nie in einer Antwort oder in der Datenbank', async () => {
      const provider = await addOpenRouter();
      await addSecond();
      expect(await harness.services.secrets.get(`provider.${provider.id}.key`)).toBe(KEY);

      const replies = [
        await session.call('GET', '/api/providers'),
        await session.call('GET', `/api/model-settings`),
        await session.call('GET', '/api/provider-presets'),
        await session.call('PATCH', `/api/providers/${provider.id}`, { name: 'Umbenannt' }),
        await session.call('POST', `/api/providers/${provider.id}/test`),
        await session.call('GET', `/api/providers/${provider.id}/available-models`),
      ];
      for (const reply of replies) {
        expect(reply.text).not.toContain(KEY);
        expect(reply.text).not.toContain(KEY_TWO);
        expect(reply.text).not.toContain(KEY.slice(0, 20));
      }
      const rows = harness.services.database.sqlite
        .prepare('select * from providers')
        .all()
        .map((row) => JSON.stringify(row));
      for (const row of rows) expect(row).not.toContain(KEY);
    });

    it('stehen in keiner Fehlerantwort und in keiner Protokollzeile', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
        vi.spyOn(console, name).mockImplementation(() => {}),
      );
      try {
        respond = () => new Response(`Ungültiger Schlüssel ${KEY}`, { status: 401 });
        const provider = await addOpenRouter();
        const bad = await session.call('POST', '/api/providers', {
          name: 'X',
          baseUrl: `http://anbieter.example.test/${KEY}`,
          apiKey: KEY,
        });
        const test = await session.call('POST', `/api/providers/${provider.id}/test`);
        const discover = await session.call(
          'GET',
          `/api/providers/${provider.id}/available-models`,
        );
        for (const reply of [bad, test, discover]) expect(reply.text).not.toContain(KEY);
        const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
        expect(logged.join('\n')).not.toContain(KEY);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it('lassen sich ersetzen und entfernen, ohne sonst etwas zu ändern', async () => {
      const provider = await addOpenRouter();
      const replaced = await session.call('PATCH', `/api/providers/${provider.id}`, {
        apiKey: KEY_TWO,
      });
      expect(replaced.body).toMatchObject({
        hasKey: true,
        keyHint: KEY_TWO.slice(-4),
        name: 'Beispiel-OpenRouter',
      });
      expect(await harness.services.secrets.get(`provider.${provider.id}.key`)).toBe(KEY_TWO);

      const cleared = await session.call('PATCH', `/api/providers/${provider.id}`, {
        clearKey: true,
      });
      expect(cleared.body).toMatchObject({ hasKey: false, keyHint: null });
      expect(await harness.services.secrets.has(`provider.${provider.id}.key`)).toBe(false);
    });

    it('zeigen bei kurzen Schlüsseln keinen Hinweis', async () => {
      const provider = await addOpenRouter('kurz');
      expect(provider.hasKey).toBe(true);
      expect(provider.keyHint).toBeNull();
    });

    it('werden nur an die Adresse des eigenen Anbieters gesendet', async () => {
      const provider = await addOpenRouter();
      const second = await addSecond();
      respond = () => json({ data: [] });
      await session.call('POST', `/api/providers/${provider.id}/test`);
      await session.call('GET', `/api/providers/${second.id}/available-models`);
      expect(seen).toEqual([
        { url: 'https://openrouter.ai/api/v1/key', method: 'GET', authorization: `Bearer ${KEY}` },
        { url: `${SECOND_URL}/models`, method: 'GET', authorization: `Bearer ${KEY_TWO}` },
      ]);
    });
  });

  describe('Ändern und Löschen', () => {
    it('benennt um, ändert Adresse und Modelle und prüft Namen und Adressen erneut', async () => {
      const second = await addSecond();
      await addOpenRouter();
      const renamed = await session.call('PATCH', `/api/providers/${second.id}`, {
        name: 'Neuer Name',
        baseUrl: 'https://neu.example.test/v1/',
        models: [{ id: 'neu/modell', tools: true }],
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        name: 'Neuer Name',
        baseUrl: 'https://neu.example.test/v1',
        models: [{ id: 'neu/modell', tools: true }],
      });

      const clash = await session.call('PATCH', `/api/providers/${second.id}`, {
        name: 'beispiel-openrouter',
      });
      expect(clash.status).toBe(409);
      const insecure = await session.call('PATCH', `/api/providers/${second.id}`, {
        baseUrl: 'http://neu.example.test/v1',
      });
      expect(insecure.body).toEqual({
        error: 'invalid_input',
        field: 'baseUrl',
        reason: 'insecure',
      });
    });

    it('lässt den Namen beim Speichern des eigenen Namens zu', async () => {
      const second = await addSecond();
      const reply = await session.call('PATCH', `/api/providers/${second.id}`, {
        name: 'zweiter anbieter',
      });
      expect(reply.status).toBe(200);
    });

    it('lehnt leere und widersprüchliche Änderungen ab', async () => {
      const second = await addSecond();
      expect((await session.call('PATCH', `/api/providers/${second.id}`, {})).status).toBe(400);
      const both = await session.call('PATCH', `/api/providers/${second.id}`, {
        apiKey: KEY,
        clearKey: true,
      });
      expect(both.status).toBe(400);
    });

    it('lehnt einen ungültigen Schlüssel ab, ohne Name oder Schlüssel zu ändern', async () => {
      const provider = await addOpenRouter();
      const reply = await session.call('PATCH', `/api/providers/${provider.id}`, {
        name: 'Anderer Name',
        apiKey: 'a\u0000b',
      });
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'apiKey' });
      const list = (await session.call('GET', '/api/providers')).body as {
        providers: { name: string }[];
      };
      expect(list.providers[0]?.name).toBe('Beispiel-OpenRouter');
      expect(await harness.services.secrets.get(`provider.${provider.id}.key`)).toBe(KEY);
    });

    it('räumt Standardmodell und Fallback auf, wenn ein Modell entfällt', async () => {
      const provider = await addOpenRouter();
      await session.call('PATCH', `/api/providers/${provider.id}`, {
        models: [{ id: 'openrouter/free' }],
      });
      expect((await session.call('GET', '/api/model-settings')).body).toEqual({
        default: null,
        fallback: [],
      });
    });

    it('löscht einen Anbieter samt Schlüssel und räumt die Modellwahl auf', async () => {
      const first = await addOpenRouter();
      const second = await addSecond();
      await session.call('PUT', '/api/model-settings', {
        default: { providerId: second.id, model: 'zweit/modell' },
        fallback: [
          { providerId: first.id, model: 'z-ai/glm-5.3-flash' },
          { providerId: second.id, model: 'zweit/anderes' },
        ],
      });

      const gone = await session.call('DELETE', `/api/providers/${first.id}`);
      expect(gone.status).toBe(204);
      expect(await harness.services.secrets.has(`provider.${first.id}.key`)).toBe(false);
      expect(await harness.services.secrets.has(`provider.${second.id}.key`)).toBe(true);
      expect((await session.call('GET', '/api/model-settings')).body).toEqual({
        default: { providerId: second.id, model: 'zweit/modell' },
        fallback: [{ providerId: second.id, model: 'zweit/anderes' }],
      });
      expect((await session.call('DELETE', `/api/providers/${first.id}`)).status).toBe(404);
    });

    it.each(['PATCH', 'DELETE', 'POST'])(
      'antwortet für unbekannte IDs mit 404 (%s)',
      async (method) => {
        const unknown = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';
        const path =
          method === 'POST' ? `/api/providers/${unknown}/test` : `/api/providers/${unknown}`;
        expect((await session.call(method, path, { name: 'x' })).status).toBe(404);
        expect((await session.call(method, '/api/providers/kein-uuid', { name: 'x' })).status).toBe(
          404,
        );
      },
    );
  });

  describe('Verbindung testen', () => {
    it('meldet Erfolg mit Dauer', async () => {
      const provider = await addOpenRouter();
      respond = () => json({ data: { label: 'Beispiel' } });
      const reply = await session.call('POST', `/api/providers/${provider.id}/test`);
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: true, modelCount: null });
      expect(typeof reply.body.latencyMs).toBe('number');
    });

    it('meldet einen abgelehnten Schlüssel als Ergebnis, nicht als Serverfehler', async () => {
      const provider = await addOpenRouter();
      respond = () => new Response('', { status: 401 });
      const reply = await session.call('POST', `/api/providers/${provider.id}/test`);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ ok: false, code: 'auth_failed' });
    });

    it('meldet einen fehlenden Schlüssel bei OpenRouter ohne Anfrage', async () => {
      const reply = await session.call('POST', '/api/providers', {
        name: 'Ohne',
        preset: 'openrouter',
      });
      const id = (reply.body as { id: string }).id;
      const test = await session.call('POST', `/api/providers/${id}/test`);
      expect(test.body).toEqual({ ok: false, code: 'no_key' });
      expect(seen).toHaveLength(0);
    });

    it('nutzt bei anderen Anbietern die Modellliste', async () => {
      const second = await addSecond();
      respond = () => json({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      const reply = await session.call('POST', `/api/providers/${second.id}/test`);
      expect(reply.body).toMatchObject({ ok: true, modelCount: 3 });
    });

    it('meldet einen nicht erreichbaren Anbieter', async () => {
      const second = await addSecond();
      respond = () => {
        throw new TypeError('fetch failed');
      };
      const reply = await session.call('POST', `/api/providers/${second.id}/test`);
      expect(reply.body).toEqual({ ok: false, code: 'unreachable' });
    });
  });

  describe('Verfügbare Modelle', () => {
    it('listet die Modelle des Anbieters sortiert mit Fähigkeiten', async () => {
      const second = await addSecond();
      respond = () =>
        json({
          data: [
            { id: 'zeta/modell', architecture: { input_modalities: ['text', 'image'] } },
            { id: 'alpha/frei:free', pricing: { prompt: '0', completion: '0' } },
          ],
        });
      const reply = await session.call('GET', `/api/providers/${second.id}/available-models`);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        models: [
          {
            id: 'alpha/frei:free',
            name: null,
            vision: null,
            tools: null,
            reasoning: null,
            free: true,
          },
          {
            id: 'zeta/modell',
            name: null,
            vision: true,
            tools: null,
            reasoning: null,
            free: false,
          },
        ],
      });
    });

    it('meldet Fehler des Anbieters nur als Code', async () => {
      const second = await addSecond();
      respond = () => new Response(`Limit für ${KEY_TWO} erreicht`, { status: 429 });
      const reply = await session.call('GET', `/api/providers/${second.id}/available-models`);
      expect(reply.status).toBe(502);
      expect(reply.body).toEqual({ error: 'provider_failed', code: 'rate_limited' });
      expect(reply.text).not.toContain(KEY_TWO);
    });
  });

  describe('Bilder an den Anbieter senden', () => {
    it('ist standardmäßig an und lässt sich beim Anlegen und Ändern setzen', async () => {
      const first = await addOpenRouter();
      expect((first as unknown as { sendImages: boolean }).sendImages).toBe(true);
      expect(harness.services.providers.allowsImages(first.id)).toBe(true);

      const off = await session.call('POST', '/api/providers', {
        name: 'Ohne Bilder',
        baseUrl: SECOND_URL,
        sendImages: false,
        models: [{ id: 'zweit/modell' }],
      });
      expect(off.status).toBe(201);
      expect(off.body.sendImages).toBe(false);
      const id = off.body.id as string;
      expect(harness.services.providers.allowsImages(id)).toBe(false);

      const on = await session.call('PATCH', `/api/providers/${id}`, { sendImages: true });
      expect(on.status).toBe(200);
      expect(on.body.sendImages).toBe(true);
      expect(harness.services.providers.allowsImages(id)).toBe(true);

      const list = (await session.call('GET', '/api/providers')).body.providers as {
        id: string;
        sendImages: boolean;
      }[];
      expect(list.map((entry) => entry.sendImages)).toEqual([true, true]);
    });

    it('verlangt einen Wahrheitswert und schickt Bilder nie an unbekannte Anbieter', async () => {
      const first = await addOpenRouter();
      const bad = await session.call('PATCH', `/api/providers/${first.id}`, { sendImages: 'ja' });
      expect(bad.status).toBe(400);
      expect(harness.services.providers.allowsImages('5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f')).toBe(
        false,
      );
    });
  });

  describe('Modellwahl', () => {
    it('speichert Standardmodell und Fallback-Kette ohne Doppelte', async () => {
      const first = await addOpenRouter();
      const second = await addSecond();
      const a = { providerId: second.id, model: 'zweit/modell' };
      const b = { providerId: first.id, model: 'openrouter/free' };
      const reply = await session.call('PUT', '/api/model-settings', {
        default: a,
        fallback: [b, b, a],
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ default: a, fallback: [b, a] });
      expect((await session.call('GET', '/api/model-settings')).body).toEqual(reply.body);
    });

    it('erlaubt, die Wahl zu leeren', async () => {
      await addOpenRouter();
      const reply = await session.call('PUT', '/api/model-settings', {
        default: null,
        fallback: [],
      });
      expect(reply.body).toEqual({ default: null, fallback: [] });
    });

    it('lehnt unbekannte Anbieter und Modelle ab', async () => {
      const second = await addSecond();
      const unknownProvider = await session.call('PUT', '/api/model-settings', {
        default: { providerId: '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f', model: 'x' },
        fallback: [],
      });
      expect(unknownProvider.status).toBe(404);
      const unknownModel = await session.call('PUT', '/api/model-settings', {
        default: { providerId: second.id, model: 'gibt/es-nicht' },
        fallback: [],
      });
      expect(unknownModel.body).toEqual({ error: 'invalid_input', field: 'model' });
    });

    it('begrenzt die Fallback-Kette', async () => {
      const second = await addSecond();
      const entry = { providerId: second.id, model: 'zweit/modell' };
      const reply = await session.call('PUT', '/api/model-settings', {
        default: null,
        fallback: Array.from({ length: 6 }, () => entry),
      });
      expect(reply.status).toBe(400);
    });

    it('ordnet die Versuche: Wahl, dann Fallback-Kette, ohne Doppelte', async () => {
      const first = await addOpenRouter();
      const second = await addSecond();
      const flash = { providerId: first.id, model: 'z-ai/glm-5.3-flash' };
      const free = { providerId: first.id, model: 'openrouter/free' };
      const other = { providerId: second.id, model: 'zweit/modell' };
      // Standard und Fallback aus der Voreinstellung: Flash, Fallback Flash.
      expect(harness.services.providers.chain(null)).toEqual([flash]);
      expect(harness.services.providers.chain(free)).toEqual([free, flash]);
      await session.call('PUT', '/api/model-settings', {
        default: flash,
        fallback: [other, flash],
      });
      expect(harness.services.providers.chain(free)).toEqual([free, other, flash]);
      expect(harness.services.providers.chain(flash)).toEqual([flash, other]);
      // Eine Wahl, die es nicht mehr gibt, fällt auf das Standardmodell zurück.
      expect(
        harness.services.providers.chain({ providerId: second.id, model: 'weg/damit' }),
      ).toEqual([flash, other]);
    });
  });
});
