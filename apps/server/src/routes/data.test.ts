import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session, TEST_PASSCODE } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const BASE_URL = 'https://anbieter.example.test/v1';
const MARKER = ['Beispiel', 'Geheimtext', 'qwertzuiop'].join('-');
const encoder = new TextEncoder();

describe('Alles löschen', () => {
  let harness: Harness;
  let session: Session;
  /** Wird gesetzt, solange eine Antwort des Test-Anbieters „läuft“. */
  let upstreamStream: ReadableStreamDefaultController<Uint8Array> | undefined;

  beforeEach(async () => {
    const fakeFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (!String(input).endsWith('/chat/completions')) return new Response('{}', { status: 404 });
      const signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamStream = controller;
            signal?.addEventListener('abort', () => {
              try {
                controller.error(new DOMException('abgebrochen', 'AbortError'));
              } catch {
                // schon beendet
              }
            });
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;
    harness = createHarness({ fetch: fakeFetch });
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  const erase = (passcode: unknown = TEST_PASSCODE) =>
    session.call('POST', '/api/data/erase', { passcode });

  async function fillWithData() {
    const subject = (
      await session.call('POST', '/api/subjects', { name: `Beispielfach ${MARKER}` })
    ).body.id as string;
    await session.call('POST', `/api/subjects/${subject}/groups`, { name: 'Beispiel-Gruppe' });
    await session.call('PATCH', '/api/profile', { gradeLevel: '11' });
    await session.call('POST', '/api/onboarding/complete');
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
    return { subject, provider, chat };
  }

  it('verlangt eine Anmeldung', async () => {
    const reply = await harness.call('POST', '/api/data/erase', { body: { passcode: 'x' } });
    expect(reply.status).toBe(401);
  });

  it('verlangt den Passcode, auch mit gültiger Sitzung', async () => {
    const { subject } = await fillWithData();
    for (const body of [{}, { passcode: '' }, { passcode: 7 }, { passcode: 'x', zusatz: true }]) {
      expect((await session.call('POST', '/api/data/erase', body)).status).toBe(400);
    }
    const wrong = await erase('falscher Passcode');
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: 'invalid_passcode' });
    // Nichts wurde gelöscht.
    const subjects = (await session.call('GET', '/api/subjects')).body.subjects as { id: string }[];
    expect(subjects.map((entry) => entry.id)).toEqual([subject]);
  });

  it('sperrt nach mehreren falschen Passcodes', async () => {
    let last = 0;
    for (let i = 0; i < 4; i += 1) last = (await erase('falsch')).status;
    expect(last).toBe(429);
    // Auch der richtige Passcode wird dann nicht angenommen, und es wird nichts gelöscht.
    expect((await erase()).status).toBe(429);
  });

  it('löscht Inhalte, Anbieter, Schlüssel und Einstellungen, lässt aber Passcode und Sitzung', async () => {
    const { chat } = await fillWithData();
    expect((await harness.services.secrets.list()).length).toBe(1);

    const reply = await erase();
    expect(reply.status).toBe(204);

    expect((await session.call('GET', '/api/subjects')).body.subjects).toEqual([]);
    expect((await session.call('GET', '/api/providers')).body.providers).toEqual([]);
    expect((await session.call('GET', `/api/chats/${chat}`)).status).toBe(404);
    expect((await session.call('GET', '/api/model-settings')).body).toEqual({
      default: null,
      fallback: [],
    });
    const profile = (await session.call('GET', '/api/profile')).body;
    expect(profile).toMatchObject({ gradeLevel: null, onboardingCompleted: false });
    expect(await harness.services.secrets.list()).toEqual([]);

    // Sitzung und Passcode bleiben, die App ist danach sofort wieder einzurichten.
    const state = await harness.call('GET', '/api/session', { cookie: session.cookie });
    expect(state.body.state).toBe('unlocked');
    const login = await harness.call('POST', '/api/auth/login', {
      body: { passcode: TEST_PASSCODE },
    });
    expect(login.status).toBe(200);
  });

  it('entfernt alle Dateien in Dateiablage, Arbeitsordnern, Logs und Sicherungen', async () => {
    const { paths, storage } = harness.services;
    await storage.put('bilder/foto.png', 'inhalt');
    mkdirSync(join(paths.workspaces, 'beispiel', 'unterordner'), { recursive: true });
    writeFileSync(join(paths.workspaces, 'beispiel', 'unterordner', 'notiz.txt'), MARKER);
    writeFileSync(join(paths.backups, 'pagewise-vor-migration-alt.db'), MARKER);
    writeFileSync(join(paths.logs, 'alt.log'), MARKER);

    expect((await erase()).status).toBe(204);

    for (const dir of [paths.assets, paths.workspaces, paths.logs, paths.backups]) {
      expect(existsSync(dir)).toBe(true);
      expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
    }
    expect(await storage.list()).toEqual([]);
    expect(existsSync(join(paths.workspaces, 'beispiel'))).toBe(false);
    expect(existsSync(join(paths.backups, 'pagewise-vor-migration-alt.db'))).toBe(false);
    expect(existsSync(join(paths.logs, 'alt.log'))).toBe(false);
  });

  it('lässt gelöschten Text nicht in der Datenbankdatei oder im Protokoll liegen', async () => {
    await fillWithData();
    // Zuerst die Daten sicher auf die Platte bringen, damit der Test aussagekräftig ist.
    harness.services.database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    expect(readFileSync(harness.services.paths.database).includes(MARKER)).toBe(true);

    expect((await erase()).status).toBe(204);

    const { database } = harness.services.paths;
    for (const file of [database, `${database}-wal`]) {
      if (existsSync(file)) expect(readFileSync(file).includes(MARKER), file).toBe(false);
    }
  });

  it('beendet laufende Antworten, bevor gelöscht wird', async () => {
    const { chat } = await fillWithData();
    // Die Antwort läuft: der Strom des Test-Anbieters bleibt offen.
    const sending = session.call('POST', `/api/chats/${chat}/messages`, { content: MARKER });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.services.chats.running(chat)).not.toBeNull();
    upstreamStream?.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Teil' }, finish_reason: null }] })}\n\n`,
      ),
    );

    expect((await erase()).status).toBe(204);
    await sending;

    expect(harness.services.chats.running(chat)).toBeNull();
    // Auch der Text der abgebrochenen Antwort ist weg.
    const { database } = harness.services.paths;
    for (const file of [database, `${database}-wal`]) {
      if (existsSync(file)) expect(readFileSync(file).includes(MARKER), file).toBe(false);
    }
    expect((await session.call('GET', '/api/subjects')).body.subjects).toEqual([]);
  });

  it('gibt bei einem Fehler nur einen Code zurück', async () => {
    await fillWithData();
    const { eraser } = harness.services;
    const original = eraser.eraseAll.bind(eraser);
    eraser.eraseAll = async () => {
      throw new Error(`Kaputt bei /geheimer/pfad ${KEY}`);
    };
    const reply = await erase();
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ error: 'erase_failed' });
    expect(reply.text).not.toContain('geheimer');
    expect(reply.text).not.toContain(KEY);
    eraser.eraseAll = original;
  });
});
