import { describe, expect, it } from 'vitest';
import { type ChatEvent, ProviderClient, type Target } from './client';
import { ProviderError } from './errors';

const encoder = new TextEncoder();
// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'x'.repeat(24)].join('-');
const target: Target = { baseUrl: 'https://anbieter.example.test/v1', apiKey: KEY };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: string | undefined;
}

type Handler = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** Ein Ersatz für fetch, der die Aufrufe festhält und Antworten aus einer Funktion nimmt. */
function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init?.redirect,
    };
    calls.push(call);
    return handler(call, init?.signal ?? undefined);
  };
  return { fetch: impl as typeof fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function sse(chunks: string[], init: ResponseInit = {}): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init },
  );
}

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }], ...extra })}\n\n`;

/** Wartet auf einen Fehler und gibt ihn zurück (schlägt fehl, wenn keiner auftritt). */
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error('Es wurde kein Fehler geworfen.');
}

async function drain(generator: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

const request = {
  model: 'beispiel/modell',
  messages: [{ role: 'user' as const, content: 'Hallo' }],
};

describe('ProviderClient.listModels', () => {
  it('liest IDs, Namen, Fähigkeiten und Gratis-Modelle', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: [
          {
            id: 'beispiel/gross',
            name: 'Beispiel Groß',
            architecture: { input_modalities: ['text', 'image'] },
            supported_parameters: ['tools', 'reasoning', 'temperature'],
            pricing: { prompt: '0.0000002', completion: '0.000001' },
          },
          {
            id: 'beispiel/frei:free',
            architecture: { input_modalities: ['text'] },
            supported_parameters: ['temperature'],
            pricing: { prompt: '0', completion: '0' },
          },
          { id: 'einfach' },
          { id: '' },
          { name: 'ohne ID' },
          'kein Objekt',
          null,
        ],
      }),
    );
    const models = await new ProviderClient({ fetch }).listModels(target);
    expect(models).toEqual([
      {
        id: 'beispiel/gross',
        name: 'Beispiel Groß',
        vision: true,
        tools: true,
        reasoning: true,
        free: false,
      },
      {
        id: 'beispiel/frei:free',
        name: null,
        vision: false,
        tools: false,
        reasoning: false,
        free: true,
      },
      { id: 'einfach', name: null, vision: null, tools: null, reasoning: null, free: false },
    ]);
    expect(calls[0]).toMatchObject({
      url: 'https://anbieter.example.test/v1/models',
      method: 'GET',
      redirect: 'manual',
    });
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('sendet ohne Schlüssel keinen Authorization-Header', async () => {
    const { fetch, calls } = fakeFetch(() => json({ data: [] }));
    await new ProviderClient({ fetch }).listModels({ ...target, apiKey: null });
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('wertet fehlende oder leere Preise nicht als kostenlos', async () => {
    const { fetch } = fakeFetch(() =>
      json({
        data: [
          { id: 'a', pricing: {} },
          { id: 'b', pricing: { prompt: null, completion: null } },
          { id: 'c', pricing: { prompt: '', completion: '' } },
        ],
      }),
    );
    const models = await new ProviderClient({ fetch }).listModels(target);
    expect(models.map((model) => model.free)).toEqual([false, false, true]);
  });

  it.each([
    ['kein JSON', () => new Response('<html>', { status: 200 })],
    ['ohne data-Liste', () => json({ models: [] })],
    ['als Liste', () => json([])],
  ])('meldet eine ungültige Antwort (%s)', async (_label, make) => {
    const { fetch } = fakeFetch(make);
    await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('bricht zu große Antworten ab', async () => {
    const big = 'x'.repeat(9 * 1024 * 1024);
    const { fetch } = fakeFetch(() => new Response(big, { status: 200 }));
    await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('Fehler', () => {
  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [402, 'insufficient_credits'],
    [404, 'model_not_found'],
    [408, 'timeout'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [500, 'upstream_error'],
    [503, 'upstream_error'],
  ])('ordnet Status %i dem Code %s zu', async (status, code) => {
    const { fetch } = fakeFetch(() => new Response('{"error":"x"}', { status }));
    await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
      code,
      status,
    });
  });

  it('nennt weder Schlüssel noch Antworttext des Anbieters', async () => {
    const { fetch } = fakeFetch(
      () => new Response(`Falscher Schlüssel: ${KEY} und geheimer Inhalt`, { status: 401 }),
    );
    const error = await failure(new ProviderClient({ fetch }).listModels(target));
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toBe('auth_failed');
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(String(error.stack)).not.toContain(KEY);
    expect(String(error.stack)).not.toContain('geheimer');
  });

  describe('Fehlernummern im Rumpf (Z.ai antwortet fast immer mit 429)', () => {
    const body = (code: string | number, message = 'Text des Anbieters') =>
      JSON.stringify({ error: { code, message } });

    it.each([
      [429, '1113', 'no_package'],
      [429, 1113, 'no_package'],
      [400, '1211', 'model_not_found'],
      [400, '1301', 'content_blocked'],
      [429, '1308', 'quota_exhausted'],
      [429, '1309', 'plan_expired'],
      [429, '1310', 'quota_exhausted'],
      [429, '1311', 'model_not_allowed'],
    ])('Status %i mit Nummer %s ergibt %s', async (status, code, expected) => {
      const { fetch } = fakeFetch(() => new Response(body(code), { status }));
      await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
        code: expected,
        status,
      });
    });

    it('bleibt bei unbekannten Nummern, kaputtem JSON und fehlendem Rumpf beim Status', async () => {
      for (const text of [body('9999'), body('1302'), '{kaputt', '[]', '"x"', '']) {
        const { fetch } = fakeFetch(() => new Response(text, { status: 429 }));
        await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
          code: 'rate_limited',
        });
      }
    });

    it('gibt keinen Text des Anbieters weiter, auch nicht den Schlüssel', async () => {
      const { fetch } = fakeFetch(
        () => new Response(body('1113', `Schlüssel ${KEY} ist leer`), { status: 429 }),
      );
      const error = await failure(new ProviderClient({ fetch }).listModels(target));
      expect(error.code).toBe('no_package');
      expect(error.message).toBe('no_package');
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(String(error.stack)).not.toContain(KEY);
    });

    it('liest den Rumpf nur begrenzt', async () => {
      let pulled = 0;
      const { fetch } = fakeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulled += 1;
                controller.enqueue(encoder.encode('x'.repeat(1024)));
              },
            }),
            { status: 429 },
          ),
      );
      await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
        code: 'rate_limited',
      });
      expect(pulled).toBeLessThan(20);
    });

    it('liest den Rumpf einer Weiterleitung nicht', async () => {
      const { fetch } = fakeFetch(() => new Response(body('1113'), { status: 307 }));
      await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
        code: 'redirected',
      });
    });

    it('erkennt die Nummer auch vor dem ersten Text eines Chats und mitten im Strom', async () => {
      const refused = fakeFetch(() => new Response(body('1113'), { status: 429 }));
      await expect(
        drain(new ProviderClient({ fetch: refused.fetch }).streamChat(target, request)),
      ).rejects.toMatchObject({ code: 'no_package', status: 429 });

      const midStream = fakeFetch(() =>
        sse([chunk({ content: 'a' }), `data: ${body('1310')}\n\n`]),
      );
      await expect(
        drain(new ProviderClient({ fetch: midStream.fetch }).streamChat(target, request)),
      ).rejects.toMatchObject({ code: 'quota_exhausted' });
    });

    it('kennzeichnet, wann ein anderes Modell helfen kann', () => {
      for (const code of ['no_package', 'quota_exhausted', 'plan_expired', 'model_not_allowed']) {
        expect(new ProviderError(code as ProviderError['code']).retryable).toBe(true);
      }
      expect(new ProviderError('content_blocked').retryable).toBe(false);
    });
  });

  it('folgt keiner Weiterleitung und meldet sie', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(null, { status: 307, headers: { location: 'https://fremd.example.test/' } }),
    );
    await expect(new ProviderClient({ fetch }).listModels(target)).rejects.toMatchObject({
      code: 'redirected',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.redirect).toBe('manual');
  });

  it('meldet einen nicht erreichbaren Anbieter ohne Details', async () => {
    const client = new ProviderClient({
      fetch: (async () => {
        throw new TypeError(`fetch failed: ${KEY}`);
      }) as typeof fetch,
    });
    const error = await failure(client.listModels(target));
    expect(error).toMatchObject({ code: 'unreachable' });
    expect(error.message).not.toContain(KEY);
  });

  it('meldet ein Zeitlimit', async () => {
    const { fetch } = fakeFetch(
      (_call, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    await expect(
      new ProviderClient({ fetch, requestTimeoutMs: 20 }).listModels(target),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('meldet einen Abbruch durch den Aufrufer', async () => {
    const { fetch } = fakeFetch(
      (_call, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const pending = new ProviderClient({ fetch }).listModels(target, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('kennzeichnet, wann ein anderes Modell helfen kann', () => {
    expect(new ProviderError('rate_limited').retryable).toBe(true);
    expect(new ProviderError('upstream_error').retryable).toBe(true);
    expect(new ProviderError('auth_failed').retryable).toBe(false);
    expect(new ProviderError('aborted').retryable).toBe(false);
    expect(new ProviderError('bad_request').retryable).toBe(false);
  });
});

describe('ProviderClient.test', () => {
  it('prüft bei OpenRouter den Schlüssel über /key', async () => {
    const { fetch, calls } = fakeFetch(() => json({ data: { label: 'x' } }));
    const result = await new ProviderClient({ fetch }).test(target, {
      preset: 'openrouter',
      probeModel: null,
    });
    expect(result).toMatchObject({ ok: true, modelCount: null });
    expect(calls.map((call) => call.url)).toEqual(['https://anbieter.example.test/v1/key']);
  });

  it('verlangt bei OpenRouter einen Schlüssel', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const result = await new ProviderClient({ fetch }).test(
      { ...target, apiKey: null },
      { preset: 'openrouter', probeModel: null },
    );
    expect(result).toEqual({ ok: false, code: 'no_key' });
    expect(calls).toHaveLength(0);
  });

  it('meldet einen abgelehnten Schlüssel', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 401 }));
    expect(
      await new ProviderClient({ fetch }).test(target, { preset: 'openrouter', probeModel: null }),
    ).toEqual({ ok: false, code: 'auth_failed' });
    expect(
      await new ProviderClient({ fetch }).test(target, { preset: 'custom', probeModel: null }),
    ).toEqual({ ok: false, code: 'auth_failed' });
  });

  it('nutzt sonst die Modellliste und meldet deren Größe', async () => {
    const { fetch, calls } = fakeFetch(() => json({ data: [{ id: 'a' }, { id: 'b' }] }));
    const result = await new ProviderClient({ fetch }).test(target, {
      preset: 'custom',
      probeModel: 'a',
    });
    expect(result).toMatchObject({ ok: true, modelCount: 2 });
    expect(calls).toHaveLength(1);
  });

  it('fragt ein Modell an, wenn es keine Modellliste gibt', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url.endsWith('/models')
        ? new Response('', { status: 404 })
        : json({ choices: [{ message: { content: 'p' } }] }),
    );
    const result = await new ProviderClient({ fetch }).test(target, {
      preset: 'custom',
      probeModel: 'beispiel/modell',
    });
    expect(result).toMatchObject({ ok: true, modelCount: null });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://anbieter.example.test/v1/chat/completions',
    });
    expect(calls[1]?.body).toMatchObject({
      model: 'beispiel/modell',
      max_tokens: 1,
      stream: false,
    });
  });

  it('meldet fehlende Modellliste ohne bekanntes Modell', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 404 }));
    expect(
      await new ProviderClient({ fetch }).test(target, { preset: 'custom', probeModel: null }),
    ).toEqual({ ok: false, code: 'models_unavailable' });
  });

  it('meldet nicht erreichbare Anbieter als Ergebnis statt als Fehler', async () => {
    const client = new ProviderClient({
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(await client.test(target, { preset: 'custom', probeModel: null })).toEqual({
      ok: false,
      code: 'unreachable',
    });
  });
});

describe('ProviderClient.streamChat', () => {
  it('liefert Text, Nutzung und Ende, ignoriert Kommentare und beendet bei [DONE]', async () => {
    const { fetch, calls } = fakeFetch(() =>
      sse([
        ': OPENROUTER PROCESSING\n\n',
        chunk({ role: 'assistant', content: '' }),
        chunk({ content: 'Hal' }),
        chunk({ content: 'lo ' }),
        chunk({ content: 'Welt' }),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`,
        'data: [DONE]\n\n',
        chunk({ content: 'nach dem Ende' }),
      ]),
    );
    const events = await drain(new ProviderClient({ fetch }).streamChat(target, request));
    expect(events).toEqual([
      { type: 'delta', text: 'Hal' },
      { type: 'delta', text: 'lo ' },
      { type: 'delta', text: 'Welt' },
      { type: 'finish', reason: 'stop' },
      { type: 'usage', promptTokens: 7, completionTokens: 3 },
    ]);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://anbieter.example.test/v1/chat/completions',
      redirect: 'manual',
    });
    expect(calls[0]?.body).toEqual({
      model: 'beispiel/modell',
      messages: request.messages,
      stream: true,
    });
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('übergibt Temperatur und Längengrenze nur, wenn sie gesetzt sind', async () => {
    const { fetch, calls } = fakeFetch(() => sse(['data: [DONE]\n\n']));
    await drain(
      new ProviderClient({ fetch }).streamChat(target, {
        ...request,
        temperature: 0.2,
        maxTokens: 50,
      }),
    );
    expect(calls[0]?.body).toMatchObject({ temperature: 0.2, max_tokens: 50 });
  });

  it('trennt Denktext vom Antworttext', async () => {
    const { fetch } = fakeFetch(() =>
      sse([
        chunk({ reasoning: 'überlege' }),
        chunk({ reasoning_content: 'mehr' }),
        chunk({ content: 'Antwort' }),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await drain(new ProviderClient({ fetch }).streamChat(target, request));
    expect(events).toEqual([
      { type: 'reasoning', text: 'überlege' },
      { type: 'reasoning', text: 'mehr' },
      { type: 'delta', text: 'Antwort' },
      { type: 'finish', reason: null },
    ]);
  });

  it('ergänzt ein Ende, wenn der Strom ohne finish_reason abbricht', async () => {
    const { fetch } = fakeFetch(() => sse([chunk({ content: 'a' })]));
    const events = await drain(new ProviderClient({ fetch }).streamChat(target, request));
    expect(events.at(-1)).toEqual({ type: 'finish', reason: null });
  });

  it('meldet einen Fehler mitten im Strom, ohne dessen Text weiterzugeben', async () => {
    const { fetch } = fakeFetch(() =>
      sse([
        chunk({ content: 'a' }),
        `data: ${JSON.stringify({ error: { code: 500, message: `Schlüssel ${KEY}` } })}\n\n`,
      ]),
    );
    const received: ChatEvent[] = [];
    const error = await (async () => {
      try {
        for await (const event of new ProviderClient({ fetch }).streamChat(target, request)) {
          received.push(event);
        }
      } catch (caught) {
        return caught as ProviderError;
      }
      return null;
    })();
    expect(received).toEqual([{ type: 'delta', text: 'a' }]);
    expect(error).toMatchObject({ code: 'upstream_error' });
    expect(error?.message).not.toContain(KEY);
  });

  it('meldet einen Fehler in der Auswahl (choice.error)', async () => {
    const { fetch } = fakeFetch(() =>
      sse([`data: ${JSON.stringify({ choices: [{ error: { code: 429 }, delta: {} }] })}\n\n`]),
    );
    await expect(
      drain(new ProviderClient({ fetch }).streamChat(target, request)),
    ).rejects.toMatchObject({
      code: 'upstream_error',
    });
  });

  it.each([
    ['kein JSON', 'data: {kaputt\n\n'],
    ['kein Objekt', 'data: 5\n\n'],
  ])('meldet einen ungültigen Datenblock (%s)', async (_label, data) => {
    const { fetch } = fakeFetch(() => sse([data]));
    await expect(
      drain(new ProviderClient({ fetch }).streamChat(target, request)),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('behandelt eine gewöhnliche JSON-Antwort wie einen Strom', async () => {
    const { fetch } = fakeFetch(() =>
      json({
        choices: [{ message: { content: 'ganze Antwort' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    );
    expect(await drain(new ProviderClient({ fetch }).streamChat(target, request))).toEqual([
      { type: 'delta', text: 'ganze Antwort' },
      { type: 'usage', promptTokens: 1, completionTokens: 2 },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('meldet HTTP-Fehler vor dem ersten Text mit Code', async () => {
    const { fetch } = fakeFetch(() => new Response('{"error":"zu viele"}', { status: 429 }));
    await expect(
      drain(new ProviderClient({ fetch }).streamChat(target, request)),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  });

  it('bricht ab, wenn der Aufrufer abbricht, und meldet das als Abbruch', async () => {
    const { fetch } = fakeFetch((_call, signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(chunk({ content: 'a' })));
          signal?.addEventListener('abort', () =>
            controller.error(new DOMException('x', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const controller = new AbortController();
    const seen: ChatEvent[] = [];
    const run = (async () => {
      for await (const event of new ProviderClient({ fetch }).streamChat(
        target,
        request,
        controller.signal,
      )) {
        seen.push(event);
        controller.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
    expect(seen).toEqual([{ type: 'delta', text: 'a' }]);
  });

  it('meldet ein Zeitlimit, wenn lange nichts mehr kommt', async () => {
    const { fetch } = fakeFetch((_call, signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () =>
            controller.error(new DOMException('x', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    await expect(
      drain(new ProviderClient({ fetch, idleTimeoutMs: 30 }).streamChat(target, request)),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('begrenzt die Länge der Antwort', async () => {
    const piece = 'x'.repeat(50_000);
    const { fetch } = fakeFetch(() =>
      sse([...Array.from({ length: 6 }, () => chunk({ content: piece })), 'data: [DONE]\n\n']),
    );
    await expect(
      drain(new ProviderClient({ fetch }).streamChat(target, request)),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('bricht ein Stream-Zeitlimit nicht durch die Gesamtdauer ab', async () => {
    // Ein Strom darf länger laufen als das Zeitlimit für einfache Anfragen, solange Daten kommen.
    const { fetch } = fakeFetch(() => {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          sent += 1;
          controller.enqueue(encoder.encode(chunk({ content: 'x' })));
          if (sent === 8) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const client = new ProviderClient({ fetch, requestTimeoutMs: 40, idleTimeoutMs: 200 });
    const events = await drain(client.streamChat(target, request));
    expect(events.filter((event) => event.type === 'delta')).toHaveLength(8);
  });
});
