import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildAgentEnv, cliDirOf, effectiveModel } from './env';
import { ProcessRun, type RunEnd } from './process';
import type { EngineKind } from './profiles';
import { buildAgentSettings } from './settings';
import { type AgentEvent, AgentStreamParser } from './stream';

/**
 * Der Adapter für Claude Code (`claude`). Er startet die unveränderte Binary im Headless-Modus im Arbeitsordner
 * eines Fachs, liefert deren Ausgabe als Ereignisse und räumt danach auf. Das Programm wird nie verändert, keine
 * Anmeldemethode entfernt oder umgangen; Pagewise liest, speichert und vermittelt keine Zugangsdaten des Abos
 * (siehe docs/agent-cli.md).
 *
 * Aufruf (gemessen mit Claude Code 2.1.220):
 *
 *   claude -p --output-format stream-json --verbose --include-partial-messages
 *     --permission-mode dontAsk --safe-mode --setting-sources local --settings <Datei>
 *     --tools Read,Write,Edit,Glob,Grep,Bash --disable-slash-commands
 *     --append-system-prompt-file <Datei> --max-turns N [--model M] [--resume <Sitzung>]
 *
 * - Der Auftrag kommt über stdin, nie als Argument. Das System-Prompt kommt aus einer Datei (bei `--append-system-prompt`
 *   stünde der Text in der Prozessliste). Es muss bei jedem Lauf neu übergeben werden, auch bei `--resume`.
 * - `--safe-mode` und `--setting-sources local` schalten Hooks, Skills, MCP-Server, Plugins und CLAUDE.md aus
 *   (gemessen: sonst laufen Hooks des Arbeitsordners und des Benutzers mit vollen Rechten). Rechte und Sandbox
 *   aus `--settings` gelten weiter.
 * - Kein `--dangerously-skip-permissions` und nichts Ähnliches, nie.
 */

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Der Text steht im Strom dreifach (Stücke, Nachricht, Ergebnis): Eine Zeile kann so groß wie die Antwort sein. */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_TURNS = 40;
export const AGENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'] as const;

export interface AgentStartInput {
  cliPath: string;
  profileId: string;
  kind: EngineKind;
  token: string | null;
  model: string | null;
  timeoutMinutes: number;
  /** Aufgelöster Pfad des Arbeitsordners. */
  workspace: string;
  /** Der Auftrag der Person (letzte Nachricht). */
  prompt: string;
  /** Zusammengesetzte Prompt-Schichten des Fachs. */
  systemPrompt: string;
  /** Sitzung des vorigen Auftrags in diesem Chat, falls es eine gibt. */
  sessionId: string | null;
  maxTurns?: number;
}

export interface AgentFinish {
  end: RunEnd;
  /** Ein `result`-Ereignis ist angekommen. Fehlt es, ist der Lauf abgebrochen oder abgestürzt. */
  sawResult: boolean;
  /** stderr deutet auf einen Fehler beim Start der Sandbox hin (z. B. fehlende Abhängigkeit). */
  sandboxUnavailable: boolean;
}

export interface AgentRun {
  /** Ereignisse des Laufs. Endet, wenn der Prozess beendet ist. */
  events: AsyncIterable<AgentEvent>;
  cancel(): void;
  /** Wird nach dem letzten Ereignis erfüllt (nie abgelehnt). */
  finished: Promise<AgentFinish>;
}

export interface EngineOptions {
  /** Datenverzeichnis (Wurzel). Läufe und Konfigurationen der Zugänge liegen unter `engine/`. */
  dataRoot: string;
  /** Umgebung des Servers, aus der die Allowlist liest. Nur für Tests änderbar. */
  env?: NodeJS.ProcessEnv;
  /** Echtes Benutzerverzeichnis (gesperrt für Befehle). Nur für Tests änderbar. */
  realHome?: string;
  /** Nur für Tests: zusätzliche Variablen für den Prozess (z. B. Aufzeichnung der Fake-CLI). Nie im Betrieb. */
  extraEnv?: Record<string, string>;
}

export class ClaudeCodeEngine {
  private readonly env: NodeJS.ProcessEnv;
  private readonly realHome: string;

  constructor(private readonly options: EngineOptions) {
    this.env = options.env ?? process.env;
    this.realHome = options.realHome ?? this.env.HOME ?? homedir();
  }

  /** Eigenes `HOME` eines Zugangs mit Schlüssel. Bleibt zwischen Läufen bestehen, damit `--resume` die Sitzung findet. */
  private isolatedHome(profileId: string): string {
    const home = join(this.options.dataRoot, 'engine', profileId, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 });
    return home;
  }

  start(input: AgentStartInput): AgentRun {
    // Die Sandbox vergleicht echte Pfade (auf macOS ist /var ein Verweis auf /private/var), das Programm meldet
    // sie auch so: Regeln und Anzeige müssen von Anfang an mit dem aufgelösten Pfad arbeiten.
    const workspace = realpathSync(input.workspace);
    const runDir = join(this.options.dataRoot, 'engine', 'runs', randomUUID());
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const cleanup = () => rmSync(runDir, { recursive: true, force: true });

    let run: ProcessRun;
    try {
      const settingsFile = join(runDir, 'settings.json');
      const promptFile = join(runDir, 'system-prompt.md');
      const settings = buildAgentSettings({
        workspace,
        realHome: this.realHome,
        dataRoot: this.options.dataRoot,
        searchPath: this.env.PATH,
      });
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
      writeFileSync(promptFile, input.systemPrompt, { mode: 0o600 });
      chmodSync(settingsFile, 0o600);
      chmodSync(promptFile, 0o600);

      const model = effectiveModel(input.kind, input.model);
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--permission-mode',
        'dontAsk',
        '--safe-mode',
        '--setting-sources',
        'local',
        '--settings',
        settingsFile,
        '--tools',
        AGENT_TOOLS.join(','),
        '--disable-slash-commands',
        '--append-system-prompt-file',
        promptFile,
        '--max-turns',
        String(input.maxTurns ?? DEFAULT_MAX_TURNS),
      ];
      if (model) args.push('--model', model);
      if (input.sessionId) args.push('--resume', input.sessionId);

      const env = {
        ...buildAgentEnv({
          kind: input.kind,
          token: input.token,
          model: input.model,
          cliDir: cliDirOf(input.cliPath),
          source: this.env,
          isolatedHome:
            input.kind === 'claude-subscription' ? null : this.isolatedHome(input.profileId),
        }),
        ...this.options.extraEnv,
      };

      run = new ProcessRun({
        command: input.cliPath,
        args,
        cwd: workspace,
        env,
        stdin: input.prompt,
        timeoutMs: input.timeoutMinutes * 60_000,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        maxLineBytes: MAX_LINE_BYTES,
        // Erst SIGINT: Das Programm beendet den Zug sauber und meldet ein Ergebnis.
        escalation: ['SIGINT', 'SIGTERM', 'SIGKILL'],
        killGraceMs: 4_000,
      });
    } catch (error) {
      cleanup();
      throw error;
    }

    const parser = new AgentStreamParser(workspace);
    let sawResult = false;
    const events = (async function* (): AsyncGenerator<AgentEvent> {
      try {
        for await (const line of run.lines) {
          for (const event of parser.parse(line)) {
            if (event.type === 'result') sawResult = true;
            yield event;
          }
        }
      } finally {
        // Wer die Ereignisse nicht bis zum Ende liest (Abbruch), beendet auch den Prozess.
        run.cancel();
      }
    })();

    const finished = (async (): Promise<AgentFinish> => {
      const end = await run.ended;
      const stderr = run.stderrTail();
      cleanup();
      return {
        end,
        sawResult,
        sandboxUnavailable: end.code !== 0 && !sawResult && /sandbox/i.test(stderr),
      };
    })();

    return { events, cancel: () => run.cancel(), finished };
  }
}
