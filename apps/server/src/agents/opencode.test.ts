import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AgentFinish, type AgentStartInput, MAX_LINE_BYTES, MAX_OUTPUT_BYTES } from './engine';
import {
  AGENT_NAME,
  type AgentRun,
  buildOpenCodeConfig,
  buildOpenCodeEnv,
  OpenCodeEngine,
  OpenCodeStreamParser,
} from './opencode';
import type { AgentEvent } from './stream';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const OTHER = ['anderer', 'schluessel', 'qrstuvwxyz'].join('-');
const FAKE = fileURLToPath(new URL('./testing/fake-opencode.mjs', import.meta.url));

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
  return new OpenCodeEngine({
    dataRoot,
    env: {
      PATH: process.env.PATH,
      HOME: join(base, 'echtes-home'),
      LANG: 'de_DE.UTF-8',
      // Alles Folgende darf nie im Prozess ankommen:
      ANTHROPIC_API_KEY: OTHER,
      OPENROUTER_API_KEY: OTHER,
      PAGEWISE_DATA_DIR: '/geheim',
      ...env,
    },
    realHome: join(base, 'echtes-home'),
    extraEnv: { FAKE_OPENCODE_LOG: logFile },
  });
}

function input(extra: Partial<AgentStartInput> = {}): AgentStartInput {
  return {
    cliPath: FAKE,
    profileId: '44444444-4444-4444-8444-444444444444',
    kind: 'opencode',
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
const tools = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');

function logs(): Logged[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Logged);
}

describe('OpenCode-Konfiguration (Safe-Modus)', () => {
  it('verweigert zuerst alles und erlaubt nur Lesen und Schreiben im Arbeitsordner', () => {
    const config = buildOpenCodeConfig({ systemPrompt: 'System' });
    const denyAll = config.permissions.find((rule) => rule.action === '*');
    expect(denyAll).toEqual({ action: '*', resource: '*', effect: 'deny' });
    const allows = config.permissions.filter((rule) => rule.effect === 'allow');
    for (const rule of allows) {
      expect(['read', 'edit']).toContain(rule.action);
      expect(rule.resource).toContain('*');
    }
    // Keine „ask“-Wirkung im nicht-interaktiven Lauf: Das Programm wartet sonst auf niemanden.
    for (const rule of config.permissions) expect(rule.effect).not.toBe('ask');
  });

  it('härtet über Policies ab: Shell, Netz, MCP, Skills, Plugins', () => {
    const config = buildOpenCodeConfig({ systemPrompt: 'System' });
    const hardened = Object.fromEntries(
      config.policies.map((rule) => [rule.resource, rule.effect]),
    );
    expect(hardened['shell:*']).toBe('deny');
    expect(hardened['webfetch:*']).toBe('deny');
    expect(hardened['websearch:*']).toBe('deny');
    expect(hardened['mcp:*']).toBe('deny');
    expect(hardened['skill:*']).toBe('deny');
    expect(hardened['plugin:*']).toBe('deny');
    // Kein Update, kein Teilen, keine Momentaufnahmen.
    expect(config.update).toBe('disable');
    expect(config.share).toBe('disabled');
    expect(config.snapshots).toBe(false);
  });

  it('trägt das System-Prompt im Agenten der Konfiguration ein, nie als Argument', () => {
    const config = buildOpenCodeConfig({ systemPrompt: 'GEHEIMES-SYSTEM' });
    expect(JSON.stringify(config)).toContain('GEHEIMES-SYSTEM');
    expect(config.agent?.[AGENT_NAME]?.system).toBe('GEHEIMES-SYSTEM');
    expect(config.default_agent).toBe(AGENT_NAME);
  });

  it('baut die Umgebung als Allowlist und setzt nur den Pfad der Konfiguration', () => {
    const env = buildOpenCodeEnv({
      cliDir: join(base, 'bin'),
      source: {
        PATH: `/usr/bin:${join(base, 'werkzeuge')}`,
        HOME: join(base, 'echtes-home'),
        LANG: 'de_DE.UTF-8',
        TMPDIR: '/tmp',
        // Alles Folgende darf nie durchgereicht werden:
        ANTHROPIC_API_KEY: OTHER,
        OPENCODE_CONFIG: '/fremd.json',
        PAGEWISE_DATA_DIR: '/geheim',
        PROXY: 'http://unbekannt',
      },
      configFile: join(base, 'lauf', 'opencode.json'),
    });
    expect(env.PATH).toBe(`${join(base, 'bin')}:/usr/bin:${join(base, 'werkzeuge')}`);
    expect(env.HOME).toBe(join(base, 'echtes-home'));
    expect(env.LANG).toBe('de_DE.UTF-8');
    expect(env.OPENCODE_CONFIG).toBe(join(base, 'lauf', 'opencode.json'));
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PAGEWISE_DATA_DIR).toBeUndefined();
    expect(env.PROXY).toBeUndefined();
  });
});

describe('OpenCode-Strom (Normalisierung auf AgentEvent)', () => {
  it('macht aus text, step_start und tool_use eigene Ereignisse', () => {
    const parser = new OpenCodeStreamParser(workspace);
    const events = [
      ...parser.parse('{"type":"step_start","sessionID":"ses_1","timestamp":1000}'),
      ...parser.parse(
        '{"type":"text","sessionID":"ses_1","timestamp":1001,"part":{"id":"p1","type":"text","text":"Hallo"}}',
      ),
      ...parser.parse(
        '{"type":"tool_use","sessionID":"ses_1","timestamp":1002,"part":{"callID":"c1","type":"tool","tool":"write","state":{"status":"running","input":{"file_path":"PREFIX/bericht.pdf"},"title":"bericht.pdf"}}}',
      ),
      ...parser.parse(
        '{"type":"tool_use","sessionID":"ses_1","timestamp":1003,"part":{"callID":"c1","type":"tool","tool":"write","state":{"status":"completed","input":{},"title":"bericht.pdf"}}}',
      ),
      ...parser.finalize({ code: 0, signal: null, reason: 'exit' }),
    ];
    expect(session(events)).toMatchObject({ sessionId: 'ses_1', model: null });
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hallo' }]);
    const tool = events.find((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
    expect(tool).toMatchObject({
      id: 'c1',
      name: 'write',
      target: 'PREFIX/bericht.pdf',
      file: 'bericht.pdf',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ id: 'c1', error: false });
    expect(result(events)).toMatchObject({ ok: true, code: null, denied: 0 });
  });

  it('kürzt Ziel auf 120 und Dateinamen auf 80 Zeichen und gibt nie Werkzeug-Eingaben weiter', () => {
    const parser = new OpenCodeStreamParser(null);
    const longPath = `${'x'.repeat(200)}.pdf`;
    const events = parser.parse(
      `{"type":"tool_use","sessionID":"s","timestamp":1,"part":{"callID":"c1","type":"tool","tool":"write","state":{"status":"running","input":{"file_path":"${longPath}","content":"NIE-WEITERGEBEN"}}}}`,
    );
    const tool = events.find((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
    expect(tool?.target?.length).toBeLessThanOrEqual(120);
    expect(tool?.file?.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(events)).not.toContain('NIE-WEITERGEBEN');
    expect(JSON.stringify(events)).not.toContain(`${'x'.repeat(200)}.pdf`);
  });

  it('liest wachsenden Text nur einmal weiter und trennt Nachrichten mit einem Absatz', () => {
    const parser = new OpenCodeStreamParser(null);
    const events = [
      ...parser.parse(
        '{"type":"text","sessionID":"s","timestamp":1,"part":{"id":"p1","type":"text","text":"Eins "}}',
      ),
      ...parser.parse(
        '{"type":"text","sessionID":"s","timestamp":2,"part":{"id":"p1","type":"text","text":"Eins Zwei"}}',
      ),
      ...parser.parse('{"type":"step_start","sessionID":"s","timestamp":3}'),
      ...parser.parse(
        '{"type":"text","sessionID":"s","timestamp":4,"part":{"id":"p2","type":"text","text":"Drei"}}',
      ),
    ];
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'Eins ' },
      { type: 'text', text: 'Zwei' },
      { type: 'text', text: 'Drei' },
    ]);
    expect(events.find((e) => e.type === 'break')).toBeDefined();
  });

  it('zählt verweigerte Berechtigungen, ohne den Text weiterzugeben', () => {
    const parser = new OpenCodeStreamParser(null);
    const events = [
      ...parser.parse(
        '{"type":"tool_use","sessionID":"s","timestamp":1,"part":{"callID":"c1","type":"tool","tool":"write","state":{"status":"error","input":{},"error":"permission requested: write; auto-rejecting GEHEIM"}}}',
      ),
      ...parser.finalize({ code: 0, signal: null, reason: 'exit' }),
    ];
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ id: 'c1', error: true });
    expect(result(events)).toMatchObject({ ok: false, denied: 1, code: 'agent_failed' });
    expect(JSON.stringify(events)).not.toContain('GEHEIM');
  });

  it('ordnet Fehlerströme Codes zu und macht den Lauf zum Fehlschlag', () => {
    const auth = new OpenCodeStreamParser(null);
    auth.parse('{"type":"step_start","sessionID":"s","timestamp":1}');
    auth.parse('{"type":"error","sessionID":"s","timestamp":2,"error":{"type":"provider.auth"}}');
    expect(result(auth.finalize({ code: 1, signal: null, reason: 'exit' }))).toMatchObject({
      ok: false,
      code: 'auth_failed',
      text: '',
    });

    const rate = new OpenCodeStreamParser(null);
    rate.parse('{"type":"step_start","sessionID":"s","timestamp":1}');
    rate.parse(
      '{"type":"error","sessionID":"s","timestamp":2,"error":{"type":"provider.x","status":429}}',
    );
    expect(result(rate.finalize({ code: 1, signal: null, reason: 'exit' }))).toMatchObject({
      ok: false,
      code: 'rate_limited',
    });

    const transport = new OpenCodeStreamParser(null);
    transport.parse('{"type":"step_start","sessionID":"s","timestamp":1}');
    transport.parse(
      '{"type":"error","sessionID":"s","timestamp":2,"error":{"type":"provider.transport"}}',
    );
    expect(result(transport.finalize({ code: 1, signal: null, reason: 'exit' }))).toMatchObject({
      ok: false,
      code: 'upstream_error',
    });
  });

  it('scheidet einen Lauf ohne Ereignisse als Fehlschlag aus (auch bei Exit 0)', () => {
    const parser = new OpenCodeStreamParser(null);
    expect(result(parser.finalize({ code: 0, signal: null, reason: 'exit' }))).toMatchObject({
      ok: false,
      code: 'agent_failed',
    });
  });

  it('überspringt Zeilen ohne JSON und unbekannte Typen still', () => {
    const parser = new OpenCodeStreamParser(null);
    expect(parser.parse('kein json')).toEqual([]);
    expect(parser.parse('[]')).toEqual([]);
    expect(parser.parse('{"type":"file.watcher.updated","properties":{}}')).toEqual([]);
  });
});

describe('OpenCode-Adapter (Prozessstart wie engine.ts)', () => {
  it('startet mit den Pflicht-Flags, Auftrag über stdin, Konfiguration als Datei', async () => {
    const run = await drain(engine().start(input({ prompt: 'Auftrag über stdin [[write]]' })));
    expect(result(run.events)?.ok).toBe(true);
    const log = logs()[0];
    expect(log).toBeDefined();
    if (!log) return;
    for (const flag of ['--standalone', '--format', 'json', '--agent']) {
      expect(log.argv).toContain(flag);
    }
    expect(log.argv).not.toContain('--auto');
    expect(log.argv).not.toContain('Auftrag');
    expect(log.prompt).toContain('Auftrag über stdin');
    // Umgebung: Allowlist, echtes HOME, Pfad der Konfiguration.
    expect(log.env.OPENCODE_CONFIG).toBeDefined();
    expect(log.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(log.env.PAGEWISE_DATA_DIR).toBeUndefined();
    // Konfiguration im Lauf-Ordner, danach aufgeräumt.
    expect(log.config).toContain('"effect": "deny"');
    expect(log.config).toContain('"system": "Du bist ein Test."');
    // Der Lauf-Ordner selbst ist weg, der übergeordnete Ordner bleibt (wie bei engine.ts).
    const runDir = join(dataRoot, 'engine', 'runs');
    expect(readdirSync(runDir)).toEqual([]);
  });

  it('meldet Sitzung, Text in Stücken, Werkzeug mit Dateiname und Ergebnis', async () => {
    const run = await drain(engine().start(input({ prompt: 'Lege an. [[write]]' })));
    expect(session(run.events)?.sessionId).toMatch(/^ses_/);
    expect(
      run.events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toContain('Fertig.');
    const tool = tools(run.events)[0];
    expect(tool).toMatchObject({ name: 'write', file: 'ergebnis.txt' });
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

describe('Echtes opencode (nur mit installierter CLI, kein Netz-Pfad)', () => {
  // Nur Start und Beendigung gegen eine Adresse, die es auf diesem Rechner nicht gibt: kein Netz,
  // keine Anmeldung, keine echten Schlüssel. Sonst übersprungen (CI).
  const CLI = '/Users/kaygewinner/.opencode/bin/opencode';
  describe.skipIf(!existsSync(CLI))('Start und Beendigung ohne Netz', () => {
    it('startet mit eigener Konfiguration und endet mit einem Fehler-Ereignis', async () => {
      const config = buildOpenCodeConfig({ systemPrompt: 'Nur ein Test.' });
      expect(config.permissions.some((rule) => rule.effect === 'deny')).toBe(true);
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
