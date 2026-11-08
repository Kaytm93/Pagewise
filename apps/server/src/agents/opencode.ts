import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  type AgentFinish,
  type AgentRun,
  type AgentStartInput,
  type EngineOptions,
  MAX_LINE_BYTES,
  MAX_OUTPUT_BYTES,
} from './engine';
import { PASSTHROUGH_ENV } from './env';
import { ProcessRun, type RunEnd } from './process';
import { type AgentErrorCode, type AgentEvent, toolTarget } from './stream';

// Der Runner und seine Tests nutzen dieselben Typen wie beim Vorbild `engine.ts`.
export type { AgentFinish, AgentRun, AgentStartInput, EngineOptions };

/**
 * Der Adapter für OpenCode (`opencode`). Er startet die unveränderte Binary nicht-interaktiv im Arbeitsordner
 * eines Fachs, liest ihre JSON-Ereignisse und macht daraus die eigenen AgentEvent-Typen. Das Programm wird nie
 * verändert, keine Anmeldung umgangen; Pagewise vermittelt keine Schlüssel — die Anmeldung der App liegt im
 * echten Benutzerverzeichnis und bleibt dort (siehe docs/agent-cli.md und D-104).
 *
 * Aufruf (ermittelt mit `opencode --help` bzw. `opencode run --help`, gemessen mit opencode 2.0.29):
 *
 *   opencode run --standalone --format json --thinking --agent pagewise [--model M] [--session S]
 *
 * - Der Auftrag kommt über stdin, nie als Argument (gemessen: ohne Nachrichten-Argument liest `run` stdin).
 * - `--standalone` startet einen privaten Server im eigenen Prozess (`serve --stdio --port 0`, gemessen):
 *   der Hintergrunddienst der Person (fester Port) wird nie berührt, und beim Beenden trifft das Signal
 *   über die Prozessgruppe auch diesen Kindprozess.
 * - `--format json` liefert eine JSON-Zeile je Ereignis (gemessen und dokumentiert: `text`, `tool_use`,
 *   `step_start`, `step_finish`, `reasoning` nur mit `--thinking`, `error`).
 * - Kein `--auto`: Das Flagsgenehmigt Berechtigungen und ist verboten (REGELN 4, D-104). Stattdessen erhält
 *   der Lauf eine eigene Konfiguration über `OPENCODE_CONFIG` (Pfad als Umgebungsvariable, gemessen als
 *   eigene Konfigurationsquelle): Kein Treffer in den Berechtigungsregeln ist „deny“, danach werden nur
 *   Lesen und Schreiben im Arbeitsordner ausdrücklich erlaubt. Was bleibt, wird verweigert; im
 *   nicht-interaktiven Lauf gibt es keinen Prompt, den ein „ask“ hätte überspringen können (Quelle:
 *   opencode.ai/docs/permissions — „ask: Wait for a decision from the client“; Headless lehnt ab).
 * - `policies` härten zusätzlich ab (shell, webfetch, websearch, MCP, Skills, Plugins); Policies überschreiben
 *   nach Dokumentation jede engere Konfiguration, ein Arbeitsordner kann sie nicht zurückdrehen.
 * - `AGENTS.md` im Arbeitsordner wird als Anweisung geladen — das entspricht CLAUDE.md; ein Ausschalten ist
 *   nicht dokumentiert. Restrisiko begrenzt: Jede Aktion läuft durch die Berechtigungsregeln (nur Lesen und
 *   Schreiben im Arbeitsordner), Anweisungen können sie nicht aufheben.
 */

/** Agent-Name der eigenen Konfiguration (wird je Lauf mit `--agent` gesetzt). */
export const AGENT_NAME = 'pagewise';

/** Kürzt und bereinigt einen Hinweis zur Anzeige: ohne Steuerzeichen, höchstens `max` Zeichen. */
function shorten(text: string, max = 120): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return [...clean].length > max ? `${[...clean].slice(0, max - 1).join('')}…` : clean;
}

/** Größter Name einer Datei im Ziel-Hinweis (Dateiname, nie Pfad) — wie `stream.ts`. */
function fileBase(value: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const base = clean.split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!base) return null;
  const chars = [...base];
  return chars.length > 80 ? chars.slice(0, 80).join('') : base;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Ziel-Hinweis eines Werkzeugaufrufs: Datei bzw. Befehl aus der Eingabe, sonst der Kurztitel des Programms. */
function targetOf(
  tool: string,
  state: Record<string, unknown> | null,
  workspace: string,
): string | null {
  const input = isRecord(state?.input) ? state.input : null;
  const fromInput =
    input === null ? null : toolTarget(tool === 'bash' ? 'Bash' : tool, input, workspace);
  if (fromInput) return fromInput;
  const title = str(state?.title);
  return title ? shorten(title) : null;
}

/** Rein Dateiname eines Datei-Werkzeugs, falls seine Eingabe einen Pfad nennt. */
function fileOf(state: Record<string, unknown> | null): string | null {
  const input = isRecord(state?.input) ? state.input : null;
  if (input === null) return null;
  const path =
    str(input.file_path) ?? str(input.filePath) ?? str(input.notebook_path) ?? str(input.path);
  return path === null ? null : fileBase(path);
}

export interface OpenCodeRule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
}

export interface OpenCodeAgentConfig {
  mode: 'primary';
  description: string;
  /** Anweisungen des Fachs (System-Prompt), statt als Argument in der Prozessliste. */
  system: string;
}

export interface OpenCodeConfig {
  $schema: string;
  update: 'disable';
  autoupdate?: false;
  share: 'disabled';
  snapshots: boolean;
  instructions: string[];
  permissions: OpenCodeRule[];
  policies: OpenCodeRule[];
  agent: Record<string, OpenCodeAgentConfig>;
  default_agent: string;
}

/**
 * Baut die Konfiguration für einen Lauf: deny-by-default, danach nur Lesen und Schreiben im Arbeitsordner,
 * Härtung über Policies. Das System-Prompt des Fachs liegt im Agenten der Konfiguration (Datei statt Argument,
 * damit der Text nicht in der Prozessliste steht); sie wird je Lauf neu geschrieben und danach gelöscht.
 */
export function buildOpenCodeConfig(input: { systemPrompt: string }): OpenCodeConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    // Kein Selbstupdate, kein Teilen von Sitzungen, keine Momentaufnahmen (Quelle: opencode.ai/docs/config).
    update: 'disable',
    // Ältere Versionen kennen das Feld unter dem alten Namen (Quelle: community-Dokumentation).
    autoupdate: false,
    share: 'disabled',
    snapshots: false,
    // Keine zusätzlichen Anweisungsdateien über die Einstellung (entdeckte AGENTS.md bleiben — siehe oben).
    instructions: [],
    // Zuerst alles verweigern (auch external_directory und .env-Abfragen der Grundregeln), dann nur den
    // Arbeitsordner freigeben. Reihenfolge zählt: die letzte passende Regel gewinnt.
    permissions: [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'read', resource: '**', effect: 'allow' },
      { action: 'edit', resource: '**', effect: 'allow' },
    ],
    // Härtung, die engere Konfiguration (Arbeitsordner) nicht überschreiben kann (opencode.ai/docs/policies).
    // MCP/Skill/Plugin über `integration.use` mit Präfix: neuere Versionen wandeln es um, ältere (wie 2.0.29)
    // verstehen nur diese Form.
    policies: [
      { action: 'tool.use', resource: 'shell:*', effect: 'deny' },
      { action: 'tool.use', resource: 'webfetch:*', effect: 'deny' },
      { action: 'tool.use', resource: 'websearch:*', effect: 'deny' },
      { action: 'integration.use', resource: 'mcp:*', effect: 'deny' },
      { action: 'integration.use', resource: 'skill:*', effect: 'deny' },
      { action: 'integration.use', resource: 'plugin:*', effect: 'deny' },
    ],
    agent: {
      [AGENT_NAME]: {
        mode: 'primary',
        description: 'Pagewise',
        system: input.systemPrompt,
      },
    },
    // Auch ohne `--agent` ist das der Agent des Laufs.
    default_agent: AGENT_NAME,
  };
}

/**
 * Umgebung des Prozesses: feste Allowlist (PASSTHROUGH_ENV aus agents/env.ts), Pfad mit dem Ordner der Binary,
 * echtes Benutzerverzeichnis (dort liegt die Anmeldung der App, wie beim Claude-Abo) und der Pfad der
 * eigenen Konfiguration. Niemals `process.env` des Servers.
 */
export function buildOpenCodeEnv(input: {
  cliDir: string;
  source: NodeJS.ProcessEnv;
  configFile: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH_ENV) {
    const value = input.source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  const serverPath = input.source.PATH ?? '/usr/bin:/bin';
  env.PATH = [...new Set([input.cliDir, ...serverPath.split(delimiter)])]
    .filter(Boolean)
    .join(delimiter);
  const home = input.source.HOME;
  if (!home) throw new Error('Für diesen Zugang ist kein Benutzerverzeichnis bekannt.');
  env.HOME = home;
  env.OPENCODE_CONFIG = input.configFile;
  return env;
}

/** Ordnet einen Fehlerstrom des Programms einem Fehlercode zu (nur Art und Status, nie der Text). */
function classifyError(error: { type: string; status: number | null }): AgentErrorCode {
  const type = error.type.toLowerCase();
  if (type.includes('auth')) return 'auth_failed';
  if (error.status === 429) return 'rate_limited';
  if (error.status === 402) return 'insufficient_credits';
  if (error.status === 401 || error.status === 403) return 'auth_failed';
  if (type.includes('abort')) return 'agent_failed';
  if (type.includes('transport') || error.status !== null) return 'upstream_error';
  return 'agent_failed';
}

/**
 * Liest den Ereignisstrom von `opencode run --format json` (eine JSON-Zeile je Ereignis) und sammelt die
 * wenigen Dinge, die Pagewise braucht. Inhalte von Werkzeugergebnissen werden nie weitergegeben; vom Fehler
 * kommt nur die Art (Code), nie der Text des Programms.
 */
export class OpenCodeStreamParser {
  private sessionId: string | null = null;
  private readonly lastTextByPart = new Map<string, string>();
  private readonly toolStarted = new Set<string>();
  private readonly toolFinished = new Set<string>();
  private text = '';
  private sawEvent = false;
  private sawText = false;
  private steps = 0;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private denied = 0;
  private error: { type: string; status: number | null } | null = null;

  private workspace: string | null;

  constructor(workspace: string | null = null) {
    this.workspace = workspace;
  }

  /**
   * Verarbeitet eine Zeile. Kein JSON oder unbekannt: keine Ereignisse.
   */
  parse(line: string): AgentEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isRecord(json)) return [];
    const type = str(json.type);
    if (type === null) return [];
    const events: AgentEvent[] = [];
    this.sawEvent = true;

    const sessionId = str(json.sessionID);
    if (sessionId && this.sessionId === null) {
      this.sessionId = sessionId;
      // Das Programm nennt das Modell im Strom nicht: es bleibt leer (der Lauf behält den bisherigen Stand).
      events.push({ type: 'session', sessionId, model: null });
    }
    const timestamp = num(json.timestamp);
    if (timestamp !== null) {
      this.startedAt ??= timestamp;
      this.endedAt = timestamp;
    }

    if (type === 'step_start') {
      this.steps += 1;
      if (this.sawText) events.push({ type: 'break' });
    } else if (type === 'text') {
      const part = isRecord(json.part) ? json.part : null;
      const value = str(part?.text);
      if (value) {
        // Das Programm schickt Textblöcke ganz oder wachsend: nur das neue Stück weitergeben.
        const id = str(part?.id) ?? '';
        const last = this.lastTextByPart.get(id) ?? '';
        const added = value.startsWith(last) ? value.slice(last.length) : value;
        this.lastTextByPart.set(id, value);
        if (added) {
          this.sawText = true;
          this.text += added;
          events.push({ type: 'text', text: added });
        }
      }
    } else if (type === 'tool_use') {
      events.push(...this.toolUse(json));
    } else if (type === 'reasoning') {
      events.push({ type: 'thinking' });
    } else if (type === 'error') {
      const error = isRecord(json.error) ? json.error : null;
      this.error = {
        type: str(error?.type) ?? 'unknown',
        status: num(error?.status),
      };
    }
    return events;
  }

  private toolUse(json: Record<string, unknown>): AgentEvent[] {
    const part = isRecord(json.part) ? json.part : null;
    const tool = str(part?.tool);
    const call = str(part?.callID);
    if (!tool || !call) return [];
    const state = isRecord(part?.state) ? part.state : null;
    const status = str(state?.status);
    if (status === 'completed' || status === 'error') {
      const events: AgentEvent[] = [];
      if (!this.toolStarted.has(call)) {
        this.toolStarted.add(call);
        events.push({
          type: 'tool',
          id: call,
          name: tool,
          target: targetOf(tool, state, this.workspace ?? ''),
          file: fileOf(state),
        });
      }
      if (!this.toolFinished.has(call)) {
        this.toolFinished.add(call);
        const failure = status === 'error' ? (str(state?.error) ?? '') : '';
        // Wie oft die Rechte des Programms verweigert haben: nur zählen, nie den Text (Regel 8).
        if (status === 'error' && /permission|berechtig/i.test(failure)) this.denied += 1;
        events.push({ type: 'tool_result', id: call, error: status === 'error' });
      }
      return events;
    }
    if (status === 'pending' || status === 'running') {
      if (this.toolStarted.has(call)) return [];
      this.toolStarted.add(call);
      return [
        {
          type: 'tool',
          id: call,
          name: tool,
          target: targetOf(tool, state, this.workspace ?? ''),
          file: fileOf(state),
        },
      ];
    }
    return [];
  }

  /**
   * Das Ergebnis am Ende des Stroms. Das Programm kennt kein eigenes Ergebnis-Ereignis: Pagewise baut es aus
   * dem Fehler-Strom (oder dessen Fehlen) und dem Ende des Prozesses. Ein Fehler ist auch dann ein Fehler,
   * wenn das Programm mit Exit-Code 0 endet — das meldet es nach einer verweigerten Berechtigungsanfrage so.
   */
  finalize(end: RunEnd): AgentEvent[] {
    // Nie gestartet (Binary fehlt): kein Ergebnis, wie bei engine.ts — der Lauf ist schlicht gescheitert.
    if (end.reason === 'spawn_failed') return [];
    // Ein Lauf, dessen Werkzeug wegen verweigerter Rechte abbrach und der nichts antwortete, ist kein Erfolg.
    const failed =
      this.error !== null ||
      !this.sawEvent ||
      (end.reason === 'exit' && end.code !== 0) ||
      (this.denied > 0 && !this.sawText);
    return [
      {
        type: 'result',
        ok: !failed,
        text: failed ? '' : this.text,
        code: failed ? ((this.error && classifyError(this.error)) ?? 'agent_failed') : null,
        turns: this.steps > 0 ? this.steps : null,
        durationMs:
          this.startedAt !== null && this.endedAt !== null && this.endedAt >= this.startedAt
            ? this.endedAt - this.startedAt
            : null,
        denied: this.denied,
        // Ob eine Sitzung fortsetzbar war, meldet das Programm nicht: nicht behaupten.
        resumeFailed: false,
      },
    ];
  }
}

/**
 * Startet `opencode run` im Arbeitsordner eines Fachs: eigener Lauf-Ordner im Datenverzeichnis, eigene
 * Konfiguration (Safe-Modus), Allowlist-Umgebung, Auftrag über stdin, Grenzen und gestuftes Beenden wie
 * beim Vorbild `engine.ts`.
 */
export class OpenCodeEngine {
  private readonly env: NodeJS.ProcessEnv;
  private readonly realHome: string;

  constructor(private readonly options: EngineOptions) {
    this.env = options.env ?? process.env;
    this.realHome = options.realHome ?? this.env.HOME ?? homedir();
  }

  start(input: AgentStartInput): AgentRun {
    const workspace = realpathSync(input.workspace);
    const runDir = join(this.options.dataRoot, 'engine', 'runs', randomUUID());
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const cleanup = () => rmSync(runDir, { recursive: true, force: true });

    let run: ProcessRun;
    try {
      const configFile = join(runDir, 'opencode.json');
      writeFileSync(
        configFile,
        `${JSON.stringify(buildOpenCodeConfig({ systemPrompt: input.systemPrompt }), null, 2)}\n`,
        { mode: 0o600 },
      );

      const args = ['run', '--standalone', '--format', 'json', '--thinking', '--agent', AGENT_NAME];
      if (input.model) args.push('--model', input.model);
      if (input.sessionId) args.push('--session', input.sessionId);

      const env = {
        ...buildOpenCodeEnv({
          cliDir: dirname(input.cliPath),
          source: this.env,
          configFile,
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
        // Erst SIGINT, dann SIGTERM, dann SIGKILL — an die ganze Prozessgruppe (auch der private Server).
        escalation: ['SIGINT', 'SIGTERM', 'SIGKILL'],
        killGraceMs: 4_000,
      });
    } catch (error) {
      cleanup();
      throw error;
    }

    const parser = new OpenCodeStreamParser(workspace);
    // Das Ergebnis entsteht im Ereignis-Strom (finalize): Er muss gelesen sein, bevor `finished` es meldet.
    let markStreamDone = () => {};
    let sawResult = false;
    const events = (async function* (): AsyncGenerator<AgentEvent> {
      try {
        for await (const line of run.lines) {
          for (const event of parser.parse(line)) yield event;
        }
        for (const event of parser.finalize(await run.ended)) {
          if (event.type === 'result') sawResult = true;
          yield event;
        }
      } finally {
        // Wer die Ereignisse nicht bis zum Ende liest (Abbruch), beendet auch den Prozess.
        run.cancel();
        markStreamDone();
      }
    })();

    const finished = (async (): Promise<AgentFinish> => {
      const end = await run.ended;
      await new Promise<void>((resolve) => {
        markStreamDone = resolve;
        // Falls der Strom schon zu Ende ist (oder nie gelesen wird), hier nicht hängen bleiben.
        const timer = setTimeout(resolve, 500);
        timer.unref?.();
      });
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
