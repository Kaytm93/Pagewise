import { eq } from 'drizzle-orm';
import type { ChatErrorCode } from '../chats/generation';
import type { Db } from '../db/client';
import { chats } from '../db/schema';
import { type ActivityEntry, settleActivity, upsertActivity } from './activity';
import type { AssetService, AssetView } from './assets';
import type { CliDetector } from './detect';
import type { ClaudeCodeEngine } from './engine';
import type { EngineProfileService } from './profiles';
import type { AgentEvent } from './stream';
import { snapshotDir, type WorkspaceManager } from './workspace';

/**
 * Führt eine Antwort über den Agent-CLI-Adapter aus: sucht Zugang, Programm und Arbeitsordner, startet den
 * Lauf, gibt Text und Aktivität weiter, nimmt am Ende neue Dateien als Assets an und meldet das Ergebnis.
 * Der Chat-Dienst (`chats/service.ts`) bleibt dafür zuständig, Ereignisse an die Oberfläche zu schicken und
 * die Nachricht zu speichern.
 */

/**
 * Wie viele Pfadbestandteile der Arbeitsordner höchstens haben darf. Gemessen mit Claude Code 2.1.220 auf
 * macOS: bis 10 startet die Sandbox, ab 11 wird ihr Profil so groß (über 1 MB), dass Befehle mit E2BIG scheitern
 * (siehe docs/agent-cli.md). Der Standardpfad auf macOS hat 7, mit Untergruppen ebenfalls 7.
 */
export const MAX_WORKSPACE_DEPTH = 10;

export type RunnerEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking' }
  | { type: 'activity'; entry: ActivityEntry };

export interface AgentRunInput {
  chatId: string;
  /** Die Antwort, an der die erzeugten Dateien hängen. */
  assistantId: string;
  subjectId: string;
  groupId: string | null;
  profileId: string;
  system: string;
  /** Der Auftrag. `resumed` sagt, ob eine frühere Sitzung fortgesetzt wird (dann kennt der Agent den Verlauf schon). */
  prompt: (resumed: boolean) => string;
  sessionId: string | null;
  signal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}

export interface AgentOutcome {
  status: 'complete' | 'stopped' | 'error';
  code: ChatErrorCode | null;
  /** Sitzung zum Fortsetzen im nächsten Auftrag (nur wenn sie sich nicht als unbrauchbar erwiesen hat). */
  sessionId: string | null;
  /** Modell, das laut Programm geantwortet hat. */
  model: string | null;
  activity: ActivityEntry[];
  assets: AssetView[];
}

export interface AgentRunnerDeps {
  db: Db;
  engines: EngineProfileService;
  cli: CliDetector;
  workspaces: WorkspaceManager;
  assets: AssetService;
  engine: ClaudeCodeEngine;
}

export class AgentRunner {
  /** Arbeitsordner, in denen gerade ein Agent läuft: je Ordner nur einer, sonst vermischen sich die erzeugten Dateien. */
  private readonly busyWorkspaces = new Set<string>();

  constructor(private readonly deps: AgentRunnerDeps) {}

  /**
   * Belegt den Arbeitsordner für einen Lauf, sofort und ohne zu warten (damit zwei gleichzeitige Nachrichten
   * nicht beide durchkommen). Gibt die Freigabe zurück, oder `null`, wenn dort schon ein Agent arbeitet.
   */
  reserve(subjectId: string, groupId: string | null): (() => void) | null {
    const key = `${subjectId}/${groupId ?? 'main'}`;
    if (this.busyWorkspaces.has(key)) return null;
    this.busyWorkspaces.add(key);
    return () => {
      this.busyWorkspaces.delete(key);
    };
  }

  async run(input: AgentRunInput): Promise<AgentOutcome> {
    const fail = (code: ChatErrorCode, extra: Partial<AgentOutcome> = {}): AgentOutcome => ({
      status: 'error',
      code,
      sessionId: input.sessionId,
      model: null,
      activity: [],
      assets: [],
      ...extra,
    });

    const resolved = await this.deps.engines.resolve(input.profileId);
    if (!resolved) return fail('profile_missing');
    const { profile, token } = resolved;
    if (profile.kind !== 'claude-subscription' && !token) return fail('no_key');

    const cli = await this.deps.cli.status();
    if (cli.state === 'missing') return fail('cli_missing');
    if (cli.state === 'broken') return fail('cli_broken');

    let workspace: string;
    try {
      workspace = this.deps.workspaces.ensure(input.subjectId, input.groupId);
    } catch {
      return fail('internal');
    }
    if (workspace.split('/').filter(Boolean).length > MAX_WORKSPACE_DEPTH) {
      return fail('workspace_too_deep');
    }
    return this.runIn(input, workspace, cli.path, profile, token);
  }

  private async runIn(
    input: AgentRunInput,
    workspace: string,
    cliPath: string,
    profile: NonNullable<Awaited<ReturnType<EngineProfileService['resolve']>>>['profile'],
    token: string | null,
  ): Promise<AgentOutcome> {
    const before = snapshotDir(workspace);
    let activity: ActivityEntry[] = [];
    let sessionId = input.sessionId;
    let model: string | null = null;
    let sawText = false;

    const handle = (event: AgentEvent): void => {
      switch (event.type) {
        case 'session':
          sessionId = event.sessionId;
          model = event.model ?? model;
          break;
        case 'text':
          sawText = true;
          input.onEvent({ type: 'delta', text: event.text });
          break;
        case 'break':
          // Zwischen zwei Nachrichten des Modells ein Absatz, aber nie am Anfang.
          if (sawText) input.onEvent({ type: 'delta', text: '\n\n' });
          break;
        case 'thinking':
          input.onEvent({ type: 'thinking' });
          break;
        case 'tool': {
          const entry: ActivityEntry = {
            id: event.id,
            tool: event.name,
            target: event.target,
            state: 'running',
          };
          activity = upsertActivity(activity, entry);
          input.onEvent({ type: 'activity', entry });
          break;
        }
        case 'tool_result': {
          const known = activity.find((item) => item.id === event.id);
          if (known) {
            const entry: ActivityEntry = { ...known, state: event.error ? 'error' : 'done' };
            activity = upsertActivity(activity, entry);
            input.onEvent({ type: 'activity', entry });
          }
          break;
        }
        default:
          break;
      }
    };

    interface Attempt {
      code: ChatErrorCode | null;
      resumeFailed: boolean;
      aborted: boolean;
      sawResult: boolean;
    }

    const attempt = async (resume: string | null): Promise<Attempt> => {
      const run = this.deps.engine.start({
        cliPath,
        profileId: profile.id,
        kind: profile.kind,
        token,
        model: profile.model,
        timeoutMinutes: profile.timeoutMinutes,
        workspace,
        prompt: input.prompt(resume !== null),
        systemPrompt: input.system,
        sessionId: resume,
      });
      const onAbort = () => run.cancel();
      if (input.signal.aborted) run.cancel();
      else input.signal.addEventListener('abort', onAbort, { once: true });

      let result: Extract<AgentEvent, { type: 'result' }> | null = null;
      try {
        for await (const event of run.events) {
          if (event.type === 'result') result = event;
          else handle(event);
        }
      } finally {
        input.signal.removeEventListener('abort', onAbort);
      }
      const finish = await run.finished;
      const aborted = input.signal.aborted || finish.end.reason === 'cancelled';

      let code: ChatErrorCode | null = null;
      if (aborted) code = null;
      else if (finish.end.reason === 'spawn_failed') code = 'cli_broken';
      else if (finish.end.reason === 'timeout') code = 'agent_timeout';
      else if (finish.sandboxUnavailable) code = 'sandbox_unavailable';
      else if (!finish.sawResult || result === null) code = 'agent_failed';
      else if (!result.ok) code = result.code ?? 'agent_failed';
      else if (!sawText && result.text.trim() !== '') {
        // Kein Text in Stücken, nur im Ergebnis: dann ist das die Antwort.
        sawText = true;
        input.onEvent({ type: 'delta', text: result.text });
      }
      return {
        code,
        resumeFailed: result?.resumeFailed === true,
        aborted,
        sawResult: finish.sawResult,
      };
    };

    let outcome = await attempt(input.sessionId);
    if (outcome.resumeFailed && input.sessionId !== null && !outcome.aborted) {
      // Die Sitzung gibt es nicht mehr: ohne sie neu beginnen, der Verlauf steckt dann im Auftrag.
      sessionId = null;
      outcome = await attempt(null);
    }

    const aborted = outcome.aborted;
    let assets: AssetView[] = [];
    try {
      assets = await this.deps.assets.takeover(workspace, before, {
        chatId: input.chatId,
        messageId: input.assistantId,
      });
    } catch {
      assets = [];
    }

    let code = outcome.code;
    let status: AgentOutcome['status'] = aborted ? 'stopped' : code ? 'error' : 'complete';
    if (status === 'complete' && !sawText && assets.length === 0) {
      status = 'error';
      code = 'empty_response';
    }
    // Eine Sitzung, die nicht fortsetzbar war oder nie startete, nicht weiterverwenden.
    const keep = outcome.sawResult || aborted ? sessionId : null;
    this.rememberSession(input.chatId, keep);
    return {
      status,
      code,
      sessionId: keep,
      model,
      activity: settleActivity(activity, aborted),
      assets,
    };
  }

  private rememberSession(chatId: string, sessionId: string | null): void {
    try {
      this.deps.db
        .update(chats)
        .set({ agentSessionId: sessionId })
        .where(eq(chats.id, chatId))
        .run();
    } catch {
      // Der Chat wurde inzwischen gelöscht.
    }
  }
}
