import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client';
import { CodexEngine } from './codex';
import { ClaudeCodeEngine } from './engine';
import { OpenCodeEngine } from './opencode';
import { ENGINE_KINDS, type EngineKind } from './profiles';
import { type AgentRunInput, AgentRunner, type AgentRunnerDeps } from './runner';

/**
 * Wahl der Engine je Art des Zugangs (D-104): Claude-Arten über `engine`, `opencode` und `codex` über ihre
 * eigenen Adapter — es gibt keinen Lauf ohne den Safe-Modus des jeweiligen CLI. Alle drei Adapter werden hier
 * nur mit einem Stub-Lauf geflüstert; die Fake-CLI des jeweiligen Adapters prüfen engine.test.ts,
 * opencode.test.ts und codex.test.ts.
 */

const FAKE_OPENCODE = fileURLToPath(new URL('./testing/fake-opencode.mjs', import.meta.url));

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  mkdirSync(join(base, 'arbeitsordner'), { recursive: true });
  chmodSync(FAKE_OPENCODE, 0o755);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const PROFILE = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'glm-coding-plan' as EngineKind,
  name: 'Beispiel-Zugang',
  model: null,
  timeoutMinutes: 1,
  position: 0,
  createdAt: new Date(),
};

/** Aufgezeichnete Start-Aufrufe je Adapter. */
let startedClaude: { cliPath: string; kind: string }[] = [];
let startedOpencode: { cliPath: string; kind: string }[] = [];
let startedCodex: { cliPath: string; kind: string }[] = [];

/** Stub-Lauf für beide Adapter (ohne Prozess): `events` ist bereits der Strom. */
function stubRun(): ReturnType<ClaudeCodeEngine['start']> {
  const stream = async function* () {
    yield { type: 'session', sessionId: 'ses_test', model: 'stub' };
    yield { type: 'text', text: 'antwort' };
    yield {
      type: 'result',
      ok: true,
      text: 'antwort',
      code: null,
      turns: 1,
      durationMs: 5,
      denied: 0,
      resumeFailed: false,
    };
  };
  return {
    events: stream(),
    cancel: () => {},
    finished: Promise.resolve({
      end: { code: 0, signal: null, reason: 'exit' as const },
      sawResult: true,
      sandboxUnavailable: false,
    }),
  } as unknown as ReturnType<ClaudeCodeEngine['start']>;
}

/** Stubs an allen drei Adaptern anbringen und aufzeichnen, wer startet. */
function installStubs(d: AgentRunnerDeps): void {
  vi.spyOn(d.engine, 'start').mockImplementation((input) => {
    startedClaude.push({ cliPath: input.cliPath, kind: input.kind });
    return stubRun();
  });
  vi.spyOn(d.opencode, 'start').mockImplementation((input) => {
    startedOpencode.push({ cliPath: input.cliPath, kind: input.kind });
    return stubRun();
  });
  vi.spyOn(d.codex, 'start').mockImplementation((input) => {
    startedCodex.push({ cliPath: input.cliPath, kind: input.kind });
    return stubRun();
  });
}

/** Datenbank-Schicht nur so weit, wie der Runner sie berührt (`chats.agentSessionId`). */
function fakeDb(): Db {
  return {
    update: () => ({
      set: () => ({
        where: () => ({ run: () => undefined }),
      }),
    }),
  } as unknown as Db;
}

function deps(
  profileKind: (typeof PROFILE)['kind'],
  overrides: Partial<AgentRunnerDeps> = {},
): AgentRunnerDeps {
  const d: AgentRunnerDeps = {
    db: fakeDb(),
    engines: {
      resolve: async (id: string) => {
        if (id !== PROFILE.id) return null;
        // Arten mit Schlüsselpflicht bekommen ein Beispiel-Secret (nie ein echtes).
        const token =
          profileKind === 'glm-coding-plan' || profileKind === 'anthropic-api'
            ? ['beispiel', 'token', 'nicht', 'echt'].join('-')
            : null;
        return { profile: { ...PROFILE, kind: profileKind }, token };
      },
    } as AgentRunnerDeps['engines'],
    // Erkennung meldet die Fake-OpenCode-Binary als bereit (der Pfad wird je Lauf weitergegeben).
    cli: {
      status: async () => ({
        state: 'ready' as const,
        path: FAKE_OPENCODE,
        version: '9.9.9',
        skipped: [],
      }),
    } as unknown as AgentRunnerDeps['cli'],
    workspaces: {
      ensure: () => join(base, 'arbeitsordner'),
    } as unknown as AgentRunnerDeps['workspaces'],
    assets: {
      takeover: async () => [],
    } as unknown as AgentRunnerDeps['assets'],
    engine: new ClaudeCodeEngine({ dataRoot: join(base, 'daten') }),
    opencode: new OpenCodeEngine({ dataRoot: join(base, 'daten') }),
    codex: new CodexEngine({ dataRoot: join(base, 'daten') }),
    ...overrides,
  };
  startedClaude = [];
  startedOpencode = [];
  startedCodex = [];
  installStubs(d);
  return d;
}

function runInput(): AgentRunInput {
  return {
    chatId: 'chat-1',
    assistantId: 'msg-1',
    subjectId: 'fach',
    groupId: null,
    profileId: PROFILE.id,
    system: 'System-Prompt des Fachs.',
    prompt: () => 'Der Auftrag.',
    sessionId: null,
    signal: new AbortController().signal,
    onEvent: () => {},
  };
}

describe('Runner: Wahl der Engine je Art', () => {
  it('startet Claude-Arten (glm-coding-plan) über den Claude-Adapter', async () => {
    const outcome = await new AgentRunner(deps('glm-coding-plan')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedClaude).toEqual([{ cliPath: FAKE_OPENCODE, kind: 'glm-coding-plan' }]);
    expect(startedOpencode).toEqual([]);
  });

  it('startet Claude-Arten (anthropic-api) über den Claude-Adapter', async () => {
    const outcome = await new AgentRunner(deps('anthropic-api')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedClaude).toHaveLength(1);
    expect(startedOpencode).toEqual([]);
  });

  it('startet Claude-Arten (claude-subscription) über den Claude-Adapter', async () => {
    const outcome = await new AgentRunner(deps('claude-subscription')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedClaude).toHaveLength(1);
    expect(startedOpencode).toEqual([]);
  });

  it('startet opencode über den OpenCode-Adapter', async () => {
    const outcome = await new AgentRunner(deps('opencode')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedOpencode).toEqual([{ cliPath: FAKE_OPENCODE, kind: 'opencode' }]);
    expect(startedClaude).toEqual([]);
    expect(startedCodex).toEqual([]);
  });

  it('startet codex über den Codex-Adapter (B-03)', async () => {
    const outcome = await new AgentRunner(deps('codex')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedCodex).toEqual([{ cliPath: FAKE_OPENCODE, kind: 'codex' }]);
    // Kein ungeschützter Fallback: Claude- und OpenCode-Adapter dürfen bei codex nie starten.
    expect(startedClaude).toEqual([]);
    expect(startedOpencode).toEqual([]);
  });

  it('bleibt bei der Registry: jede Art läuft über genau ihren eigenen Adapter, kein Ausweichen', async () => {
    // Der frühere Abweisungs-Test („codex hat keinen Adapter, wird mit engine_unavailable abgewiesen“)
    // ist mit B-03 sinngemäß überführt: Statt der Abweisung wird jetzt die Auswahl geprüft — und
    // zugesichert, dass es für codex weiter keinen Lauf über einen fremden Adapter gibt.
    for (const kind of ENGINE_KINDS) {
      const outcome = await new AgentRunner(deps(kind)).run(runInput());
      expect(outcome.status).toBe('complete');
      // Nur genau ein Adapter hat je Lauf gestartet (die Aufzeichnungen wurden je deps() geleert).
      const total = startedClaude.length + startedOpencode.length + startedCodex.length;
      expect(total).toBe(1);
    }
  });

  it('startet jeden codex-Lauf im eigenen Adapter, nie bei Claude oder OpenCode (Safe-Modus bleibt je CLI)', async () => {
    const outcome = await new AgentRunner(deps('codex')).run(runInput());
    expect(outcome.status).toBe('complete');
    expect(startedCodex).toHaveLength(1);
    expect(startedClaude).toEqual([]);
    expect(startedOpencode).toEqual([]);
  });
});
