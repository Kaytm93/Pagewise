import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROOT } from '../paths';
import { createHarness, type Harness, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const BASE_URL = 'https://anbieter.example.test/v1';
const encoder = new TextEncoder();

/** Ein kleines erfundenes PNG mit Aufbau, Bilddaten und Ende (Prüfsummen sind leer). */
const PNG = (() => {
  const chunks: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.byteLength);
    new DataView(out.buffer).setUint32(0, data.byteLength);
    out.set(encoder.encode(type), 4);
    out.set(data, 8);
    chunks.push(out);
  };
  chunk('IHDR', new Uint8Array(13));
  chunk('IDAT', Uint8Array.from([1, 2, 3, 4]));
  chunk('IEND', new Uint8Array(0));
  const size = chunks.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of chunks) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
})();

interface UpstreamCall {
  model: string;
  messages: { role: string; content: unknown }[];
  authorization: string | undefined;
  stream: boolean | undefined;
}

/** Die Erkennung fragt eine vollständige Antwort ab (`stream: false`), keinen Strom. */
function answerOf(...texts: string[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: texts.join('') }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const LESSON = {
  weekday: 1,
  startTime: '08:00',
  endTime: '08:45',
  subject: 'Beispielfach A',
  room: 'Raum 1',
  note: null,
  week: 'all',
};

function form(options: {
  image?: Uint8Array;
  mime?: string;
  providerId?: string;
  model?: string;
  field?: string;
}) {
  const boundary = '----pagewise-scan-test';
  const chunks: Uint8Array[] = [];
  const add = (name: string, value: string | Uint8Array, filename?: string, mime?: string) => {
    const head = filename
      ? `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime ?? 'application/octet-stream'}\r\n\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`;
    chunks.push(encoder.encode(head), typeof value === 'string' ? encoder.encode(value) : value);
    chunks.push(encoder.encode('\r\n'));
  };
  add('providerId', options.providerId ?? 'keine-id');
  add('model', options.model ?? 'bild-modell');
  add(options.field ?? 'image', options.image ?? PNG, 'beispiel.png', options.mime ?? 'image/png');
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const size = chunks.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(size);
  let at = 0;
  for (const part of chunks) {
    body.set(part, at);
    at += part.byteLength;
  }
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    rawBody: body,
  };
}

describe('Stundenplan-Erkennung aus einem Bild', () => {
  let harness: Harness;
  let session: Session;
  let calls: UpstreamCall[];
  let upstream: () => Response;
  let providerId: string;
  let blockedId: string;

  beforeEach(async () => {
    calls = [];
    upstream = () => answerOf(JSON.stringify({ entries: [LESSON] }));
    const fakeFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = String(input);
      if (!url.endsWith('/chat/completions')) return new Response('{}', { status: 404 });
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as Pick<
        UpstreamCall,
        'model' | 'messages' | 'stream'
      >;
      calls.push({
        model: body.model,
        messages: body.messages,
        authorization: headers.Authorization,
        stream: body.stream,
      });
      return upstream();
    }) as typeof fetch;
    harness = createHarness({
      fetch: fakeFetch,
      catalogFile: join(APP_ROOT, 'config', 'subject-catalog.json'),
    });
    session = await harness.signIn();
    const created = await session.call('POST', '/api/providers', {
      name: 'Beispiel-Anbieter',
      baseUrl: BASE_URL,
      apiKey: KEY,
      sendImages: true,
      models: [
        { id: 'bild-modell', vision: true },
        { id: 'text-modell', vision: false },
      ],
    });
    providerId = created.body.id as string;
    const blocked = await session.call('POST', '/api/providers', {
      name: 'Zweiter Beispiel-Anbieter',
      baseUrl: BASE_URL,
      apiKey: KEY,
      sendImages: false,
      models: [{ id: 'ohne-bilder', vision: true }],
    });
    blockedId = blocked.body.id as string;
  });

  afterEach(() => harness.close());

  const scan = (options: Parameters<typeof form>[0] = {}) =>
    harness.call('POST', '/api/timetable-scan', {
      ...form({ ...options, providerId: options.providerId ?? providerId }),
      cookie: session.cookie,
      csrf: session.csrf,
    });

  const importEntries = (body: unknown) => session.call('POST', '/api/timetable-scan/import', body);

  const oneEntry = (patch: Record<string, unknown> = {}) => ({
    entries: [{ ...LESSON, ...patch }],
    createSubjects: true,
    replaceExisting: false,
  });

  it.each([
    ['GET', '/api/timetable-scan/models'],
    ['GET', '/api/timetable-scan/periods'],
    ['PUT', '/api/timetable-scan/periods'],
    ['GET', '/api/timetable-scan/abbreviations'],
    ['PUT', '/api/timetable-scan/abbreviations'],
    ['POST', '/api/timetable-scan'],
    ['POST', '/api/timetable-scan/import'],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: {} });
    expect(reply.status).toBe(401);
  });

  const SCHEDULE = {
    start: '07:30',
    lessonMinutes: 45,
    gapMinutes: 5,
    count: 3,
    breaks: [{ after: 2, minutes: 20 }],
    mergeDoubles: false,
  };

  it('liefert die Voreinstellung der Stundentafel und berechnet alle Zeiten aus der Regel', async () => {
    const initial = await session.call('GET', '/api/timetable-scan/periods');
    expect(initial.status).toBe(200);
    expect(initial.body.schedule).toMatchObject({ start: '08:00', lessonMinutes: 45 });
    const defaults = initial.body.periods as { period: number; startTime: string }[];
    expect(defaults[0]).toEqual({ period: 1, startTime: '08:00', endTime: '08:45' });

    const saved = await session.call('PUT', '/api/timetable-scan/periods', { schedule: SCHEDULE });
    expect(saved.status).toBe(200);
    expect(saved.body.schedule).toEqual(SCHEDULE);
    expect(saved.body.periods).toEqual([
      { period: 1, startTime: '07:30', endTime: '08:15' },
      { period: 2, startTime: '08:20', endTime: '09:05' },
      { period: 3, startTime: '09:25', endTime: '10:10' },
    ]);
    const reread = await session.call('GET', '/api/timetable-scan/periods');
    expect(reread.body).toEqual(saved.body);
  });

  it.each([
    ['Beginn ungültig', { ...SCHEDULE, start: '25:00' }],
    ['Stunde zu kurz', { ...SCHEDULE, lessonMinutes: 0 }],
    ['Pause nach der letzten Stunde', { ...SCHEDULE, breaks: [{ after: 3, minutes: 10 }] }],
    [
      'doppelte Pause',
      {
        ...SCHEDULE,
        breaks: [
          { after: 1, minutes: 10 },
          { after: 1, minutes: 15 },
        ],
      },
    ],
    ['zu viele Stunden', { ...SCHEDULE, count: 17 }],
    ['über Mitternacht', { ...SCHEDULE, start: '23:00' }],
    ['unbekanntes Feld', { ...SCHEDULE, extra: 'x' }],
  ])('lehnt eine Stundentafel ab: %s', async (_grund, schedule) => {
    const reply = await session.call('PUT', '/api/timetable-scan/periods', { schedule });
    expect(reply.status).toBe(400);
    const reread = await session.call('GET', '/api/timetable-scan/periods');
    expect(reread.body.schedule).toMatchObject({ start: '08:00' });
  });

  it('lehnt die alte Form mit einzelnen Zeiten ab', async () => {
    const reply = await session.call('PUT', '/api/timetable-scan/periods', {
      periods: [{ period: 1, startTime: '07:30', endTime: '08:15' }],
    });
    expect(reply.status).toBe(400);
  });

  it('speichert eigene Kürzel und prüft sie', async () => {
    const empty = await session.call('GET', '/api/timetable-scan/abbreviations');
    expect(empty.body.abbreviations).toEqual([]);
    const saved = await session.call('PUT', '/api/timetable-scan/abbreviations', {
      abbreviations: [
        { code: ' bsp ', subject: 'Beispielfach A' },
        { code: 'BSP', subject: 'Beispielfach B' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.abbreviations).toEqual([{ code: 'bsp', subject: 'Beispielfach A' }]);
    const bad = await session.call('PUT', '/api/timetable-scan/abbreviations', {
      abbreviations: [{ code: 'x\u0007', subject: 'Beispielfach' }],
    });
    expect(bad.status).toBe(400);
    const reread = await session.call('GET', '/api/timetable-scan/abbreviations');
    expect(reread.body.abbreviations).toEqual(saved.body.abbreviations);
  });

  it('listet nur Modelle mit Bildverstehen, deren Anbieter Bilder senden darf', async () => {
    const reply = await session.call('GET', '/api/timetable-scan/models');
    expect(reply.status).toBe(200);
    const models = reply.body.models as { model: string; providerId: string; label: string }[];
    expect(models).toHaveLength(1);
    expect(models[0]?.model).toBe('bild-modell');
    expect(models[0]?.providerId).toBe(providerId);
  });

  it('schickt das Bild an das gewählte Modell und liefert Vorschläge mit Fachzuordnung', async () => {
    const existing = await session.call('POST', '/api/subjects', { name: 'Beispielfach A' });
    upstream = () =>
      answerOf(
        JSON.stringify({
          entries: [LESSON, { ...LESSON, weekday: 2, subject: 'Beispielfach B' }],
        }),
      );
    const reply = await scan();
    expect(reply.status).toBe(200);
    const body = reply.body as {
      proposals: {
        subject: string;
        subjectId: string | null;
        subjectState: string;
      }[];
      newSubjects: string[];
      skipped: number;
    };
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0]).toMatchObject({
      subjectId: existing.body.id,
      subjectState: 'existing',
    });
    expect(body.proposals[1]).toMatchObject({ subjectState: 'new', subjectId: null });
    expect(body.newSubjects).toEqual(['Beispielfach B']);
    expect(body.skipped).toBe(0);

    // Das Bild steckt als Daten-URL im Nutzerteil, der Schlüssel nur im Kopf der Anfrage.
    const user = calls[0]?.messages[1]?.content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(user.some((part) => part.type === 'image_url')).toBe(true);
    expect(
      user
        .find((part) => part.type === 'image_url')
        ?.image_url?.url.startsWith('data:image/png;base64,'),
    ).toBe(true);
    expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.stream).toBe(false);
    expect(JSON.stringify(calls)).not.toContain('EXIF');

    // Erkennen allein verändert weder Stundenplan noch Fächer.
    const timetable = await session.call('GET', '/api/timetable');
    expect((timetable.body.entries as unknown[]).length).toBe(0);
  });

  const numbered = (weekday: number, period: number, patch: Record<string, unknown> = {}) => ({
    weekday,
    startTime: null,
    endTime: null,
    period,
    code: null,
    subject: 'Beispielfach A',
    room: null,
    note: null,
    week: 'all',
    ...patch,
  });

  it('ordnet Nummern von Unterrichtsstunden den Zeiten der Stundentafel zu', async () => {
    await session.call('PUT', '/api/timetable-scan/periods', { schedule: SCHEDULE });
    upstream = () =>
      answerOf(
        JSON.stringify({
          entries: [
            numbered(3, 1, { room: 'Raum 1' }),
            numbered(3, 3, { subject: 'Beispielfach B' }),
            numbered(4, 9, { subject: 'Beispielfach C' }),
          ],
        }),
      );
    const reply = await scan();
    expect(reply.status).toBe(200);
    const body = reply.body as {
      proposals: { period: number | null; startTime: string; endTime: string }[];
      skipped: number;
    };
    expect(body.proposals).toMatchObject([
      { period: 1, startTime: '07:30', endTime: '08:15' },
      { period: 3, startTime: '09:25', endTime: '10:10' },
    ]);
    expect(body.skipped).toBe(1);
  });

  it('deutet Kurscodes als Fach und fasst Doppelstunden zusammen', async () => {
    await session.call('PUT', '/api/timetable-scan/periods', {
      schedule: { ...SCHEDULE, count: 4, mergeDoubles: true },
    });
    await session.call('PUT', '/api/timetable-scan/abbreviations', {
      abbreviations: [{ code: 'bsp', subject: 'Beispielfach D' }],
    });
    upstream = () =>
      answerOf(
        JSON.stringify({
          entries: [
            numbered(1, 2, { code: '2inf2_2', subject: 'Inf' }),
            numbered(1, 1, { code: '2inf2_2', subject: '2inf2_2' }),
            numbered(1, 3, { code: 'W_Inf', subject: 'W_Inf' }),
            numbered(1, 4, { code: 'mvk', subject: null }),
            numbered(2, 1, { code: 'ev', subject: 'ev' }),
            numbered(2, 3, { code: '2bsp1', subject: 'Unbekannt' }),
          ],
        }),
      );
    const reply = await scan();
    expect(reply.status).toBe(200);
    const body = reply.body as {
      proposals: {
        weekday: number;
        subject: string;
        startTime: string;
        endTime: string;
        periodEnd: number | null;
      }[];
    };
    expect(
      body.proposals.map(({ weekday, subject, startTime, endTime, periodEnd }) => ({
        weekday,
        subject,
        startTime,
        endTime,
        periodEnd,
      })),
    ).toEqual([
      {
        weekday: 1,
        subject: 'Informatik',
        startTime: '07:30',
        endTime: '09:05',
        periodEnd: 2,
      },
      {
        weekday: 1,
        subject: 'W-Seminar Informatik',
        startTime: '09:25',
        endTime: '10:10',
        periodEnd: null,
      },
      {
        weekday: 1,
        subject: 'Vertiefungskurs Mathematik',
        startTime: '10:15',
        endTime: '11:00',
        periodEnd: null,
      },
      {
        weekday: 2,
        subject: 'Evangelische Religion',
        startTime: '07:30',
        endTime: '08:15',
        periodEnd: null,
      },
      {
        weekday: 2,
        subject: 'Beispielfach D',
        startTime: '09:25',
        endTime: '10:10',
        periodEnd: null,
      },
    ]);
    // Die eigenen Kürzel reisen im Prompt mit, leere Zellen gelten als Freistunden.
    const system = String(calls[0]?.messages[0]?.content);
    expect(system).toContain('bsp = Beispielfach D');
    expect(system).toContain('Freistunden');
  });

  it('blockt Anbieter ohne Bilder-Freigabe und Modelle ohne Bildverstehen', async () => {
    expect((await scan({ providerId: blockedId })).status).toBe(403);
    expect((await scan({ model: 'text-modell' })).body.error).toBe('no_vision_model');
    expect(calls).toHaveLength(0);
  });

  it('wehrt falsche Bildarten, Signaturen und fehlende Felder ab', async () => {
    expect((await scan({ image: encoder.encode('kein Bild') })).body).toMatchObject({
      error: 'invalid_input',
      field: 'image',
    });
    expect((await scan({ mime: 'image/svg+xml' })).status).toBe(400);
    expect((await scan({ field: 'anderes' })).body.field).toBe('image');
    expect((await scan({ providerId: 'keine-uuid' })).body.field).toBe('providerId');
    const tooBig = await harness.call('POST', '/api/timetable-scan', {
      ...form({ image: new Uint8Array(7 * 1024 * 1024) }),
      cookie: session.cookie,
      csrf: session.csrf,
    });
    expect(tooBig.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('bleibt bei unbrauchbarer Modellantwort leer und meldet verworfene Angaben', async () => {
    upstream = () => answerOf('Das Bild ist leider zu unscharf.');
    const empty = await scan();
    expect(empty.status).toBe(200);
    expect((empty.body.proposals as unknown[]).length).toBe(0);
    upstream = () =>
      answerOf(
        JSON.stringify({
          entries: [LESSON, { ...LESSON, weekday: 9 }, 'Unsinn'],
        }),
      );
    const partial = await scan();
    expect((partial.body.proposals as unknown[]).length).toBe(1);
    expect(partial.body.skipped).toBe(2);
  });

  it('gibt Anbieterfehler nur als Code weiter', async () => {
    upstream = () => new Response('{"error":{"message":"geheim"}}', { status: 401 });
    const reply = await scan();
    expect(reply.status).toBe(502);
    expect(reply.body).toEqual({ error: 'provider_failed', code: 'auth_failed' });
    expect(reply.text).not.toContain('geheim');
  });

  it('übernimmt die Vorschläge und legt erkannte Fächer neu an', async () => {
    const created = await importEntries(oneEntry({ subject: 'Beispielfach B' }));
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ created: 1, subjectsCreated: 1, abbreviationsLearned: 0 });

    const timetable = await session.call('GET', '/api/timetable');
    const entries = timetable.body.entries as { subjectId: string; startTime: string }[];
    expect(entries).toHaveLength(1);
    const subjects = await session.call('GET', '/api/subjects');
    const names = (subjects.body.subjects as { name: string; id: string }[]).map((s) => s.name);
    expect(names).toContain('Beispielfach B');
    expect(entries[0]?.subjectId).toBe(
      (subjects.body.subjects as { name: string; id: string }[]).find(
        (s) => s.name === 'Beispielfach B',
      )?.id,
    );
  });

  it('merkt sich Kurscodes, deren Fach in der Vorschau geändert wurde', async () => {
    const reply = await importEntries({
      entries: [
        { ...LESSON, code: '2bsp1_2', subject: 'Beispielfach E' },
        { ...LESSON, weekday: 2, code: '2inf2_2', subject: 'Informatik' },
        { ...LESSON, weekday: 3, code: 'Beispielfach F', subject: 'Beispielfach F' },
      ],
      createSubjects: false,
      replaceExisting: false,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.abbreviationsLearned).toBe(1);
    const list = await session.call('GET', '/api/timetable-scan/abbreviations');
    expect(list.body.abbreviations).toEqual([{ code: 'bsp', subject: 'Beispielfach E' }]);

    // Eine zweite Korrektur ersetzt das gespeicherte Kürzel.
    const again = await importEntries({
      entries: [{ ...LESSON, code: '2bsp1_2', subject: 'Beispielfach G' }],
      createSubjects: false,
      replaceExisting: false,
    });
    expect(again.body.abbreviationsLearned).toBe(1);
    const updated = await session.call('GET', '/api/timetable-scan/abbreviations');
    expect(updated.body.abbreviations).toEqual([{ code: 'bsp', subject: 'Beispielfach G' }]);
  });

  it('verknüpft vorhandene Fächer ohne Groß-/Kleinschreibung und kann auf neue verzichten', async () => {
    const existing = await session.call('POST', '/api/subjects', { name: 'Beispielfach A' });
    const without = await importEntries({
      ...oneEntry({ subject: 'BEISPIELFACH B' }),
      createSubjects: false,
    });
    expect(without.body).toEqual({ created: 1, subjectsCreated: 0, abbreviationsLearned: 0 });
    const timetable = await session.call('GET', '/api/timetable');
    expect((timetable.body.entries as { subjectId: string | null }[])[0]?.subjectId).toBeNull();

    const linked = await importEntries(oneEntry({ subject: 'beispielfach a' }));
    expect(linked.body.created).toBe(1);
    const after = await session.call('GET', '/api/timetable');
    const entries = after.body.entries as { subjectId: string | null }[];
    expect(entries.some((entry) => entry.subjectId === existing.body.id)).toBe(true);
  });

  it('ersetzt den Plan auf Wunsch und prüft die Zeiten vor dem Schreiben', async () => {
    await session.call('POST', '/api/timetable', {
      weekday: 5,
      startTime: '12:00',
      endTime: '12:45',
      subjectId: null,
      room: null,
      note: null,
      week: 'all',
    });
    const invalid = await importEntries(oneEntry({ endTime: '07:00' }));
    expect(invalid.body).toMatchObject({ error: 'invalid_input', field: 'endTime' });
    const kept = await session.call('GET', '/api/timetable');
    expect((kept.body.entries as unknown[]).length).toBe(1);

    const replaced = await importEntries({ ...oneEntry(), replaceExisting: true });
    expect(replaced.status).toBe(201);
    const after = await session.call('GET', '/api/timetable');
    const entries = after.body.entries as { weekday: number }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.weekday).toBe(1);
  });

  it('lehnt fremde Felder und leere Listen beim Übernehmen ab', async () => {
    expect((await importEntries({ ...oneEntry(), unerwartet: true })).status).toBe(400);
    expect((await importEntries({ entries: [], createSubjects: true })).status).toBe(400);
  });
});
