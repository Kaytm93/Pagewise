import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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

// Der Runner und seine Tests nutzen dieselben Typen wie beim Vorbild `engine.ts` und `opencode.ts`.
export type { AgentFinish, AgentRun, AgentStartInput, EngineOptions };

/**
 * Der Adapter für Codex (`codex` der OpenAI Codex CLI). Er startet die unveränderte Binary nicht-interaktiv
 * im Arbeitsordner eines Fachs, liest ihre JSONL-Ereignisse und macht daraus die eigenen AgentEvent-Typen.
 * Das Programm wird nie verändert, keine Anmeldung umgangen; Pagewise vermittelt keine Schlüssel — die
 * Anmeldung der App liegt im echten Benutzerverzeichnis und bleibt dort (siehe docs/agent-cli.md und D-104).
 *
 * Aufruf (nicht gemessen — codex ist auf dieser Maschine nicht installiert; belegt aus der offiziellen
 * Dokumentation, Stand 9. November 2026):
 *
 *   codex exec --json --skip-git-repo-check --ignore-user-config --ignore-rules \
 *     --sandbox workspace-write --output-last-message <Datei> - [--model M]
 *
 * - `exec` ist der nicht-interaktive Untermodus („Non-interactive mode lets you run Codex from scripts …
 *   without opening the interactive TUI“). Es gibt keinen Prompt-Dialog, dem ein Flag ausweichen könnte.
 * - Der Auftrag kommt über stdin (`codex exec -`: „If you omit the prompt argument, Codex reads the prompt
 *   from stdin“), nie als Argument.
 * - `--json` macht stdout zu einem JSONL-Strom („Event types include thread.started, turn.started,
 *   turn.completed, turn.failed, item.*, and error“).
 * - Sandbox und Safe-Modus: `codex exec` läuft laut Doku von Haus aus in einer Read-only-Sandbox
 *   („By default, codex exec runs in a read-only sandbox“); `--sandbox workspace-write` erlaubt zusätzlich
 *   Schreiben, aber nur im Arbeitsordner („write permissions limited to the active workspace“), Netz bleibt
 *   aus („the default workspace-write sandbox mode keeps network access turned off unless you enable it“).
 *   `.git`, `.agents`, `.codex` und `.aws` bleiben im Schreibmodus als geschützte Pfade lesend
 *   („Protected paths in writable roots“).
 * - Kein Flag, das Berechtigungsabfragen überspringt (REGELN 4, D-104): `--ask-for-approval`/`-a` wird von
 *   `codex exec` abgelehnt (Doku-Fehler GitHub openai/codex #13614, 6. April 2026) und ist hier absichtlich
 *   nicht gesetzt — der nicht-interaktive Untermodus hat ohnehin keinen Dialog (Doku zu `exec --help`,
 *   korrigiert im April 2026: „non-interactive exec stays headless and does not support interactive
 *   approval prompts“). Was die Sandbox verweigert, scheitert (Fail-closed, GitHub #24135: „approval policy
 *   is never … before dispatch“); `--full-auto` und `--dangerously-bypass-approvals-and-sandbox`/`--yolo`
 *   kommen nie in den Aufruf.
 * - `--ignore-user-config` (lädt `$CODEX_HOME/config.toml` nicht) und `--ignore-rules` (lädt `rules`-Dateien
 *   von Nutzer und Projekt nicht) halten Einstellungen und Regeln des Rechners aus dem Lauf heraus.
 * - `AGENTS.md` im Arbeitsordner wird als Anweisung geladen — das ist beabsichtigt und entspricht dem
 *   Verhalten bei Claude (`CLAUDE.md`); ein Ausschalten ist nicht dokumentiert. Restrisiko begrenzt: Jede
 *   Aktion läuft durch die Sandbox (nur Lesen überall, Schreiben nur im Arbeitsordner, kein Netz),
 *   Anweisungen können sie nicht aufheben.
 * - `--skip-git-repo-check` erlaubt den Lauf im (noch) nicht versionierten Arbeitsordner eines Fachs; die
 *   Prüfung ist ein Komfort-Check des Programms, kein Sicherheitshebel (die Sandbox bleibt an).
 *
 * Belege (alle abgerufen am 9. November 2026): Non-interactive mode
 * (https://developers.openai.com/codex/noninteractive bzw. learn.chatgpt.com/docs/non-interactive-mode.md),
 * Agent approvals & security (learn.chatgpt.com/docs/agent-approvals-security.md), Sandboxing
 * (learn.chatgpt.com/docs/sandboxing.md), CLI-Referenz (learn.chatgpt.com/docs/developer-commands),
 * GitHub openai/codex #13614 (Apr 2026) und #24135 (Mai/Okt 2026).
 */

/** Größter Name einer Datei im Ziel-Hinweis (Dateiname, nie Pfad) — wie `stream.ts`. */
const MAX_FILE = 80;

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
  return chars.length > MAX_FILE ? chars.slice(0, MAX_FILE).join('') : base;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Ziel-Hinweis eines Werkzeugaufrufs: Datei bzw. Befehl aus der Eingabe, sonst Kurztitel des Eintrags. */
function targetOf(tool: string, item: Record<string, unknown>, workspace: string): string | null {
  const fromInput = toolTarget(tool, item, workspace);
  if (fromInput) return fromInput;
  // Der Befehl steht nur bei Befehls-Ausführungen im Ziel; bei Dateiänderungen bleibt er Inhalt.
  if (tool === 'command_execution') {
    const command = str(item.command);
    if (command) return shorten(command);
  }
  const first = firstChange(item);
  return first === null ? null : shorten(first);
}

/** Erster Dateiname im `changes`-Feld eines Dateiänderungs-Eintrags, sonst null. */
function firstChange(item: Record<string, unknown>): string | null {
  const changes = item.changes;
  const first = Array.isArray(changes)
    ? changes.find((entry): entry is string => typeof entry === 'string')
    : null;
  return first ?? null;
}

/** Rein Dateiname eines Datei-Werkzeugs aus dem `changes`-Feld des Eintrags. */
function fileOf(item: Record<string, unknown>): string | null {
  const first = firstChange(item);
  if (first !== null) return fileBase(first);
  const path = str(item.path) ?? str(item.file_path);
  return path === null ? null : fileBase(path);
}

interface CodexError {
  message: string;
  status: number | null;
}

/**
 * Baut die Umgebung des Prozesses: feste Allowlist (PASSTHROUGH_ENV aus agents/env.ts), Pfad mit dem Ordner
 * der Binary, echtes Benutzerverzeichnis (dort liegt die Anmeldung der App, wie beim Claude-Abo) und ein
 * leeres `CODEX_HOME` im Lauf-Ordner (damit der Lauf keine Einstellungen und keine Anmeldung des Rechners
 * liest; das eigentliche Home des Benutzers bleibt `HOME` für die Anmeldung der App). Niemals `process.env`
 * des Servers.
 */
export function buildCodexEnv(input: {
  cliDir: string;
  source: NodeJS.ProcessEnv;
  codexHome: string;
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
  env.CODEX_HOME = input.codexHome;
  return env;
}

/**
 * Muster im Fehlertext des Programms: nur die Art des Fehlers, nie der Inhalt (Regel 8). Das Programm
 * nennt die Art in seiner eigenen Meldung; die englischen Muster sind die der offiziellen CLI
 * (Anmeldung, Ratenlimit, Kontingent, Serverfehler), die deutschen die der Fehlercodes von Pagewise.
 */
const ERROR_KINDS: ReadonlyArray<{ pattern: RegExp; code: AgentErrorCode }> = [
  { pattern: /unauthorized|login required|nicht angemeldet|auth/i, code: 'auth_failed' },
  { pattern: /rate limit|429|zu viele anfragen/i, code: 'rate_limited' },
  { pattern: /usage limit|insufficient|credits|kontingent/i, code: 'insufficient_credits' },
  { pattern: /server error|internal error|upstream/i, code: 'upstream_error' },
];

/** Ordnet einen Fehlerstrom des Programms einem Fehlercode zu (nur Art und Status, nie der Text). */
function classifyError(error: CodexError): AgentErrorCode {
  if (error.status === 429) return 'rate_limited';
  if (error.status === 402) return 'insufficient_credits';
  if (error.status === 401 || error.status === 403) return 'auth_failed';
  if (error.status !== null && error.status >= 500) return 'upstream_error';
  for (const kind of ERROR_KINDS) {
    if (kind.pattern.test(error.message)) return kind.code;
  }
  return 'agent_failed';
}

/**
 * Liest den Ereignis-Strom von `codex exec --json` (eine JSON-Zeile je Ereignis, JSONL) und sammelt die
 * wenigen Dinge, die Pagewise braucht. Inhalte von Werkzeugergebnissen werden nie weitergegeben; vom Fehler
 * kommt nur die Art (Code), nie der Text des Programms.
 */
export class CodexStreamParser {
  private sessionId: string | null = null;
  private readonly lastTextByItem = new Map<string, string>();
  private readonly toolStarted = new Set<string>();
  private readonly toolFinished = new Set<string>();
  private text = '';
  private sawEvent = false;
  private sawText = false;
  private steps = 0;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private denied = 0;
  private error: CodexError | null = null;
  /** Ein neuer Zug hat begonnen, seitdem es Text gab: der nächste Textblock bekommt einen Absatz voran. */
  private pendingBreak = false;

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
    this.sawEvent = true;

    if (type === 'thread.started') {
      const threadId = str(json.thread_id);
      if (threadId && this.sessionId === null) {
        this.sessionId = threadId;
        // Das Programm nennt das Modell im Strom nicht: es bleibt leer (der Lauf behält den bisherigen Stand).
        return [{ type: 'session', sessionId: threadId, model: null }];
      }
      return [];
    }
    if (type === 'turn.started') {
      this.steps += 1;
      if (this.sawText) {
        // Ein neuer Zug nach Text: im Fließtext ein Absatz (wie `step_start` bei opencode).
        this.pendingBreak = true;
      }
      return [];
    }
    if (type === 'item.started' || type === 'item.completed' || type === 'item.updated') {
      const item = isRecord(json.item) ? json.item : null;
      const id = str(item?.id);
      if (item === null || id === null) return [];
      const itemType = str(item.type);
      if (itemType === 'agent_message') {
        const value = str(item.text);
        if (value) {
          // Das Programm schickt Textblöcke ganz oder wachsend: nur das neue Stück weitergeben.
          const last = this.lastTextByItem.get(id) ?? '';
          const added = value.startsWith(last) ? value.slice(last.length) : value;
          this.lastTextByItem.set(id, value);
          if (added) {
            const events: AgentEvent[] = [];
            if (this.pendingBreak) {
              this.pendingBreak = false;
              events.push({ type: 'break' });
            }
            this.sawText = true;
            this.text += added;
            events.push({ type: 'text', text: added });
            return events;
          }
        }
        return [];
      }
      if (itemType === 'reasoning') {
        return [{ type: 'thinking' }];
      }
      if (
        itemType === 'command_execution' ||
        itemType === 'file_change' ||
        itemType === 'mcp_tool_call' ||
        itemType === 'web_search'
      ) {
        return this.toolItem(type, id, item);
      }
      return [];
    }
    if (type === 'turn.completed') {
      const usage = isRecord(json.usage) ? json.usage : null;
      const total = num(usage?.input_tokens) ?? 0;
      if (total > 0 && this.steps === 0) this.steps = 1;
      return [];
    }
    if (type === 'turn.failed' || type === 'error') {
      const error = isRecord(json.error) ? json.error : null;
      const message = str(error?.message) ?? str(json.message) ?? '';
      // 429 aus dem Text des Programms, ohne den Text weiterzugeben.
      const status = num(error?.status) ?? (/(429|rate.?limit)/i.test(message) ? 429 : null);
      // Der erste Fehler zählt: `turn.failed` wiederholt oft nur die allgemeine Ablehnung des Zugs,
      // während das `error`-Ereignis die Art (Anmeldung, Ratenlimit) nennt.
      if (this.error === null) this.error = { message, status };
      return [];
    }
    return [];
  }

  private toolItem(lineType: string, id: string, item: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    const status = str(item.status);
    const finished = status === 'completed' || status === 'failed';
    if (!this.toolStarted.has(id)) {
      this.toolStarted.add(id);
      const name = str(item.type) ?? 'tool';
      events.push({
        type: 'tool',
        id,
        name,
        target: targetOf(name, item, this.workspace ?? ''),
        file: fileOf(item),
      });
    }
    if (finished && !this.toolFinished.has(id)) {
      this.toolFinished.add(id);
      // Wie oft die Rechte des Programms verweigert haben: nur zählen, nie den Text (Regel 8).
      if (status === 'failed') this.denied += 1;
      events.push({ type: 'tool_result', id, error: status === 'failed' });
    }
    // `item.updated` ohne Abschluss oder `item.started` auf einen laufenden Eintrag: nichts weiter.
    if (!finished && lineType !== 'item.started') this.toolStarted.delete(id);
    return events;
  }

  /**
   * Das Ergebnis am Ende des Stroms. Der Endtext kommt aus der Datei hinter `--output-last-message`
   * (letzte Nachricht des Agenten), die der Lauf beim Beenden übergibt; Pagewise liest sie einmal und löscht
   * sie mit dem Lauf-Ordner. Ein Fehler ist auch dann ein Fehler, wenn das Programm mit Exit-Code 0 endet.
   */
  finalize(end: RunEnd, lastMessage: string): AgentEvent[] {
    // Nie gestartet (Binary fehlt): kein Ergebnis, wie bei engine.ts — der Lauf ist schlicht gescheitert.
    if (end.reason === 'spawn_failed') return [];
    // Die letzte Nachricht gilt als Antwort, wenn der Strom selbst keinen Text brachte.
    const clean = lastMessage.trim();
    if (clean && !this.sawText) {
      this.sawText = true;
      this.text = clean;
    }
    // Ein Lauf, dessen Turn fehlschlug oder dessen Dateiänderung verweigert wurde und der nichts
    // antwortete, ist kein Erfolg.
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
        // Ob eine Sitzung fortsetzbar ist, meldet der JSONL-Strom nicht: nicht behaupten.
        resumeFailed: false,
      },
    ];
  }
}

/**
 * Startet `codex exec` im Arbeitsordner eines Fachs: eigener Lauf-Ordner im Datenverzeichnis, leeres
 * `CODEX_HOME` (Safe-Modus ohne Rechner-Einstellungen), Allowlist-Umgebung, Auftrag über stdin, Grenzen und
 * gestuftes Beenden wie beim Vorbild `engine.ts` und `opencode.ts`.
 */
export class CodexEngine {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: EngineOptions) {
    this.env = options.env ?? process.env;
  }

  start(input: AgentStartInput): AgentRun {
    // Die Sandbox vergleicht echte Pfade (auf macOS ist /var ein Verweis auf /private/var), das Programm
    // meldet sie auch so: Regeln und Anzeige müssen von Anfang an mit dem aufgelösten Pfad arbeiten.
    const workspace = realpathSync(input.workspace);
    const runDir = join(this.options.dataRoot, 'engine', 'runs', randomUUID());
    mkdirSync(join(runDir, 'home'), { recursive: true, mode: 0o700 });
    const cleanup = () => rmSync(runDir, { recursive: true, force: true });

    let run: ProcessRun;
    try {
      const lastMessageFile = join(runDir, 'letzte-nachricht.txt');
      const codexHome = join(runDir, 'home');
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        '--sandbox',
        'workspace-write',
        '--output-last-message',
        lastMessageFile,
        '-',
      ];
      if (input.model) args.push('--model', input.model);

      const env = {
        ...buildCodexEnv({
          cliDir: dirname(input.cliPath),
          source: this.env,
          codexHome,
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
        // Erst SIGINT, dann SIGTERM, dann SIGKILL — an die ganze Prozessgruppe.
        escalation: ['SIGINT', 'SIGTERM', 'SIGKILL'],
        killGraceMs: 4_000,
      });
    } catch (error) {
      cleanup();
      throw error;
    }

    const parser = new CodexStreamParser(workspace);
    // Das Ergebnis entsteht im Ereignis-Strom (finalize): Er muss gelesen sein, bevor `finished` es meldet.
    let markStreamDone = () => {};
    let sawResult = false;
    const events = (async function* (): AsyncGenerator<AgentEvent> {
      try {
        for await (const line of run.lines) {
          for (const event of parser.parse(line)) yield event;
        }
        const lastMessage = readIfExists(join(runDir, 'letzte-nachricht.txt'));
        for (const event of parser.finalize(await run.ended, lastMessage)) {
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

/** Liest eine Datei, wenn sie da ist; sonst leerer Text (das Programm muss sie nicht anlegen). */
function readIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
