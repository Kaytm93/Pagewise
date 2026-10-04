import { type ChildProcess, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AgentFinish, type AgentStartInput, ClaudeCodeEngine } from './engine';
import type { AgentEvent } from './stream';

/**
 * Ende-zu-Ende-Test mit dem ECHTEN Programm „claude“ gegen einen Ersatz für die Anthropic-API
 * (`testing/fake-anthropic.mjs`): kein Netz, keine Konten, keine echten Schlüssel. Er prüft, was die Ersatz-CLI
 * nicht prüfen kann: dass die gemessene Aufrufform, die Rechte und die Sandbox mit der echten Anwendung
 * funktionieren (Dateien im Arbeitsordner entstehen, außerhalb nicht; Sitzung wird fortgesetzt; Fehlernummern
 * landen als Codes an).
 *
 * Läuft nur mit gesetztem `PAGEWISE_E2E_CLAUDE=<Pfad zu claude>` (Version 2.1.x, gemessen mit 2.1.220), weil
 * er ein installiertes Programm braucht und länger dauert. In der CI läuft er nicht.
 */
const CLAUDE = process.env.PAGEWISE_E2E_CLAUDE;
const FAKE_API = fileURLToPath(new URL('./testing/fake-anthropic.mjs', import.meta.url));
// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'nicht', 'echt'].join('-');

describe.skipIf(!CLAUDE)('Agent-CLI Ende-zu-Ende mit dem echten claude', () => {
  let base: string;
  let dataRoot: string;
  let workspace: string;
  let api: ChildProcess;
  let port: number;
  let engine: ClaudeCodeEngine;

  beforeAll(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pw-e2e-')));
    dataRoot = join(base, 'd');
    workspace = join(dataRoot, 'w');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(base, 'home'), { recursive: true });
    api = spawn(process.execPath, [FAKE_API, '0'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      // Wohin das Szenario „write“ schreibt, wenn es keinen Pfad bekommt.
      env: { ...process.env, FAKE_WS: workspace },
    });
    port = await new Promise<number>((resolve, reject) => {
      api.once('error', reject);
      api.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
    });
    engine = new ClaudeCodeEngine({
      dataRoot,
      env: { PATH: process.env.PATH, LANG: 'de_DE.UTF-8' },
      realHome: join(base, 'home'),
      // Statt api.z.ai spricht das Programm mit dem Ersatz auf diesem Rechner.
      extraEnv: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        NO_PROXY: '127.0.0.1,localhost',
      },
    });
  }, 30_000);

  afterAll(() => {
    api?.kill();
    if (base) rmSync(base, { recursive: true, force: true });
  });

  const input = (prompt: string, extra: Partial<AgentStartInput> = {}): AgentStartInput => ({
    cliPath: CLAUDE ?? '',
    profileId: '33333333-3333-4333-8333-333333333333',
    kind: 'glm-coding-plan',
    token: TOKEN,
    model: null,
    timeoutMinutes: 2,
    workspace,
    prompt,
    systemPrompt: 'Du bist ein Test.',
    sessionId: null,
    ...extra,
  });

  async function drain(
    run: ReturnType<ClaudeCodeEngine['start']>,
  ): Promise<{ events: AgentEvent[]; finish: AgentFinish }> {
    const events: AgentEvent[] = [];
    for await (const event of run.events) events.push(event);
    return { events, finish: await run.finished };
  }
  const result = (events: AgentEvent[]) =>
    events.find((e): e is Extract<AgentEvent, { type: 'result' }> => e.type === 'result');
  const session = (events: AgentEvent[]) =>
    events.find((e): e is Extract<AgentEvent, { type: 'session' }> => e.type === 'session');

  it('antwortet mit Text in Stücken und meldet ein erfolgreiches Ergebnis', async () => {
    const { events, finish } = await drain(engine.start(input('Antworte. [[szenario:text]]')));
    expect(finish.sawResult).toBe(true);
    expect(result(events)).toMatchObject({ ok: true, code: null });
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1);
    expect(session(events)?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);

  it('legt eine Datei im Arbeitsordner an und meldet das Werkzeug mit relativem Ziel', async () => {
    const { events } = await drain(engine.start(input('Lege an. [[szenario:write]]')));
    expect(result(events)).toMatchObject({ ok: true, denied: 0 });
    expect(readFileSync(join(workspace, 'ergebnis.txt'), 'utf8')).toContain('Fake-Szenario');
    expect(events.find((e) => e.type === 'tool')).toMatchObject({
      name: 'Write',
      target: 'ergebnis.txt',
    });
  }, 60_000);

  it('verweigert das Schreiben außerhalb des Arbeitsordners', async () => {
    const outside = join(base, 'ausserhalb.txt');
    const { events } = await drain(engine.start(input(`Schreibe. [[szenario:write:${outside}]]`)));
    expect(existsSync(outside)).toBe(false);
    expect(result(events)?.denied).toBeGreaterThan(0);
  }, 60_000);

  it('verweigert das Lesen im echten Benutzerverzeichnis', async () => {
    const secret = join(base, 'home', 'geheim.txt');
    writeFileSync(secret, 'GEHEIMER-INHALT-NUR-FUER-TESTS');
    const { events } = await drain(engine.start(input(`Lies. [[szenario:read:${secret}]]`)));
    expect(JSON.stringify(events)).not.toContain('GEHEIMER-INHALT');
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ error: true });
  }, 60_000);

  it('führt Befehle in der Sandbox aus, die nicht aus dem Arbeitsordner herauskommen', async () => {
    const outside = join(base, 'durch-bash.txt');
    await drain(engine.start(input(`Befehl. [[szenario:bash:echo x > ${outside}]]`)));
    expect(existsSync(outside)).toBe(false);
    await drain(engine.start(input('Befehl. [[szenario:bash:echo ok > bash.txt]]')));
    expect(readFileSync(join(workspace, 'bash.txt'), 'utf8').trim()).toBe('ok');
  }, 90_000);

  it('setzt eine Sitzung fort und sieht den bisherigen Verlauf', async () => {
    const first = await drain(engine.start(input('Erste Frage ohne Marker [[szenario:text]]')));
    const id = session(first.events)?.sessionId ?? null;
    expect(id).not.toBeNull();
    const second = await drain(
      engine.start(input('Zweite Frage [[szenario:echo]]', { sessionId: id })),
    );
    const text = result(second.events)?.text ?? '';
    // Der Ersatz sieht beide Nachrichten und das System-Prompt aus der Datei.
    expect(text).toMatch(/messages=3/);
    expect(text).toContain('Erste Frage ohne Marker');
    expect(result(second.events)?.resumeFailed).toBe(false);
  }, 90_000);

  it('meldet eine unbekannte Sitzung als resumeFailed', async () => {
    const { events } = await drain(
      engine.start(
        input('Hallo [[szenario:text]]', { sessionId: '00000000-0000-4000-8000-000000000000' }),
      ),
    );
    expect(result(events)).toMatchObject({ ok: false, resumeFailed: true });
  }, 60_000);

  it('wandelt Fehler der API in Codes um', async () => {
    // Das Programm gibt vom Fehlerrumpf nur die Nachricht weiter: ohne Nummer darin bleibt es bei „zu viele Anfragen“.
    const limited = await drain(engine.start(input('Hallo [[szenario:error429]]')));
    expect(result(limited.events)).toMatchObject({ ok: false, code: 'rate_limited', text: '' });
    // Steht die Fehlernummer von Z.ai in der Nachricht, wird sie erkannt.
    const quota = await drain(engine.start(input('Hallo [[szenario:error1113]]')));
    expect(result(quota.events)).toMatchObject({ ok: false, code: 'no_package', text: '' });
    const auth = await drain(engine.start(input('Hallo [[szenario:error401]]')));
    expect(result(auth.events)).toMatchObject({ ok: false, code: 'auth_failed' });
  }, 180_000);

  it('bricht eine langsame Antwort ab und beendet den Prozess', async () => {
    const run = engine.start(input('Langsam. [[szenario:slow]]'));
    const iterator = run.events[Symbol.asyncIterator]();
    for (;;) {
      const next = await iterator.next();
      if (next.done || next.value.type === 'text') break;
    }
    run.cancel();
    for (;;) if ((await iterator.next()).done) break;
    const finish = await run.finished;
    expect(finish.end.reason).toBe('cancelled');
  }, 60_000);
});
