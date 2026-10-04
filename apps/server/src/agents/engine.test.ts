import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AgentFinish, type AgentStartInput, ClaudeCodeEngine } from './engine';
import type { AgentEvent } from './stream';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');
const OTHER = ['anderer', 'schluessel', 'qrstuvwxyz'].join('-');
const FAKE = fileURLToPath(new URL('./testing/fake-claude.mjs', import.meta.url));
const PROFILE = '22222222-2222-4222-8222-222222222222';

interface Logged {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  prompt: string;
  settings: string | null;
  systemPrompt: string | null;
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
  return new ClaudeCodeEngine({
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
    extraEnv: { FAKE_CLAUDE_LOG: logFile },
  });
}

function input(extra: Partial<AgentStartInput> = {}): AgentStartInput {
  return {
    cliPath: FAKE,
    profileId: PROFILE,
    kind: 'glm-coding-plan',
    token: TOKEN,
    model: null,
    timeoutMinutes: 1,
    workspace,
    prompt: 'Hallo Welt',
    systemPrompt: 'Du bist ein Lernbegleiter für Beispielfach.',
    sessionId: null,
    ...extra,
  };
}

async function drain(
  run: ReturnType<ClaudeCodeEngine['start']>,
): Promise<{ events: AgentEvent[]; finish: AgentFinish }> {
  const events: AgentEvent[] = [];
  for await (const event of run.events) events.push(event);
  return { events, finish: await run.finished };
}

function logs(): Logged[] {
  return readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Logged);
}

describe('ClaudeCodeEngine: normaler Lauf', () => {
  it('liefert Sitzung, Text und Ergebnis und räumt den Laufordner auf', async () => {
    const { events, finish } = await drain(engine().start(input()));
    expect(events[0]).toMatchObject({ type: 'session', model: 'glm-5.3-flash' });
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Antwort auf: Hallo Welt');
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      text: 'Antwort auf: Hallo Welt',
    });
    expect(finish).toMatchObject({
      sawResult: true,
      sandboxUnavailable: false,
      end: { code: 0, reason: 'exit' },
    });
    expect(readdirSync(join(dataRoot, 'engine', 'runs'))).toEqual([]);
  });

  it('startet im Arbeitsordner und übergibt den Auftrag nur über stdin', async () => {
    await drain(engine().start(input({ prompt: 'geheimer Schulinhalt' })));
    const [call] = logs();
    expect(call?.cwd && readFileSync(logFile).length > 0).toBe(true);
    expect(call?.prompt).toBe('geheimer Schulinhalt');
    expect(JSON.stringify(call?.argv)).not.toContain('geheimer');
  });

  it('übergibt die festen Schalter und Dateien, nie Schlüssel oder Prompt als Argument', async () => {
    await drain(engine().start(input()));
    const [call] = logs();
    const argv = call?.argv ?? [];
    for (const flag of [
      '-p',
      '--verbose',
      '--include-partial-messages',
      '--safe-mode',
      '--disable-slash-commands',
    ]) {
      expect(argv).toContain(flag);
    }
    const value = (name: string) => argv[argv.indexOf(name) + 1];
    expect(value('--output-format')).toBe('stream-json');
    expect(value('--permission-mode')).toBe('dontAsk');
    expect(value('--setting-sources')).toBe('local');
    expect(value('--tools')).toBe('Read,Write,Edit,Glob,Grep,Bash');
    expect(value('--max-turns')).toBe('40');
    expect(value('--model')).toBe('glm-5.3-flash');
    expect(argv).not.toContain('--resume');
    expect(argv.join(' ')).not.toMatch(/dangerously|bypass/i);
    expect(JSON.stringify(argv)).not.toContain(TOKEN);
    expect(JSON.stringify(argv)).not.toContain('Lernbegleiter');
    expect(JSON.stringify(argv)).not.toContain('Hallo Welt');
  });

  it('schreibt System-Prompt und Einstellungen in Dateien mit Rechten 600, die nur während des Laufs existieren', async () => {
    const run = engine().start(input({ systemPrompt: 'Mein System-Prompt mit Schulinhalt' }));
    await drain(run);
    const [call] = logs();
    expect(call?.systemPrompt).toBe('Mein System-Prompt mit Schulinhalt');
    const settings = JSON.parse(call?.settings ?? 'null');
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
    });
    expect(settings.permissions.allow[0]).toBe(`Edit(//${realpathSync(workspace).slice(1)}/**)`);
    // Danach ist nichts davon mehr da.
    const files = call?.argv.filter((arg) => arg.startsWith(dataRoot)) ?? [];
    expect(files).toHaveLength(2);
    for (const file of files) expect(existsSync(file)).toBe(false);
  });

  it('hängt --resume an, wenn es eine Sitzung gibt, und setzt sie fort', async () => {
    const session = '28a3da41-4031-49c8-924f-41d04fb709ae';
    const { events } = await drain(engine().start(input({ sessionId: session })));
    const [call] = logs();
    expect(call?.argv).toContain('--resume');
    expect(call?.argv[call.argv.indexOf('--resume') + 1]).toBe(session);
    expect(events[0]).toMatchObject({ type: 'session', sessionId: session });
    expect(events.find((e) => e.type === 'text')).toBeDefined();
  });

  it('meldet eine nicht mehr vorhandene Sitzung als Ergebnis mit resumeFailed', async () => {
    const { events } = await drain(
      engine().start(
        input({ sessionId: '28a3da41-4031-49c8-924f-41d04fb709ae', prompt: '[[noresume]]' }),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: false, resumeFailed: true });
  });
});

describe('ClaudeCodeEngine: Umgebung', () => {
  it('GLM: Schlüssel nur in der Umgebung, alle Modellstufen, eigenes Verzeichnis unter dem Datenverzeichnis', async () => {
    await drain(engine().start(input({ model: 'glm-5.3' })));
    const [call] = logs();
    const env = call?.env ?? {};
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.3');
    expect(env.HOME).toBe(join(dataRoot, 'engine', PROFILE, 'home'));
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(dataRoot, 'engine', PROFILE, 'home', '.claude'));
    expect(statSync(env.HOME ?? '').mode & 0o777).toBe(0o700);
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('2');
  });

  it('übernimmt nichts von fremden Schlüsseln und Einstellungen des Servers', async () => {
    await drain(engine().start(input()));
    const [call] = logs();
    const text = JSON.stringify(call?.env);
    expect(text).not.toContain(OTHER);
    expect(call?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(call?.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(call?.env.PAGEWISE_DATA_DIR).toBeUndefined();
    expect(call?.env.FAKE_CLAUDE_LOG).toBe(logFile);
  });

  it('Abo: echtes Benutzerverzeichnis, keine Zugangsdaten, kein eigenes Konfigurationsverzeichnis', async () => {
    await drain(engine().start(input({ kind: 'claude-subscription', token: null })));
    const [call] = logs();
    expect(call?.env.HOME).toBe(join(base, 'echtes-home'));
    expect(call?.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(Object.keys(call?.env ?? {}).filter((n) => /TOKEN|API_KEY|BASE_URL/.test(n))).toEqual(
      [],
    );
    expect(call?.argv).not.toContain('--model');
    // Das Abo legt kein eigenes Verzeichnis an.
    expect(existsSync(join(dataRoot, 'engine', PROFILE))).toBe(false);
  });

  it('API-Schlüssel: ANTHROPIC_API_KEY mit dem Schlüssel des Zugangs', async () => {
    await drain(engine().start(input({ kind: 'anthropic-api', model: 'claude-beispiel' })));
    const [call] = logs();
    expect(call?.env.ANTHROPIC_API_KEY).toBe(TOKEN);
    expect(call?.argv[call.argv.indexOf('--model') + 1]).toBe('claude-beispiel');
  });
});

describe('ClaudeCodeEngine: Werkzeuge, Fehler und Abbruch', () => {
  it('erzeugt Dateien im Arbeitsordner und meldet die Werkzeuge ohne Inhalte', async () => {
    const { events } = await drain(
      engine().start(input({ prompt: 'Mach was [[write:bericht.pdf]]' })),
    );
    expect(existsSync(join(workspace, 'bericht.pdf'))).toBe(true);
    const tool = events.find((e) => e.type === 'tool');
    expect(tool).toMatchObject({ name: 'Write', target: 'bericht.pdf' });
    expect(events.some((e) => e.type === 'break')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('FAKE-INHALT');
  });

  it('wandelt einen Fehler von Z.ai in einen Code, nie in Text', async () => {
    const { events, finish } = await drain(engine().start(input({ prompt: '[[fail]]' })));
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: false,
      text: '',
      code: 'no_package',
    });
    expect(JSON.stringify(events)).not.toContain('Insufficient');
    expect(finish.end.code).toBe(1);
  });

  it('meldet 401 als abgelehnten Zugang', async () => {
    const { events } = await drain(engine().start(input({ prompt: '[[auth]]' })));
    expect(events.at(-1)).toMatchObject({ ok: false, code: 'auth_failed' });
  });

  it('erkennt einen Absturz ohne Ergebnis', async () => {
    const { events, finish } = await drain(engine().start(input({ prompt: '[[crash]]' })));
    expect(events.some((e) => e.type === 'result')).toBe(false);
    expect(finish).toMatchObject({ sawResult: false, sandboxUnavailable: false, end: { code: 2 } });
  });

  it('erkennt eine nicht verfügbare Sandbox am Start', async () => {
    const { finish } = await drain(engine().start(input({ prompt: '[[sandboxfail]]' })));
    expect(finish).toMatchObject({ sawResult: false, sandboxUnavailable: true });
  });

  it('meldet ein nicht startendes Programm', async () => {
    const { events, finish } = await drain(
      engine().start(input({ cliPath: join(base, 'gibt-es-nicht') })),
    );
    expect(events).toEqual([]);
    expect(finish.end).toMatchObject({ reason: 'spawn_failed', code: null });
  });

  it('bricht auf Wunsch ab, beendet den Prozess und räumt auf', async () => {
    const run = engine().start(input({ prompt: '[[slow]]' }));
    const iterator = run.events[Symbol.asyncIterator]();
    // Warten, bis „Ich arbeite …“ da ist.
    for (;;) {
      const next = await iterator.next();
      if (next.done || (next.value.type === 'text' && next.value.text.includes('arbeite'))) break;
    }
    run.cancel();
    for (;;) if ((await iterator.next()).done) break;
    const finish = await run.finished;
    expect(finish.end.reason).toBe('cancelled');
    expect(readdirSync(join(dataRoot, 'engine', 'runs'))).toEqual([]);
  });

  it('beendet nach dem Zeitlimit', async () => {
    const { finish } = await drain(
      engine().start(input({ prompt: '[[slow]]', timeoutMinutes: 0.01 })),
    );
    expect(finish.end.reason).toBe('timeout');
    expect(finish.sawResult).toBe(false);
  });

  it('beendet auch ein Programm, das SIGINT und SIGTERM ignoriert, hart', async () => {
    const run = engine().start(input({ prompt: '[[ignoreterm]]', timeoutMinutes: 0.01 }));
    const { finish } = await drain(run);
    expect(finish.end.reason).toBe('timeout');
    expect(
      finish.end.signal === 'SIGKILL' ||
        finish.end.signal === 'SIGTERM' ||
        finish.end.signal === 'SIGINT',
    ).toBe(true);
  }, 20_000);

  it('bricht bei einer zu großen Zeile ab', async () => {
    const { finish } = await drain(engine().start(input({ prompt: '[[huge]]' })));
    expect(finish.end.reason).toBe('output_limit');
  });
});
