import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AgentRun, buildCodexEnv, CodexEngine, CodexStreamParser } from './codex';
import { type AgentFinish, type AgentStartInput, MAX_LINE_BYTES, MAX_OUTPUT_BYTES } from './engine';
import type { AgentEvent } from './stream';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const OTHER = ['anderer', 'schluessel', 'qrstuvwxyz'].join('-');
const FAKE = fileURLToPath(new URL('./testing/fake-codex.mjs', import.meta.url));

interface Logged {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  prompt: string;
  config: string | null;
}

let base: string;
let dataRoot: string;
let workspace: string;
let logFile: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  dataRoot = join(base, 'daten');
  workspace = join(dataRoot, 'workspaces', 'fach', 'main');
  mkdirSync(workspace, { recursive: true });
  logFile = join(base, 'aufruf.log');
  chmodSync(FAKE, 0o755);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function engine(env: NodeJS.ProcessEnv = {}) {
  return new CodexEngine({
    dataRoot,
    env: {
      PATH: process.env.PATH,
      HOME: join(base, 'echtes-home'),
      LANG: 'de_DE.UTF-8',
      // Alles Folgende darf nie im Prozess ankommen:
      OPENAI_API_KEY: OTHER,
      CODEX_API_KEY: OTHER,
      PAGEWISE_DATA_DIR: '/geheim',
      ...env,
    },
    realHome: join(base, 'echtes-home'),
    extraEnv: { FAKE_CODEX_LOG: logFile },
  });
}

function input(extra: Partial<AgentStartInput> = {}): AgentStartInput {
  return {
    cliPath: FAKE,
    profileId: '44444444-4444-4444-8444-444444444444',
    kind: 'codex',
    token: null,
    model: null,
    timeoutMinutes: 1,
    workspace,
    prompt: 'Antworte kurz.',
    systemPrompt: 'Du bist ein Test.',
    sessionId: null,
    ...extra,
  };
}

async function drain(run: AgentRun): Promise<{ events: AgentEvent[]; finish: AgentFinish }> {
  const events: AgentEvent[] = [];
  for await (const event of run.events) events.push(event);
  return { events, finish: await run.finished };
}

const result = (events: AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: 'result' }> => e.type === 'result');
const session = (events: AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: 'session' }> => e.type === 'session');

function logs(): Logged[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Logged);
}

describe('Codex-Umgebung (Allowlist, Safe-Modus)', () => {
  it('baut die Umgebung als Allowlist mit leerem CODEX_HOME im Lauf-Ordner', () => {
    const env = buildCodexEnv({
      cliDir: join(base, 'bin'),
      source: {
        PATH: `/usr/bin:${join(base, 'werkzeuge')}`,
        HOME: join(base, 'echtes-home'),
        LANG: 'de_DE.UTF-8',
        TMPDIR: '/tmp',
        // Alles Folgende darf nie durchgereicht werden:
        OPENAI_API_KEY: OTHER,
        CODEX_API_KEY: OTHER,
        OPENAI_BASE_URL: 'https://fremd.example',
        PAGEWISE_DATA_DIR: '/geheim',
        PROXY: 'http://unbekannt',
      },
      codexHome: join(base, 'lauf', 'home'),
    });
    expect(env.PATH).toBe(`${join(base, 'bin')}:/usr/bin:${join(base, 'werkzeuge')}`);
    expect(env.HOME).toBe(join(base, 'echtes-home'));
    expect(env.LANG).toBe('de_DE.UTF-8');
    expect(env.CODEX_HOME).toBe(join(base, 'lauf', 'home'));
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.PAGEWISE_DATA_DIR).toBeUndefined();
    expect(env.PROXY).toBeUndefined();
  });
});

describe('Codex-Strom (Normalisierung auf AgentEvent)', () => {
  it('macht aus thread.started, item.completed und turn.completed eigene Ereignisse', () => {
    const parser = new CodexStreamParser(workspace);
    const events = [
      ...parser.parse('{"type":"thread.started","thread_id":"thr_1"}'),
      ...parser.parse('{"type":"turn.started"}'),
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hallo"}}',
      ),
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"item_2","type":"file_change","status":"completed","changes":["PREFIX/bericht.pdf"]}}',
      ),
      ...parser.parse('{"type":"turn.completed","usage":{"input_tokens":10}}'),
      ...parser.finalize({ code: 0, signal: null, reason: 'exit' }, ''),
    ];
    expect(session(events)).toMatchObject({ sessionId: 'thr_1', model: null });
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hallo' }]);
    const tool = events.find((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
    expect(tool).toMatchObject({
      id: 'item_2',
      name: 'file_change',
      target: 'PREFIX/bericht.pdf',
      file: 'bericht.pdf',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      id: 'item_2',
      error: false,
    });
    expect(result(events)).toMatchObject({ ok: true, code: null, denied: 0, turns: 1 });
  });

  it('trennt zwei Züge mit einem Absatz und liest wachsenden Text nur einmal', () => {
    const parser = new CodexStreamParser(null);
    const events = [
      ...parser.parse('{"type":"thread.started","thread_id":"thr"}'),
      ...parser.parse('{"type":"turn.started"}'),
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Eins "}}',
      ),
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Eins Zwei"}}',
      ),
      ...parser.parse('{"type":"turn.started"}'),
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Drei"}}',
      ),
    ];
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'Eins ' },
      { type: 'text', text: 'Zwei' },
      { type: 'text', text: 'Drei' },
    ]);
    expect(events.find((e) => e.type === 'break')).toBeDefined();
  });

  it('kürzt Ziel auf 120 und Dateinamen auf 80 Zeichen und gibt nie Werkzeug-Eingaben weiter', () => {
    const parser = new CodexStreamParser(null);
    const longPath = `${'x'.repeat(200)}.pdf`;
    const events = parser.parse(
      `{"type":"item.completed","item":{"id":"c1","type":"file_change","status":"in_progress","changes":["${longPath}"],"command":"NIE-WEITERGEBEN"}}`,
    );
    const tool = events.find((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
    expect(tool?.target?.length).toBeLessThanOrEqual(120);
    expect(tool?.file?.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(events)).not.toContain('NIE-WEITERGEBEN');
    expect(JSON.stringify(events)).not.toContain(`${'x'.repeat(200)}.pdf`);
  });

  it('zählt verweigerte Änderungen, ohne den Text weiterzugeben, und lässt den Lauf scheitern', () => {
    const parser = new CodexStreamParser(null);
    const events = [
      ...parser.parse(
        '{"type":"item.completed","item":{"id":"c1","type":"file_change","status":"failed","changes":["ergebnis.txt"]}}',
      ),
      ...parser.parse(
        '{"type":"turn.failed","error":{"message":"Geschriebenes wurde verweigert: GEHEIM"}}',
      ),
      ...parser.finalize({ code: 0, signal: null, reason: 'exit' }, ''),
    ];
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ id: 'c1', error: true });
    expect(result(events)).toMatchObject({ ok: false, denied: 1, code: 'agent_failed', text: '' });
    expect(JSON.stringify(events)).not.toContain('GEHEIM');
  });

  it('ordnet Fehlerströme Codes zu (Anmeldung, 429, Server) und macht den Lauf zum Fehlschlag', () => {
    const auth = new CodexStreamParser(null);
    auth.parse('{"type":"thread.started","thread_id":"t"}');
    auth.parse('{"type":"turn.started"}');
    auth.parse('{"type":"error","message":"unauthorized: bitte anmelden"}');
    expect(result(auth.finalize({ code: 1, signal: null, reason: 'exit' }, ''))).toMatchObject({
      ok: false,
      code: 'auth_failed',
      text: '',
    });

    const rate = new CodexStreamParser(null);
    rate.parse('{"type":"thread.started","thread_id":"t"}');
    rate.parse('{"type":"turn.started"}');
    rate.parse('{"type":"turn.failed","error":{"message":"rate limit reached"}}');
    expect(result(rate.finalize({ code: 1, signal: null, reason: 'exit' }, ''))).toMatchObject({
      ok: false,
      code: 'rate_limited',
    });

    const server = new CodexStreamParser(null);
    server.parse('{"type":"thread.started","thread_id":"t"}');
    server.parse('{"type":"turn.started"}');
    server.parse('{"type":"turn.failed","error":{"message":"server error","status":503}}');
    expect(result(server.finalize({ code: 1, signal: null, reason: 'exit' }, ''))).toMatchObject({
      ok: false,
      code: 'upstream_error',
    });
  });

  it('liest die letzte Nachricht aus der Datei, wenn der Strom keinen Text brachte', () => {
    const parser = new CodexStreamParser(null);
    parser.parse('{"type":"thread.started","thread_id":"t"}');
    parser.parse('{"type":"turn.started"}');
    const events = parser.finalize({ code: 0, signal: null, reason: 'exit' }, 'Nur im Ergebnis.');
    expect(result(events)).toMatchObject({ ok: true, text: 'Nur im Ergebnis.' });
  });

  it('scheidet einen Lauf ohne Ereignisse als Fehlschlag aus (auch bei Exit 0)', () => {
    const parser = new CodexStreamParser(null);
    expect(result(parser.finalize({ code: 0, signal: null, reason: 'exit' }, ''))).toMatchObject({
      ok: false,
      code: 'agent_failed',
    });
  });

  it('überspringt Zeilen ohne JSON und unbekannte Typen still', () => {
    const parser = new CodexStreamParser(null);
    expect(parser.parse('kein json')).toEqual([]);
    expect(parser.parse('[]')).toEqual([]);
    expect(parser.parse('{"type":"thread.closed"}')).toEqual([]);
    expect(
      parser.parse('{"type":"item.completed","item":{"id":"x","type":"plan_update"}}'),
    ).toEqual([]);
  });
});

describe('Codex-Adapter (Prozessstart wie engine.ts und opencode.ts)', () => {
  it('startet `exec` mit den Pflicht-Flags, Auftrag über stdin, ohne Schlüssel in Argumenten', async () => {
    const run = await drain(engine().start(input({ prompt: 'Auftrag über stdin [[write]]' })));
    expect(result(run.events)?.ok).toBe(true);
    const log = logs()[0];
    expect(log).toBeDefined();
    if (!log) return;
    for (const flag of ['exec', '--json', '--sandbox']) {
      expect(log.argv).toContain(flag);
    }
    expect(log.argv[log.argv.indexOf('--sandbox') + 1]).toBe('workspace-write');
    for (const flag of ['--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']) {
      expect(log.argv).toContain(flag);
    }
    // Der Auftrag gehört auf stdin (`-`), nie als Argument.
    expect(log.argv[log.argv.indexOf('--output-last-message') + 1]).toMatch(
      /letzte-nachricht\.txt$/,
    );
    expect(log.argv.at(-1)).toBe('-');
    expect(log.argv).not.toContain('Auftrag');
    expect(log.argv.join(' ')).not.toMatch(/dangerously|yolo|full-auto|bypass/i);
    // Umgebung: Allowlist, echtes HOME, leeres CODEX_HOME, keine Server-Schlüssel.
    expect(log.env.CODEX_HOME).toContain(join('engine', 'runs'));
    expect(log.env.HOME).toBe(join(base, 'echtes-home'));
    expect(log.env.OPENAI_API_KEY).toBeUndefined();
    expect(log.env.CODEX_API_KEY).toBeUndefined();
    expect(log.env.PAGEWISE_DATA_DIR).toBeUndefined();
    // Der Adapter startet im aufgelösten Pfad (auf macOS ist /var ein Verweis auf /private/var) —
    // dieselbe Regel wie in engine.ts und opencode.ts.
    expect(log.cwd).toBe(realpathSync(workspace));
    // Der Lauf-Ordner selbst ist weg, der übergeordnete Ordner bleibt (wie bei engine.ts).
    const runDir = join(dataRoot, 'engine', 'runs');
    expect(readdirSync(runDir)).toEqual([]);
  });

  it('meldet Sitzung, Text in Stücken, Werkzeug mit Dateiname und Ergebnis', async () => {
    const run = await drain(engine().start(input({ prompt: 'Lege an. [[write]]' })));
    expect(session(run.events)?.sessionId).toMatch(/^0199/);
    expect(
      run.events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toContain('Fertig.');
    const tool = run.events.find(
      (e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool',
    );
    expect(tool).toMatchObject({ name: 'file_change', file: 'ergebnis.txt' });
    expect(tool?.target?.length ?? 0).toBeLessThanOrEqual(120);
    expect(run.events.find((e) => e.type === 'tool_result')).toMatchObject({ error: false });
    expect(result(run.events)).toMatchObject({ ok: true, code: null, denied: 0 });
    expect(run.finish.sawResult).toBe(true);
    expect(run.finish.end.reason).toBe('exit');
  });

  it('gibt Fehler des Programms als Code weiter, nie als Text', async () => {
    const auth = await drain(engine().start(input({ prompt: '[[fail]]' })));
    expect(result(auth.events)).toMatchObject({ ok: false, code: 'auth_failed', text: '' });
    expect(JSON.stringify(auth.events)).not.toContain('Fehler des Programms');
    const rate = await drain(engine().start(input({ prompt: '[[fail429]]' })));
    expect(result(rate.events)).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(auth.finish.end.code).toBe(1);
  });

  it('meldet eine durch den Safe-Modus verweigerte Änderung als Fehlschlag mit Anzahl', async () => {
    const denied = await drain(engine().start(input({ prompt: '[[toolfail]]' })));
    expect(result(denied.events)).toMatchObject({ ok: false, denied: 1 });
    expect(JSON.stringify(denied.events)).not.toContain('verweigert');
  });

  it('bricht einen hängenden Lauf ab: gestuft SIGINT, dann SIGTERM, dann SIGKILL', async () => {
    const started = engine();
    const run = started.start(input({ prompt: 'Langsam. [[slow]]' }));
    const iterator = run.events[Symbol.asyncIterator]();
    for (;;) {
      const next = await iterator.next();
      if (next.done || next.value.type === 'text') break;
    }
    run.cancel();
    for (;;) if ((await iterator.next()).done) break;
    const finish = await run.finished;
    expect(finish.end.reason).toBe('cancelled');
    expect(finish.end.signal).not.toBeNull();
  }, 30_000);

  it('liest riesige Zeilen bis zur Grenze und bricht dann ab', async () => {
    const run = await drain(engine().start(input({ prompt: '[[huge]]', timeoutMinutes: 1 })));
    expect(run.finish.end.reason).toBe('output_limit');
    expect(result(run.events)?.ok).toBe(false);
  }, 30_000);

  it('scheitert sauber, wenn die Binary nicht startet (spawn_failed)', async () => {
    const run = await drain(engine().start(input({ cliPath: join(base, 'fehlt') })));
    expect(run.finish.end.reason).toBe('spawn_failed');
    expect(run.finish.sawResult).toBe(false);
  });

  it('räumt den Lauf-Ordner im Datenverzeichnis auf', async () => {
    await drain(engine().start(input({ prompt: '[[silent]]' })));
    const runs = join(dataRoot, 'engine', 'runs');
    expect(readdirSync(runs)).toEqual([]);
  });

  it('setzt die Grenzen wie engine.ts (64 MiB Ausgabe, 8 MiB je Zeile)', () => {
    expect(MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('Echtes codex (nur mit installierter CLI, kein Netz-Pfad)', () => {
  // Nur Start und Beendigung gegen eine Adresse, die es auf diesem Rechner nicht gibt: kein Netz,
  // keine Anmeldung, keine echten Schlüssel. Sonst übersprungen (CI). Auf dieser Maschine ist codex
  // nicht installiert: der Test läuft leer (describe.skipIf).
  const CLI = '/Users/kaygewinner/.codex/bin/codex';
  describe.skipIf(!existsSync(CLI))('Start und Beendigung ohne Netz', () => {
    it('startet mit Safe-Modus-Flags und endet mit einem Fehler-Ereignis', async () => {
      const run = await drain(
        engine({
          PATH: `${join(CLI, '..')}:${process.env.PATH ?? ''}`,
        }).start(
          input({
            cliPath: CLI,
            timeoutMinutes: 1,
            prompt: 'Antworte kurz.',
          }),
        ),
      );
      // Ohne Netz oder Anmeldung endet der Lauf mit einem Fehler-Ereignis (kein Hängen, keine Prompt-Warteschleife).
      expect(run.finish.end.reason).toBe('exit');
      expect(result(run.events)?.ok).toBe(false);
    }, 90_000);
  });
});
