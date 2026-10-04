import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Generation, GenerationEvent } from '../chats/generation';
import type { ChatFailure, ChatResult, ChatService, StartedGeneration } from '../chats/service';
import { idField, MESSAGE_MAX_CHARACTERS, messageField, titleField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import { SelectionSchema } from '../providers/models';

const CreateChatBody = z.strictObject({
  subjectId: idField,
  groupId: idField.nullable().optional(),
  title: titleField.optional(),
});
const UpdateChatBody = z
  .strictObject({
    title: titleField.optional(),
    model: SelectionSchema.nullable().optional(),
    engineProfileId: idField.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine((body) => !(body.model && body.engineProfileId));
const SendBody = z.strictObject({ content: messageField });
/** `viaApi`: diesen Versuch mit einem API-Modell statt des gewählten Agenten machen. */
const RetryBody = z.strictObject({ viaApi: z.boolean().optional() });
const SubjectModelBody = z.strictObject({ model: SelectionSchema.nullable() });
const SubjectEngineBody = z.strictObject({ engineProfileId: idField.nullable() });

// Zeichen können bis zu vier Byte belegen, dazu kommt das JSON drumherum.
const MESSAGE_BODY_LIMIT = MESSAGE_MAX_CHARACTERS * 4 + 1024;
const MESSAGES_PATH = /\/chats\/[^/]+\/messages$/;

/** Abstand der Lebenszeichen, damit Proxys und Browser eine ruhige Verbindung nicht schließen. */
const PING_INTERVAL_MS = 15_000;

function failure(c: Context, result: ChatFailure): Response {
  switch (result.error) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'unknown_model':
      return c.json({ error: 'invalid_input', field: 'model' }, 400);
    case 'unknown_engine':
      return c.json({ error: 'invalid_input', field: 'engineProfileId' }, 400);
    case 'busy':
      return c.json({ error: 'busy' }, 409);
    case 'workspace_busy':
      return c.json({ error: 'workspace_busy' }, 409);
    case 'no_model':
      return c.json({ error: 'no_model' }, 409);
    case 'nothing_to_retry':
      return c.json({ error: 'nothing_to_retry' }, 409);
    case 'too_busy':
      return c.json({ error: 'too_busy' }, 429);
  }
}

function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

function terminalName(event: GenerationEvent): string | null {
  return event.type === 'done' || event.type === 'failed' || event.type === 'stopped'
    ? event.type
    : null;
}

/**
 * Schickt eine laufende Antwort als Server-Sent Events. Ablauf: optional `start`, dann `snapshot` mit dem
 * bisherigen Stand (der Browser ersetzt damit seinen Text), danach `model`, `thinking`, `delta`, bei Agenten
 * `activity` (Werkzeugaufrufe) und zum Schluss `done`, `failed` oder `stopped`. Bricht die Verbindung ab, läuft die Antwort weiter: sie wird
 * gespeichert und der Browser kann sich mit GET /chats/:id/generation wieder anhängen.
 * Fehler enthalten nur Codes, nie Texte von Anbietern.
 */
function streamGeneration(c: Context, generation: Generation, start: StartedGeneration | null) {
  return streamSSE(c, async (stream) => {
    let pending: Promise<unknown> = Promise.resolve();
    const send = (event: string, data: unknown) => {
      pending = pending
        .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
        .catch(() => {});
    };

    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const onEvent = (event: GenerationEvent) => {
      switch (event.type) {
        case 'model':
          send('model', { providerId: event.providerId, model: event.model });
          break;
        case 'thinking':
          send('thinking', {});
          break;
        case 'delta':
          send('delta', { text: event.text });
          break;
        case 'activity':
          send('activity', { entry: event.entry });
          break;
        case 'done':
          send('done', { message: event.message });
          break;
        case 'stopped':
          send('stopped', { message: event.message });
          break;
        case 'failed':
          send('failed', { code: event.code, message: event.message });
          break;
      }
      if (terminalName(event)) finish();
    };

    if (start) {
      send('start', { userMessage: start.userMessage, assistantMessage: start.assistantMessage });
    }
    const { snapshot, unsubscribe } = generation.attach(onEvent);
    send('snapshot', {
      assistantMessageId: generation.assistantId,
      text: snapshot.text,
      model: snapshot.model,
      thinking: snapshot.thinking,
      activity: snapshot.activity,
    });
    if (snapshot.ended) onEvent(snapshot.ended);

    const timer = setInterval(() => send('ping', {}), PING_INTERVAL_MS);
    stream.onAbort(() => {
      unsubscribe();
      finish();
    });
    await finished;
    clearInterval(timer);
    unsubscribe();
    await pending;
  });
}

/**
 * Chats, Nachrichten und Antworten. Alles hängt an einem Fach (und optional an einer Untergruppe): Chats
 * bleiben in ihrem Fach. Der Text der Nachrichten wird nie in Logs oder Fehlern wiederholt.
 */
export function chatRoutes(chats: ChatService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const small = limitBody(16 * 1024);
  const large = limitBody(MESSAGE_BODY_LIMIT);
  const bySize: MiddlewareHandler = (c, next) =>
    MESSAGES_PATH.test(c.req.path) ? large(c, next) : small(c, next);
  app.use('/chats', small);
  app.use('/chats/*', bySize);

  const respond = <T>(c: Context, result: ChatResult<T>, status: 200 | 201 = 200) =>
    result.ok ? c.json(result.value as object, status) : failure(c, result);

  app.get('/chats', (c) => {
    const subjectId = idField.safeParse(c.req.query('subjectId'));
    if (!subjectId.success) return c.json({ error: 'invalid_input', field: 'subjectId' }, 400);
    const rawGroup = c.req.query('groupId');
    let groupId: string | null = null;
    if (rawGroup !== undefined) {
      const parsed = idField.safeParse(rawGroup);
      if (!parsed.success) return c.json({ error: 'invalid_input', field: 'groupId' }, 400);
      groupId = parsed.data;
    }
    const result = chats.list(subjectId.data, groupId);
    return result.ok ? c.json({ chats: result.value }) : failure(c, result);
  });

  app.post('/chats', async (c) => {
    const body = await readJson(c, CreateChatBody);
    if (!body.ok) return body.response;
    return respond(
      c,
      chats.create(body.data.subjectId, body.data.groupId ?? null, body.data.title),
      201,
    );
  });

  app.get('/chats/:id', (c) => {
    const id = idParam(c);
    return id ? respond(c, chats.get(id)) : c.json({ error: 'not_found' }, 404);
  });

  app.patch('/chats/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, UpdateChatBody);
    if (!body.ok) return body.response;
    return respond(c, chats.update(id, body.data));
  });

  app.delete('/chats/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = chats.remove(id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  app.post('/chats/:id/messages', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, SendBody);
    if (!body.ok) return body.response;
    const result = chats.send(id, body.data.content);
    if (!result.ok) return failure(c, result);
    return streamGeneration(c, result.value.generation, result.value);
  });

  app.post('/chats/:id/retry', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    // Der Rumpf ist optional: ohne Angabe wird wie bisher mit der gewählten Quelle wiederholt.
    let viaApi = false;
    if ((await c.req.text()).trim() !== '') {
      const body = await readJson(c, RetryBody);
      if (!body.ok) return body.response;
      viaApi = body.data.viaApi === true;
    }
    const result = chats.retry(id, { viaApi });
    if (!result.ok) return failure(c, result);
    return streamGeneration(c, result.value.generation, result.value);
  });

  // Wieder an eine laufende Antwort anhängen (z. B. nach dem Aufwecken des Geräts).
  app.get('/chats/:id/generation', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const generation = chats.running(id);
    return generation ? streamGeneration(c, generation, null) : c.body(null, 204);
  });

  app.post('/chats/:id/stop', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const existing = chats.get(id);
    if (!existing.ok) return failure(c, existing);
    chats.stop(id);
    return c.body(null, 204);
  });

  // Modellwahl eines Fachs. Die Fächer selbst verwaltet routes/subjects.ts.
  app.put('/subjects/:id/model', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, SubjectModelBody);
    if (!body.ok) return body.response;
    return respond(c, chats.setSubjectModel(id, body.data.model));
  });

  // Agent-CLI-Zugang eines Fachs (statt eines Modells).
  app.put('/subjects/:id/engine', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, SubjectEngineBody);
    if (!body.ok) return body.response;
    return respond(c, chats.setSubjectEngine(id, body.data.engineProfileId));
  });

  return app;
}
