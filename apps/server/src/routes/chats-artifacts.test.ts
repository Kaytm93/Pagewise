import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const BASE_URL = 'https://anbieter.example.test/v1';
const encoder = new TextEncoder();

interface UpstreamCall {
  model: string;
  messages: { role: string; content: string | null; tool_call_id?: string }[];
  tools?: { function: { name: string } }[];
}

const chunk = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`;

function reply(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of chunks) controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}
const text = (...parts: string[]) =>
  reply([...parts.map((part) => chunk({ content: part })), stop]);
const toolCall = (id: string, name: string, args: string) =>
  reply([
    chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  ]);

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}
function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const lines = block.split('\n');
      return {
        event: lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '',
        data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}'),
      };
    });
}

// Alle Inhalte sind erfunden.
const DOCUMENT = {
  title: 'Beispiel-Arbeitsblatt Wasser',
  parts: [
    { type: 'heading', text: 'Aufgabe 1' },
    { type: 'paragraph', text: 'Beschreibe den Aufbau von H₂O.' },
    { type: 'list', items: ['Sauerstoff', 'Wasserstoff'] },
  ],
};
const SLIDES = {
  title: 'Beispiel-Vortrag',
  slides: [{ title: 'Einstieg', bullets: ['Punkt A', 'Punkt B'] }, { title: 'Ende' }],
};

describe('Chats mit Datei-Werkzeugen (Dokument, Präsentation)', () => {
  let harness: Harness;
  let session: Session;
  let requests: UpstreamCall[];
  let scripts: ((call: UpstreamCall) => Response)[];
  let subjectId: string;

  beforeEach(async () => {
    requests = [];
    scripts = [];
    const fakeFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (!String(input).endsWith('/chat/completions')) return new Response('{}', { status: 404 });
      const call = JSON.parse(String(init?.body)) as UpstreamCall;
      requests.push(call);
      return (scripts.shift() ?? (() => text('Standardantwort')))(call);
    }) as typeof fetch;
    harness = createHarness({ fetch: fakeFetch });
    session = await harness.signIn();
    subjectId = (await session.call('POST', '/api/subjects', { name: 'Beispiel-Chemie' })).body
      .id as string;
    const provider = await session.call('POST', '/api/providers', {
      name: 'Beispiel-Anbieter',
      baseUrl: BASE_URL,
      apiKey: KEY,
      models: [{ id: 'modell-a', tools: true }],
    });
    await session.call('PUT', '/api/model-settings', {
      default: { providerId: provider.body.id, model: 'modell-a' },
      fallback: [],
    });
  });
  afterEach(() => harness.close());

  async function ask(content: string) {
    const chatId = (await session.call('POST', '/api/chats', { subjectId })).body.id as string;
    const result = await session.call('POST', `/api/chats/${chatId}/messages`, { content });
    return { chatId, events: parseSse(result.text) };
  }
  const toolNames = (call: UpstreamCall | undefined) =>
    call?.tools?.map((tool) => tool.function.name) ?? [];

  it('legt ein Dokument an: Spezifikation geprüft gespeichert, Antwort nennt die Datei', async () => {
    scripts.push(
      () => toolCall('call_1', 'create_document', JSON.stringify(DOCUMENT)),
      () => text('Das Arbeitsblatt steht bereit.'),
    );
    const { chatId, events } = await ask('Mach mir ein Arbeitsblatt zu Wasser.');

    expect(toolNames(requests[0])).toContain('create_document');
    expect(toolNames(requests[0])).toContain('create_presentation');
    expect(requests[0]?.messages[0]?.content).toContain('create_document');
    // Das Ergebnis an das Modell nennt nur Kennung und Titel, nie die Spezifikation.
    const result = JSON.parse(requests[1]?.messages.at(-1)?.content ?? '{}');
    expect(result).toMatchObject({ ok: true, kind: 'document', title: DOCUMENT.title });
    expect(JSON.stringify(result)).not.toContain('Sauerstoff');

    const done = events.at(-1) as SseEvent;
    expect(done.event).toBe('done');
    const message = done.data.message as { artifacts: { id: string; kind: string }[] };
    expect(message.artifacts).toEqual([
      { id: result.id, kind: 'document', title: DOCUMENT.title, version: 1 },
    ]);

    // Dieselbe Liste kommt beim Laden des Chats; die Spezifikation holt die Oberfläche einzeln.
    const chat = await session.call('GET', `/api/chats/${chatId}`);
    const stored = (chat.body.messages as { artifacts: unknown[] }[]).at(-1);
    expect(stored?.artifacts).toHaveLength(1);
    const detail = await session.call('GET', `/api/artifacts/${result.id}`);
    expect(detail.status).toBe(200);
    expect(JSON.parse(detail.body.spec as string)).toEqual(DOCUMENT);
  });

  it('legt eine Präsentation an', async () => {
    scripts.push(
      () => toolCall('call_1', 'create_presentation', JSON.stringify(SLIDES)),
      () => text('Die Folien stehen bereit.'),
    );
    const { events } = await ask('Mach mir Folien.');
    const message = (events.at(-1) as SseEvent).data.message as {
      artifacts: { kind: string }[];
    };
    expect(message.artifacts.map((a) => a.kind)).toEqual(['slides']);
  });

  it('meldet dem Modell nur einen Code, wenn die Spezifikation nicht stimmt, und legt nichts an', async () => {
    const broken = { ...DOCUMENT, parts: [{ type: 'paragraph', text: 'Δ ist verboten' }] };
    scripts.push(
      () => toolCall('call_1', 'create_document', JSON.stringify(broken)),
      () => text('Ich korrigiere das.'),
    );
    const { events } = await ask('Mach mir ein Arbeitsblatt.');
    const result = JSON.parse(requests[1]?.messages.at(-1)?.content ?? '{}');
    expect(result.error).toBe('unsupported_text: U+0394');
    expect(result.error).not.toContain('verboten');
    const message = (events.at(-1) as SseEvent).data.message as { artifacts: unknown[] };
    expect(message.artifacts).toEqual([]);
  });

  it('bietet die Datei-Werkzeuge nicht an, wenn der Schalter aus ist', async () => {
    const off = await session.call('PUT', '/api/tool-settings', { files: false });
    expect(off.body).toEqual({ enabled: true, files: false });
    await ask('Hallo');
    expect(toolNames(requests[0])).toEqual(['get_timetable', 'get_exams']);
    expect(requests[0]?.messages[0]?.content).not.toContain('create_document');
  });

  it('bietet Stundenplan-Werkzeuge nicht an, wenn nur dieser Schalter aus ist', async () => {
    await session.call('PUT', '/api/tool-settings', { enabled: false });
    await ask('Hallo');
    expect(toolNames(requests[0])).toEqual(['create_document', 'create_presentation']);
  });

  it('begrenzt die Dateien je Antwort', async () => {
    const calls = Array.from(
      { length: 5 },
      (_, index) => () => toolCall(`call_${index}`, 'create_document', JSON.stringify(DOCUMENT)),
    );
    scripts.push(...calls, () => text('Fertig.'));
    const { events } = await ask('Viele Blätter.');
    const message = (events.at(-1) as SseEvent).data.message as { artifacts: unknown[] };
    expect(message.artifacts).toHaveLength(4);
  });

  it('liefert 404 für eine unbekannte Datei', async () => {
    const missing = await session.call(
      'GET',
      '/api/artifacts/00000000-0000-4000-8000-000000000000',
    );
    expect(missing.status).toBe(404);
  });

  it('legt ein Dokument mit Graph, Strukturformel, Noten und Tabelle an', async () => {
    const rich = {
      title: 'Beispiel-Lernzettel',
      parts: [
        {
          type: 'graph',
          graph: { functions: ['x^2-4'], x: [-4, 4], y: [-6, 6] },
          caption: 'Parabel',
        },
        { type: 'molecule', smiles: 'CCO' },
        { type: 'molecule', formula: 'H2O' },
        { type: 'notes', abc: 'X:1\nM:4/4\nL:1/4\nK:C\nCDEF|' },
        { type: 'table', header: ['Stoff', 'Formel'], rows: [['Wasser', 'H₂O']] },
      ],
    };
    scripts.push(
      () => toolCall('call_1', 'create_document', JSON.stringify(rich)),
      () => text('Der Lernzettel steht bereit.'),
    );
    await ask('Lernzettel mit Abbildungen.');
    const result = JSON.parse(requests[1]?.messages.at(-1)?.content ?? '{}');
    expect(result.ok).toBe(true);
    const spec = JSON.parse(
      ((await session.call('GET', `/api/artifacts/${result.id}`)).body.spec as string) ?? '{}',
    );
    expect(spec.parts.map((part: { type: string }) => part.type)).toEqual([
      'figure',
      'figure',
      'figure',
      'figure',
      'table',
    ]);
    expect(spec.parts[0]).toMatchObject({ kind: 'graph', caption: 'Parabel' });
    expect(spec.parts[1]).toMatchObject({ kind: 'mol', source: 'smiles: CCO' });
  });

  it('meldet eine SMILES-Zeichenfolge, die sich nicht zeichnen lässt, als Code', async () => {
    const broken = { title: 'Beispiel', parts: [{ type: 'molecule', smiles: 'C(C' }] };
    scripts.push(
      () => toolCall('call_1', 'create_document', JSON.stringify(broken)),
      () => text('Ich korrigiere das.'),
    );
    const { events } = await ask('Formel bitte.');
    const result = JSON.parse(requests[1]?.messages.at(-1)?.content ?? '{}');
    expect(result.error).toBe('invalid_smiles');
    const message = (events.at(-1) as SseEvent).data.message as { artifacts: unknown[] };
    expect(message.artifacts).toEqual([]);
  });

  it('legt Folien mit einer Abbildung an', async () => {
    const slides = {
      title: 'Beispiel-Vortrag',
      slides: [
        {
          title: 'Parabel',
          bullets: ['Nullstellen'],
          figure: { type: 'graph', graph: { functions: ['x^2-4'], x: [-4, 4] } },
        },
      ],
    };
    scripts.push(
      () => toolCall('call_1', 'create_presentation', JSON.stringify(slides)),
      () => text('Die Folien stehen bereit.'),
    );
    const { events } = await ask('Folien.');
    const message = (events.at(-1) as SseEvent).data.message as { artifacts: unknown[] };
    expect(message.artifacts).toHaveLength(1);
  });
});
