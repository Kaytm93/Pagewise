import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '../chats/service';
import { messages } from '../db/schema';
import { createHarness, type Harness, type Reply, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const BASE_URL = 'https://anbieter.example.test/v1';
const encoder = new TextEncoder();

interface UpstreamCall {
  model: string;
  messages: { role: string; content: string }[];
  authorization: string | undefined;
  signal: AbortSignal | undefined;
}

type Upstream = (call: UpstreamCall) => Response | Promise<Response>;

const piece = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`;
const thinkingPiece = () =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'hmm' }, finish_reason: null }] })}\n\n`;
const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;

function streamOf(...texts: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of texts) controller.enqueue(encoder.encode(piece(text)));
        controller.enqueue(encoder.encode(stop));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** Ein Strom, den der Test von Hand weiterschiebt. Bricht ab, wenn die Anfrage abgebrochen wird. */
function controlled(signal: AbortSignal | undefined) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        signal?.addEventListener('abort', () => {
          try {
            c.error(new DOMException('abgebrochen', 'AbortError'));
          } catch {
            // schon beendet
          }
        });
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return {
    response,
    push: (text: string) => controller?.enqueue(encoder.encode(piece(text))),
    end: () => {
      controller?.enqueue(encoder.encode(stop));
      controller?.close();
    },
    fail: () => controller?.error(new Error('Verbindung weg')),
  };
}

const failing = (status: number, body = '{}') => new Response(body, { status });

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '';
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

const names = (events: SseEvent[]) => events.map((entry) => entry.event);
const textOf = (events: SseEvent[]) =>
  events
    .filter((entry) => entry.event === 'delta')
    .map((entry) => entry.data.text)
    .join('');

describe('Chats', () => {
  let harness: Harness;
  let session: Session;
  let calls: UpstreamCall[];
  let upstream: Upstream;
  let providerId: string;
  let subjectId: string;

  async function build(options: Parameters<typeof createHarness>[0] = {}) {
    calls = [];
    upstream = () => streamOf('Hallo', ' Welt');
    const fakeFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = String(input);
      if (!url.endsWith('/chat/completions')) return new Response('{}', { status: 404 });
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as Pick<UpstreamCall, 'model' | 'messages'>;
      const call: UpstreamCall = {
        model: body.model,
        messages: body.messages,
        authorization: headers.Authorization,
        signal: init?.signal ?? undefined,
      };
      calls.push(call);
      return upstream(call);
    }) as typeof fetch;
    harness = createHarness({ ...options, fetch: fakeFetch });
    session = await harness.signIn();
    subjectId = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
      .id as string;
  }

  async function addProvider(models = [{ id: 'modell-a' }, { id: 'modell-b' }]) {
    const reply = await session.call('POST', '/api/providers', {
      name: 'Beispiel-Anbieter',
      baseUrl: BASE_URL,
      apiKey: KEY,
      models,
    });
    providerId = reply.body.id as string;
    return providerId;
  }

  async function chooseModels(defaultModel = 'modell-a', fallback: string[] = ['modell-b']) {
    const reply = await session.call('PUT', '/api/model-settings', {
      default: { providerId, model: defaultModel },
      fallback: fallback.map((model) => ({ providerId, model })),
    });
    expect(reply.status).toBe(200);
  }

  async function newChat(groupId: string | null = null): Promise<string> {
    const reply = await session.call('POST', '/api/chats', { subjectId, groupId });
    expect(reply.status).toBe(201);
    return reply.body.id as string;
  }

  const send = (chatId: string, content: string) =>
    session.call('POST', `/api/chats/${chatId}/messages`, { content });

  async function detail(chatId: string) {
    const reply = await session.call('GET', `/api/chats/${chatId}`);
    expect(reply.status).toBe(200);
    return reply.body as {
      title: string;
      generating: boolean;
      groupId: string | null;
      model: unknown;
      messages: {
        role: string;
        content: string;
        status: string;
        model: string | null;
        errorCode: string | null;
      }[];
    };
  }

  beforeEach(() => build());
  afterEach(() => harness.close());

  describe('Zugriff und Eingaben', () => {
    it.each([
      ['GET', '/api/chats?subjectId=5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f'],
      ['POST', '/api/chats'],
      ['GET', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f'],
      ['PATCH', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f'],
      ['DELETE', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f'],
      ['POST', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/messages'],
      ['POST', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/retry'],
      ['GET', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/generation'],
      ['POST', '/api/chats/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/stop'],
      ['PUT', '/api/subjects/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/model'],
    ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
      const reply = await harness.call(method, path, { body: {} });
      expect(reply.status).toBe(401);
    });

    it('behandelt ungültige IDs wie unbekannte', async () => {
      for (const [method, path] of [
        ['GET', '/api/chats/nicht-gueltig'],
        ['PATCH', '/api/chats/nicht-gueltig'],
        ['DELETE', '/api/chats/nicht-gueltig'],
        ['POST', '/api/chats/nicht-gueltig/messages'],
        ['POST', '/api/chats/nicht-gueltig/retry'],
        ['GET', '/api/chats/nicht-gueltig/generation'],
        ['POST', '/api/chats/nicht-gueltig/stop'],
        ['PUT', '/api/subjects/nicht-gueltig/model'],
      ] as const) {
        const reply = await session.call(method, path, { content: 'x', title: 'x', model: null });
        expect(reply.status, `${method} ${path}`).toBe(404);
      }
    });

    it('meldet unbekannte Chats mit 404', async () => {
      const unknown = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';
      expect((await session.call('GET', `/api/chats/${unknown}`)).status).toBe(404);
      expect((await send(unknown, 'Hallo')).status).toBe(404);
      expect((await session.call('POST', `/api/chats/${unknown}/stop`)).status).toBe(404);
      expect((await session.call('DELETE', `/api/chats/${unknown}`)).status).toBe(404);
    });

    it('prüft Nachrichten: leer, zu lang, Steuerzeichen, fremde Felder', async () => {
      await addProvider();
      await chooseModels();
      const chat = await newChat();
      for (const content of ['', '   \n ', 'x'.repeat(50_001), 'a\u0000b', 'a\u001bb']) {
        const reply = await send(chat, content);
        expect(reply.status, JSON.stringify(content.slice(0, 8))).toBe(400);
        expect(reply.body).toMatchObject({ error: 'invalid_input', field: 'content' });
      }
      const extra = await session.call('POST', `/api/chats/${chat}/messages`, {
        content: 'Hallo',
        role: 'system',
      });
      expect(extra.status).toBe(400);
      const broken = await harness.call('POST', `/api/chats/${chat}/messages`, {
        cookie: session.cookie,
        csrf: session.csrf,
        rawBody: '{kaputt',
        headers: { 'content-type': 'application/json' },
      });
      expect(broken.status).toBe(400);
      expect(broken.body).toEqual({ error: 'invalid_json' });
      expect(calls).toHaveLength(0);
      expect((await detail(chat)).messages).toEqual([]);
    });

    it('nimmt lange Nachrichten bis zur Grenze an und lehnt riesige Körper ab', async () => {
      await addProvider();
      await chooseModels();
      const chat = await newChat();
      const ok = await send(chat, 'ä'.repeat(50_000));
      expect(ok.status).toBe(200);
      const huge = await harness.call('POST', `/api/chats/${chat}/messages`, {
        cookie: session.cookie,
        csrf: session.csrf,
        rawBody: JSON.stringify({ content: 'x'.repeat(300_000) }),
        headers: { 'content-type': 'application/json' },
      });
      expect(huge.status).toBe(413);
    });

    it('verlangt für Chats ohne Nachrichten einen kleinen Körper', async () => {
      const reply = await harness.call('POST', '/api/chats', {
        cookie: session.cookie,
        csrf: session.csrf,
        rawBody: JSON.stringify({ subjectId, title: 'x'.repeat(20_000) }),
        headers: { 'content-type': 'application/json' },
      });
      expect(reply.status).toBe(413);
    });
  });

  describe('Chats verwalten', () => {
    it('startet leer und legt Chats im Fach oder in einer Untergruppe an', async () => {
      expect((await session.call('GET', `/api/chats?subjectId=${subjectId}`)).body).toEqual({
        chats: [],
      });
      const group = (
        await session.call('POST', `/api/subjects/${subjectId}/groups`, { name: 'Beispiel-Thema' })
      ).body.id as string;

      const inSubject = await newChat();
      const inGroup = await newChat(group);

      const general = (await session.call('GET', `/api/chats?subjectId=${subjectId}`)).body as {
        chats: { id: string; groupId: string | null; title: string }[];
      };
      expect(general.chats.map((chat) => chat.id)).toEqual([inSubject]);
      expect(general.chats[0]).toMatchObject({ groupId: null, title: '', generating: false });

      const grouped = (
        await session.call('GET', `/api/chats?subjectId=${subjectId}&groupId=${group}`)
      ).body as { chats: { id: string }[] };
      expect(grouped.chats.map((chat) => chat.id)).toEqual([inGroup]);
    });

    it('hält Chats in ihrem Fach: fremde Untergruppen und Fächer sind unbekannt', async () => {
      const other = (await session.call('POST', '/api/subjects', { name: 'Beispielfach B' })).body
        .id as string;
      const foreignGroup = (
        await session.call('POST', `/api/subjects/${other}/groups`, { name: 'Fremdes Thema' })
      ).body.id as string;

      const wrongGroup = await session.call('POST', '/api/chats', {
        subjectId,
        groupId: foreignGroup,
      });
      expect(wrongGroup.status).toBe(404);
      const wrongList = await session.call(
        'GET',
        `/api/chats?subjectId=${subjectId}&groupId=${foreignGroup}`,
      );
      expect(wrongList.status).toBe(404);
      const noSubject = await session.call('POST', '/api/chats', {
        subjectId: '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f',
      });
      expect(noSubject.status).toBe(404);
      expect((await session.call('GET', '/api/chats')).status).toBe(400);
      expect((await session.call('GET', '/api/chats?subjectId=x')).status).toBe(400);
    });

    it('benennt um, ohne die Reihenfolge zu ändern, und prüft den Titel', async () => {
      const first = await newChat();
      const second = await newChat();
      const renamed = await session.call('PATCH', `/api/chats/${first}`, {
        title: '  Neuer Titel  ',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ title: 'Neuer Titel' });
      const list = (await session.call('GET', `/api/chats?subjectId=${subjectId}`)).body as {
        chats: { id: string }[];
      };
      expect(list.chats.map((chat) => chat.id)).toEqual([second, first]);

      for (const title of ['', '   ', 'x'.repeat(121), 'a\nb']) {
        const reply = await session.call('PATCH', `/api/chats/${first}`, { title });
        expect(reply.status).toBe(400);
      }
      expect((await session.call('PATCH', `/api/chats/${first}`, {})).status).toBe(400);
    });

    it('löscht Chats samt Nachrichten und mit dem Fach', async () => {
      await addProvider();
      await chooseModels();
      const chat = await newChat();
      await send(chat, 'Hallo');
      expect(harness.services.database.db.select().from(messages).all()).toHaveLength(2);
      expect((await session.call('DELETE', `/api/chats/${chat}`)).status).toBe(204);
      expect(harness.services.database.db.select().from(messages).all()).toHaveLength(0);

      const second = await newChat();
      await send(second, 'Hallo');
      expect((await session.call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(204);
      expect(harness.services.database.db.select().from(messages).all()).toHaveLength(0);
      expect((await session.call('GET', `/api/chats/${second}`)).status).toBe(404);
    });

    it('lässt Chats im Fach, wenn ihre Untergruppe gelöscht wird', async () => {
      const group = (
        await session.call('POST', `/api/subjects/${subjectId}/groups`, { name: 'Beispiel-Thema' })
      ).body.id as string;
      const chat = await newChat(group);
      expect((await session.call('DELETE', `/api/groups/${group}`)).status).toBe(204);
      expect((await detail(chat)).groupId).toBeNull();
      const general = (await session.call('GET', `/api/chats?subjectId=${subjectId}`)).body as {
        chats: { id: string }[];
      };
      expect(general.chats.map((entry) => entry.id)).toEqual([chat]);
    });
  });

  describe('Nachricht senden', () => {
    beforeEach(async () => {
      await addProvider();
      await chooseModels();
    });

    it('streamt die Antwort in Ereignissen und speichert sie', async () => {
      const chat = await newChat();
      upstream = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(thinkingPiece()));
              controller.enqueue(encoder.encode(piece('Hallo')));
              controller.enqueue(encoder.encode(piece(' Welt')));
              controller.enqueue(encoder.encode(stop));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      const reply = await send(chat, 'Was ist eine Beispielfrage?');

      expect(reply.status).toBe(200);
      expect(reply.headers.get('content-type')).toContain('text/event-stream');
      expect(reply.headers.get('cache-control')).toContain('no-store');
      const events = parseSse(reply.text);
      expect(names(events)).toEqual([
        'start',
        'snapshot',
        'model',
        'thinking',
        'delta',
        'delta',
        'done',
      ]);
      expect(events[0]?.data).toMatchObject({
        userMessage: { role: 'user', content: 'Was ist eine Beispielfrage?', status: 'complete' },
        assistantMessage: { role: 'assistant', content: '', status: 'streaming' },
      });
      expect(events[1]?.data).toMatchObject({ text: '', model: null, thinking: false });
      expect(events[2]?.data).toEqual({ providerId, model: 'modell-a' });
      expect(textOf(events)).toBe('Hallo Welt');
      expect(events.at(-1)?.data).toMatchObject({
        message: {
          role: 'assistant',
          content: 'Hallo Welt',
          status: 'complete',
          model: 'modell-a',
          providerId,
          errorCode: null,
        },
      });

      const stored = await detail(chat);
      expect(stored.title).toBe('Was ist eine Beispielfrage?');
      expect(stored.generating).toBe(false);
      expect(stored.messages.map((entry) => [entry.role, entry.content, entry.status])).toEqual([
        ['user', 'Was ist eine Beispielfrage?', 'complete'],
        ['assistant', 'Hallo Welt', 'complete'],
      ]);
      // Die Zählung des Anbieters wird mitgespeichert.
      const row = harness.services.database.db.select().from(messages).all()[1];
      expect(row).toMatchObject({ promptTokens: 11, completionTokens: 3 });
    });

    it('schickt System-Prompt aus den Ebenen, den Verlauf und den Schlüssel nur an den Anbieter', async () => {
      await session.call('PATCH', '/api/profile', { federalState: 'Beispielland' });
      await session.call('PUT', '/api/prompts/general', { text: 'Allgemein in {{bundesland}}.' });
      await session.call('PUT', `/api/prompts/subjects/${subjectId}`, { text: 'Fach {{fach}}.' });
      const group = (
        await session.call('POST', `/api/subjects/${subjectId}/groups`, { name: 'Beispiel-Thema' })
      ).body.id as string;
      await session.call('PUT', `/api/prompts/groups/${group}`, { text: 'Thema {{untergruppe}}.' });
      const chat = await newChat(group);

      const first = await send(chat, 'Erste Frage');
      const second = await send(chat, 'Zweite Frage');

      expect(calls).toHaveLength(2);
      const system = calls[0]?.messages[0];
      expect(system?.role).toBe('system');
      const text = system?.content ?? '';
      expect(text).toContain('Antworte in Markdown.');
      expect(text.indexOf('Allgemein in Beispielland.')).toBeGreaterThan(-1);
      expect(text.indexOf('Fach Beispielfach A.')).toBeGreaterThan(
        text.indexOf('Allgemein in Beispielland.'),
      );
      expect(text.indexOf('Thema Beispiel-Thema.')).toBeGreaterThan(
        text.indexOf('Fach Beispielfach A.'),
      );
      expect(calls[0]?.messages.slice(1)).toEqual([{ role: 'user', content: 'Erste Frage' }]);
      expect(calls[1]?.messages.slice(1)).toEqual([
        { role: 'user', content: 'Erste Frage' },
        { role: 'assistant', content: 'Hallo Welt' },
        { role: 'user', content: 'Zweite Frage' },
      ]);
      expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`);

      // Der Schlüssel taucht in keiner Antwort an den Browser auf.
      expect(first.text).not.toContain(KEY);
      expect(second.text).not.toContain(KEY);
      expect(JSON.stringify((await detail(chat)).messages)).not.toContain(KEY);
    });

    it('setzt den Titel nur bei der ersten Nachricht', async () => {
      const chat = await newChat();
      await send(chat, 'Erste Frage');
      await send(chat, 'Zweite Frage');
      expect((await detail(chat)).title).toBe('Erste Frage');
      await session.call('PATCH', `/api/chats/${chat}`, { title: 'Mein Titel' });
      await send(chat, 'Dritte Frage');
      expect((await detail(chat)).title).toBe('Mein Titel');
    });

    it('meldet fehlende Modelle, bevor etwas gespeichert wird', async () => {
      await session.call('PUT', '/api/model-settings', { default: null, fallback: [] });
      const chat = await newChat();
      const reply = await send(chat, 'Hallo');
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'no_model' });
      expect((await detail(chat)).messages).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('wechselt bei einem Fehler zum Ausweichmodell, solange noch kein Text da ist', async () => {
      const chat = await newChat();
      upstream = (call) => (call.model === 'modell-a' ? failing(429) : streamOf('Aus b'));
      const reply = await send(chat, 'Hallo');
      const events = parseSse(reply.text);
      expect(names(events)).toEqual(['start', 'snapshot', 'model', 'model', 'delta', 'done']);
      expect(events.filter((entry) => entry.event === 'model').map((entry) => entry.data)).toEqual([
        { providerId, model: 'modell-a' },
        { providerId, model: 'modell-b' },
      ]);
      expect(calls.map((call) => call.model)).toEqual(['modell-a', 'modell-b']);
      const stored = await detail(chat);
      expect(stored.messages[1]).toMatchObject({
        content: 'Aus b',
        status: 'complete',
        model: 'modell-b',
      });
    });

    it('wechselt bei einem falschen Schlüssel nicht, weil ein anderes Modell nicht hilft', async () => {
      const chat = await newChat();
      upstream = () => failing(401, JSON.stringify({ error: { message: `Ungültig: ${KEY}` } }));
      const reply = await send(chat, 'Hallo');
      const events = parseSse(reply.text);
      expect(names(events)).toEqual(['start', 'snapshot', 'model', 'failed']);
      expect(events.at(-1)?.data).toMatchObject({
        code: 'auth_failed',
        message: { status: 'error', errorCode: 'auth_failed', content: '' },
      });
      expect(calls).toHaveLength(1);
      // Der Text des Anbieters (mit dem Schlüssel) erscheint nirgends.
      expect(reply.text).not.toContain(KEY);
      expect(JSON.stringify(await detail(chat))).not.toContain(KEY);
    });

    it('meldet den letzten Fehler, wenn alle Modelle scheitern, und wiederholt auf Wunsch', async () => {
      const chat = await newChat();
      upstream = () => failing(429);
      const reply = await send(chat, 'Hallo');
      const events = parseSse(reply.text);
      expect(events.at(-1)).toMatchObject({
        event: 'failed',
        data: { code: 'rate_limited', message: { status: 'error', errorCode: 'rate_limited' } },
      });
      expect(calls.map((call) => call.model)).toEqual(['modell-a', 'modell-b']);

      upstream = () => streamOf('Jetzt klappt es');
      const again = await session.call('POST', `/api/chats/${chat}/retry`);
      const retryEvents = parseSse(again.text);
      expect(retryEvents[0]).toMatchObject({ event: 'start', data: { userMessage: null } });
      expect(retryEvents.at(-1)?.event).toBe('done');
      const stored = await detail(chat);
      expect(stored.messages.map((entry) => [entry.role, entry.content, entry.status])).toEqual([
        ['user', 'Hallo', 'complete'],
        ['assistant', 'Jetzt klappt es', 'complete'],
      ]);
      // Die Frage ging beim Wiederholen nicht doppelt an das Modell.
      expect(calls.at(-1)?.messages.slice(1)).toEqual([{ role: 'user', content: 'Hallo' }]);
    });

    it('lässt eine Teilantwort stehen, wenn der Strom mitten im Text abreißt', async () => {
      const chat = await newChat();
      upstream = ({ signal }) => {
        const stream = controlled(signal);
        queueMicrotask(() => {
          stream.push('Anfang');
          setTimeout(() => stream.fail(), 5);
        });
        return stream.response;
      };
      const reply = await send(chat, 'Hallo');
      const events = parseSse(reply.text);
      expect(events.at(-1)).toMatchObject({
        event: 'failed',
        data: { message: { status: 'error', content: 'Anfang' } },
      });
      // Es gibt keinen Wechsel mehr, wenn schon Text angekommen ist.
      expect(calls).toHaveLength(1);
      expect(names(events)).not.toContain('done');

      // Die Teilantwort bleibt im Verlauf der nächsten Frage.
      upstream = () => streamOf('Weiter');
      await send(chat, 'Und weiter?');
      expect(calls.at(-1)?.messages.slice(1)).toEqual([
        { role: 'user', content: 'Hallo' },
        { role: 'assistant', content: 'Anfang' },
        { role: 'user', content: 'Und weiter?' },
      ]);
    });

    it('behandelt leere Antworten als Fehler und probiert vorher das nächste Modell', async () => {
      const chat = await newChat();
      upstream = () => streamOf();
      const reply = await send(chat, 'Hallo');
      const events = parseSse(reply.text);
      expect(events.at(-1)).toMatchObject({
        event: 'failed',
        data: { code: 'empty_response' },
      });
      expect(calls.map((call) => call.model)).toEqual(['modell-a', 'modell-b']);

      upstream = (call) => (call.model === 'modell-a' ? streamOf() : streamOf('Aus b'));
      const second = await session.call('POST', `/api/chats/${chat}/retry`);
      expect(parseSse(second.text).at(-1)?.event).toBe('done');
    });

    it('wiederholt nur Antworten, die nicht vollständig sind', async () => {
      const chat = await newChat();
      expect((await session.call('POST', `/api/chats/${chat}/retry`)).status).toBe(409);
      await send(chat, 'Hallo');
      const reply = await session.call('POST', `/api/chats/${chat}/retry`);
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'nothing_to_retry' });
    });
  });

  describe('Laufende Antworten', () => {
    beforeEach(async () => {
      await addProvider();
      await chooseModels();
    });

    async function startHeld(chat: string) {
      let held: ReturnType<typeof controlled> | undefined;
      upstream = ({ signal }) => {
        held = controlled(signal);
        return held.response;
      };
      const pending = send(chat, 'Lange Frage');
      await vi.waitFor(() => expect(held).toBeDefined());
      held?.push('Anfang');
      await vi.waitFor(() => expect(harness.services.chats.running(chat)?.text).toBe('Anfang'));
      return {
        pending,
        held: held as ReturnType<typeof controlled>,
      };
    }

    it('bricht auf Wunsch ab und behält den bisherigen Text', async () => {
      const chat = await newChat();
      const { pending } = await startHeld(chat);
      expect((await detail(chat)).generating).toBe(true);

      const stopped = await session.call('POST', `/api/chats/${chat}/stop`);
      expect(stopped.status).toBe(204);
      const events = parseSse((await pending).text);
      expect(events.at(-1)).toMatchObject({
        event: 'stopped',
        data: { message: { status: 'stopped', content: 'Anfang', errorCode: null } },
      });
      expect((await detail(chat)).generating).toBe(false);
      // Ein zweiter Stopp ist harmlos.
      expect((await session.call('POST', `/api/chats/${chat}/stop`)).status).toBe(204);

      // Weitermachen: die Teilantwort bleibt im Verlauf, „Erneut versuchen“ ersetzt sie.
      upstream = () => streamOf('Neu');
      const again = await session.call('POST', `/api/chats/${chat}/retry`);
      expect(parseSse(again.text).at(-1)?.event).toBe('done');
      expect((await detail(chat)).messages[1]).toMatchObject({
        content: 'Neu',
        status: 'complete',
      });
    });

    it('lässt pro Chat nur eine Antwort gleichzeitig zu', async () => {
      const chat = await newChat();
      const { pending, held } = await startHeld(chat);
      const second = await send(chat, 'Noch eine');
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'busy' });
      expect((await session.call('POST', `/api/chats/${chat}/retry`)).status).toBe(409);
      held.end();
      await pending;
    });

    it('begrenzt die Zahl gleichzeitiger Antworten', async () => {
      harness.close();
      await build({ chats: { maxActive: 1 } });
      await addProvider();
      await chooseModels();
      const first = await newChat();
      const other = await newChat();
      const { pending, held } = await startHeld(first);
      const reply = await send(other, 'Hallo');
      expect(reply.status).toBe(429);
      expect(reply.body).toEqual({ error: 'too_busy' });
      held.end();
      await pending;
      upstream = () => streamOf('ok');
      expect((await send(other, 'Hallo')).status).toBe(200);
    });

    it('hängt sich wieder an eine laufende Antwort an und ersetzt den Stand', async () => {
      const chat = await newChat();
      const { pending, held } = await startHeld(chat);

      const attached = session.call('GET', `/api/chats/${chat}/generation`);
      // Der zweite Zuhörer bekommt den bisherigen Text im Stand und danach alles Weitere.
      await vi.waitFor(() => expect(harness.services.chats.running(chat)).not.toBeNull());
      held.push(' und Ende');
      held.end();

      const first = parseSse((await pending).text);
      const second = parseSse((await attached).text);
      expect(textOf(first)).toBe('Anfang und Ende');
      expect(second[0]).toMatchObject({
        event: 'snapshot',
        data: { assistantMessageId: expect.any(String), model: { model: 'modell-a' } },
      });
      const snapshotText = (second[0]?.data.text as string) ?? '';
      expect(`${snapshotText}${textOf(second)}`).toBe('Anfang und Ende');
      expect(second.at(-1)?.event).toBe('done');
    });

    it('antwortet ohne laufende Antwort mit 204', async () => {
      const chat = await newChat();
      const reply = await session.call('GET', `/api/chats/${chat}/generation`);
      expect(reply.status).toBe(204);
      expect(reply.text).toBe('');
    });

    it('läuft weiter und speichert, wenn niemand mehr zuhört', async () => {
      const chat = await newChat();
      let held: ReturnType<typeof controlled> | undefined;
      upstream = ({ signal }) => {
        held = controlled(signal);
        return held.response;
      };
      const started = harness.services.chats.send(chat, 'Hallo');
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      // Ein Zuhörer meldet sich an und gleich wieder ab, wie ein Gerät, das einschläft.
      const { unsubscribe } = started.value.generation.attach(() => {});
      unsubscribe();
      await vi.waitFor(() => expect(held).toBeDefined());
      held?.push('Trotzdem da');
      held?.end();
      await vi.waitFor(() => expect(harness.services.chats.running(chat)).toBeNull());
      expect((await detail(chat)).messages[1]).toMatchObject({
        content: 'Trotzdem da',
        status: 'complete',
      });
    });

    it('markiert Antworten, die beim Beenden des Servers liefen, als unterbrochen', async () => {
      const chat = await newChat();
      await send(chat, 'Hallo');
      const db = harness.services.database.db;
      const row = db.select().from(messages).all()[1];
      expect(row).toBeDefined();
      db.update(messages)
        .set({ status: 'streaming', content: 'Halb' })
        .where(
          // biome-ignore lint/style/noNonNullAssertion: oben geprüft
          (await import('drizzle-orm')).eq(messages.id, row!.id),
        )
        .run();

      // Neuer Start desselben Datenverzeichnisses.
      const restarted = new ChatService(db, harness.services.providers);
      const stored = restarted.get(chat);
      expect(stored.ok && stored.value.messages[1]).toMatchObject({
        status: 'interrupted',
        content: 'Halb',
      });
      const retry = restarted.retry(chat);
      expect(retry.ok).toBe(true);
      if (retry.ok) retry.value.generation.abort.abort();
      await vi.waitFor(() => expect(restarted.running(chat)).toBeNull());
    });

    it('bricht eine laufende Antwort ab, wenn der Chat gelöscht wird', async () => {
      const chat = await newChat();
      const { pending } = await startHeld(chat);
      expect((await session.call('DELETE', `/api/chats/${chat}`)).status).toBe(204);
      const events = parseSse((await pending).text);
      expect(events.at(-1)?.event).toBe('stopped');
      expect(harness.services.chats.running(chat)).toBeNull();
      expect((await session.call('GET', `/api/chats/${chat}`)).status).toBe(404);
    });
  });

  describe('Modellwahl', () => {
    beforeEach(async () => {
      await addProvider();
      await chooseModels();
    });

    const pick = (model: string) => ({ providerId, model });

    it('nimmt das Standardmodell, dann das des Fachs, dann das des Chats', async () => {
      const chat = await newChat();
      await send(chat, 'Standard');
      expect(calls.at(-1)?.model).toBe('modell-a');

      const subject = await session.call('PUT', `/api/subjects/${subjectId}/model`, {
        model: pick('modell-b'),
      });
      expect(subject.status).toBe(200);
      expect(subject.body).toMatchObject({ id: subjectId, model: pick('modell-b') });
      await send(chat, 'Fach');
      expect(calls.at(-1)?.model).toBe('modell-b');

      const patched = await session.call('PATCH', `/api/chats/${chat}`, {
        model: pick('modell-a'),
      });
      expect(patched.body).toMatchObject({ model: pick('modell-a') });
      await send(chat, 'Chat');
      expect(calls.at(-1)?.model).toBe('modell-a');

      // Wieder aufheben.
      await session.call('PATCH', `/api/chats/${chat}`, { model: null });
      await session.call('PUT', `/api/subjects/${subjectId}/model`, { model: null });
      await send(chat, 'Wieder Standard');
      expect(calls.at(-1)?.model).toBe('modell-a');
      const list = (await session.call('GET', '/api/subjects')).body as {
        subjects: { id: string; model: unknown }[];
      };
      expect(list.subjects[0]?.model).toBeNull();
    });

    it('weist unbekannte Modelle und Anbieter ab', async () => {
      const chat = await newChat();
      const unknownModel = await session.call('PATCH', `/api/chats/${chat}`, {
        model: pick('gibt-es-nicht'),
      });
      expect(unknownModel.status).toBe(400);
      expect(unknownModel.body).toMatchObject({ error: 'invalid_input', field: 'model' });
      const unknownProvider = await session.call('PUT', `/api/subjects/${subjectId}/model`, {
        model: { providerId: '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f', model: 'modell-a' },
      });
      expect(unknownProvider.status).toBe(400);
      const badShape = await session.call('PUT', `/api/subjects/${subjectId}/model`, {
        model: { providerId: 'x' },
      });
      expect(badShape.status).toBe(400);
      expect((await session.call('PUT', `/api/subjects/${subjectId}/model`, {})).status).toBe(400);
      expect(
        (
          await session.call('PUT', '/api/subjects/5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f/model', {
            model: null,
          })
        ).status,
      ).toBe(404);
    });

    it('fällt aufs Standardmodell zurück, wenn das gewählte Modell entfällt', async () => {
      const chat = await newChat();
      await session.call('PATCH', `/api/chats/${chat}`, { model: pick('modell-b') });
      // Das Modell verschwindet aus der Liste des Anbieters.
      await session.call('PATCH', `/api/providers/${providerId}`, { models: [{ id: 'modell-a' }] });
      await send(chat, 'Hallo');
      expect(calls.at(-1)?.model).toBe('modell-a');
    });

    it('löst die Wahl auf, wenn der Anbieter gelöscht wird', async () => {
      const chat = await newChat();
      await session.call('PUT', `/api/subjects/${subjectId}/model`, { model: pick('modell-b') });
      await session.call('PATCH', `/api/chats/${chat}`, { model: pick('modell-b') });
      expect((await session.call('DELETE', `/api/providers/${providerId}`)).status).toBe(204);

      const subjects = (await session.call('GET', '/api/subjects')).body as {
        subjects: { model: unknown }[];
      };
      expect(subjects.subjects[0]?.model).toBeNull();
      expect((await detail(chat)).model).toBeNull();
      const reply = await send(chat, 'Hallo');
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'no_model' });
    });
  });
});

describe('Ausgabe ohne Zuhörer', () => {
  it('liefert das Ende einer fertigen Antwort im Stand', async () => {
    const harness = createHarness({
      fetch: (async () => streamOf('Fertig')) as unknown as typeof fetch,
    });
    try {
      const session = await harness.signIn();
      const subject = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
        .id as string;
      const provider = (
        await session.call('POST', '/api/providers', {
          name: 'Beispiel-Anbieter',
          baseUrl: BASE_URL,
          apiKey: KEY,
          models: [{ id: 'modell-a' }],
        })
      ).body.id as string;
      await session.call('PUT', '/api/model-settings', {
        default: { providerId: provider, model: 'modell-a' },
        fallback: [],
      });
      const chat = (await session.call('POST', '/api/chats', { subjectId: subject })).body
        .id as string;
      const started = harness.services.chats.send(chat, 'Hallo');
      if (!started.ok) throw new Error('Start fehlgeschlagen');
      await vi.waitFor(() => expect(started.value.generation.finished).toBe(true));
      const late: Reply[] = [];
      const { snapshot } = started.value.generation.attach(() => late.push({} as Reply));
      expect(snapshot.ended).toMatchObject({ type: 'done' });
      expect(snapshot.text).toBe('Fertig');
      expect(late).toHaveLength(0);
    } finally {
      harness.close();
    }
  });
});
