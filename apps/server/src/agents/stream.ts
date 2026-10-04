/**
 * Liest die Ausgabe von `claude -p --output-format stream-json --verbose --include-partial-messages`
 * (eine JSON-Zeile je Ereignis) und macht daraus wenige, eigene Ereignisse. Alles Unbekannte wird stillschweigend
 * übersprungen: Claude Code kennt viele weitere Ereignisse (Hooks, Aufgaben, Hintergrundmeldungen), die für
 * Pagewise keine Rolle spielen. Das Format wurde mit Claude Code 2.1.220 gemessen (siehe docs/agent-cli.md).
 *
 * Wichtig:
 * - Die Ausgabe ist nicht vertrauenswürdig: Text kommt nur als Text weiter, nie als Befehl oder HTML.
 * - Fehlertexte des Modells oder Anbieters werden nie weitergegeben (sie können Eingaben oder Zugangsdaten
 *   wiederholen). Es kommen nur Fehlercodes heraus.
 * - Der Fehlerzustand steht im `result`-Ereignis (`is_error`), nicht im `subtype` (der bleibt auch bei Fehlern
 *   „success“).
 */

export type AgentErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'no_package'
  | 'quota_exhausted'
  | 'plan_expired'
  | 'model_not_allowed'
  | 'model_not_found'
  | 'content_blocked'
  | 'upstream_error'
  | 'agent_failed'
  | 'agent_limit';

export type AgentEvent =
  /** Start der Sitzung (erstes Ereignis). */
  | { type: 'session'; sessionId: string; model: string | null }
  /** Text der Antwort in Stücken (nur vom Hauptagenten). */
  | { type: 'text'; text: string }
  /** Eine neue Nachricht des Modells beginnt (zwischen zwei Werkzeugaufrufen): im Text ein Absatz. */
  | { type: 'break' }
  | { type: 'thinking' }
  /** Das Modell ruft ein Werkzeug auf. `target` ist ein kurzer Hinweis (Datei oder Befehl), keine Inhalte. */
  | { type: 'tool'; id: string; name: string; target: string | null }
  | { type: 'tool_result'; id: string; error: boolean }
  | { type: 'retry'; attempt: number; max: number }
  | {
      type: 'result';
      ok: boolean;
      /** Endtext der Antwort (bei Erfolg). Bei einem Fehler nie der Text des Programms. */
      text: string;
      code: AgentErrorCode | null;
      turns: number | null;
      durationMs: number | null;
      /** Wie viele Zugriffe die Rechte des Programms verweigert haben (Anzahl, nie Inhalte). */
      denied: number;
    };

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Fehlernummern von Z.ai, die im Fehlertext des Programms vorkommen können (Quelle: docs.z.ai/api-reference/api-code). */
const NUMBERS: Readonly<Record<string, AgentErrorCode>> = {
  '1113': 'no_package',
  '1211': 'model_not_found',
  '1301': 'content_blocked',
  '1308': 'quota_exhausted',
  '1309': 'plan_expired',
  '1310': 'quota_exhausted',
  '1311': 'model_not_allowed',
};

const BY_ASSISTANT_ERROR: Readonly<Record<string, AgentErrorCode>> = {
  authentication_failed: 'auth_failed',
  billing_error: 'insufficient_credits',
  rate_limit: 'rate_limited',
  model_not_found: 'model_not_found',
  server_error: 'upstream_error',
  invalid_request: 'agent_failed',
  unknown: 'agent_failed',
};

const BY_HTTP: Readonly<Record<number, AgentErrorCode>> = {
  401: 'auth_failed',
  403: 'auth_failed',
  402: 'insufficient_credits',
  404: 'model_not_found',
  408: 'upstream_error',
  429: 'rate_limited',
  500: 'upstream_error',
  502: 'upstream_error',
  503: 'upstream_error',
  504: 'upstream_error',
  529: 'upstream_error',
};

const BY_TERMINAL: Readonly<Record<string, AgentErrorCode>> = {
  budget_exhausted: 'agent_limit',
  max_turns: 'agent_limit',
  turn_setup_failed: 'agent_failed',
};

/** Kürzt und bereinigt einen Hinweis zur Anzeige: ohne Steuerzeichen, höchstens `max` Zeichen. */
function shorten(text: string, max = 120): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return [...clean].length > max ? `${[...clean].slice(0, max - 1).join('')}…` : clean;
}

/** Kurzer Hinweis, was ein Werkzeug anfasst: Datei bei Dateiwerkzeugen, der Anfang des Befehls bei Bash. */
export function toolTarget(name: string, input: unknown, workspace: string | null): string | null {
  if (!isRecord(input)) return null;
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (path !== null) {
    const relative =
      workspace && path.startsWith(`${workspace}/`) ? path.slice(workspace.length + 1) : path;
    return shorten(relative);
  }
  if (name === 'Bash') return shorten(str(input.description) ?? str(input.command) ?? '') || null;
  const pattern = str(input.pattern);
  return pattern === null ? null : shorten(pattern);
}

/**
 * Zustand beim Lesen eines Laufs. Ein Parser gehört zu genau einem Lauf: Er merkt sich die Fehlerart der
 * letzten Antwort (steht im `assistant`-Ereignis, das dem `result` vorausgeht) und die Sitzung.
 */
export class AgentStreamParser {
  private assistantError: string | null = null;
  private retries: { status: number | null } | null = null;
  private seenText = false;

  constructor(private readonly workspace: string | null = null) {}

  /** Verarbeitet eine Zeile. Kein JSON oder unbekannt: keine Ereignisse. */
  parse(line: string): AgentEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isRecord(json)) return [];
    const type = str(json.type);

    if (type === 'system') return this.system(json);
    if (type === 'stream_event') return this.streamEvent(json);
    if (type === 'assistant') return this.assistant(json);
    if (type === 'user') return this.user(json);
    if (type === 'result') return this.result(json);
    return [];
  }

  private system(json: Json): AgentEvent[] {
    const subtype = str(json.subtype);
    if (subtype === 'init') {
      const sessionId = str(json.session_id);
      return sessionId ? [{ type: 'session', sessionId, model: str(json.model) }] : [];
    }
    if (subtype === 'api_retry') {
      const status = num(json.error_status);
      this.retries = { status };
      return [{ type: 'retry', attempt: num(json.attempt) ?? 1, max: num(json.max_retries) ?? 1 }];
    }
    return [];
  }

  private streamEvent(json: Json): AgentEvent[] {
    // Ereignisse von Unteragenten (parent_tool_use_id gesetzt) gehören nicht in die Antwort.
    if (json.parent_tool_use_id !== null && json.parent_tool_use_id !== undefined) return [];
    const event = json.event;
    if (!isRecord(event)) return [];
    const type = str(event.type);
    if (type === 'message_start') {
      const events: AgentEvent[] = this.seenText ? [{ type: 'break' }] : [];
      return events;
    }
    if (type === 'content_block_start') {
      const block = event.content_block;
      if (isRecord(block) && block.type === 'thinking') return [{ type: 'thinking' }];
      return [];
    }
    if (type === 'content_block_delta') {
      const delta = event.delta;
      if (!isRecord(delta)) return [];
      if (delta.type === 'text_delta') {
        const text = str(delta.text);
        if (text) {
          this.seenText = true;
          return [{ type: 'text', text }];
        }
      } else if (delta.type === 'thinking_delta') {
        return [{ type: 'thinking' }];
      }
    }
    return [];
  }

  private assistant(json: Json): AgentEvent[] {
    if (json.parent_tool_use_id !== null && json.parent_tool_use_id !== undefined) return [];
    const error = str(json.error);
    if (error) this.assistantError = error;
    const message = json.message;
    if (!isRecord(message) || !Array.isArray(message.content)) return [];
    const events: AgentEvent[] = [];
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue;
      const id = str(block.id);
      const name = str(block.name);
      if (id && name) {
        events.push({
          type: 'tool',
          id,
          name,
          target: toolTarget(name, block.input, this.workspace),
        });
      }
    }
    return events;
  }

  private user(json: Json): AgentEvent[] {
    if (json.parent_tool_use_id !== null && json.parent_tool_use_id !== undefined) return [];
    const message = json.message;
    if (!isRecord(message) || !Array.isArray(message.content)) return [];
    const events: AgentEvent[] = [];
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      const id = str(block.tool_use_id);
      // Der Inhalt des Ergebnisses wird nie weitergegeben.
      if (id) events.push({ type: 'tool_result', id, error: block.is_error === true });
    }
    return events;
  }

  private result(json: Json): AgentEvent[] {
    const failed = json.is_error === true;
    const text = str(json.result) ?? '';
    return [
      {
        type: 'result',
        ok: !failed,
        // Bei einem Fehler ist `result` der Fehlertext des Programms: nie weitergeben.
        text: failed ? '' : text,
        code: failed ? this.classify(json, text) : null,
        turns: num(json.num_turns),
        durationMs: num(json.duration_ms),
        denied: Array.isArray(json.permission_denials) ? json.permission_denials.length : 0,
      },
    ];
  }

  /**
   * Ordnet einen Fehler einem Code zu, in dieser Reihenfolge: bekannte Z.ai-Nummer im Text, HTTP-Status,
   * Art des Fehlers der Antwort, Grund des Endes. Vom Text selbst kommt nur die Nummer heraus.
   */
  private classify(json: Json, text: string): AgentErrorCode {
    for (const match of text.matchAll(/\b(1[0-9]{3})\b/g)) {
      const code = NUMBERS[match[1] ?? ''];
      if (code) return code;
    }
    const status = num(json.api_error_status) ?? this.retries?.status ?? null;
    if (status !== null) {
      const byStatus = BY_HTTP[status];
      if (byStatus) return byStatus;
      if (status >= 500) return 'upstream_error';
    }
    if (this.assistantError && BY_ASSISTANT_ERROR[this.assistantError]) {
      return BY_ASSISTANT_ERROR[this.assistantError] ?? 'agent_failed';
    }
    const terminal = str(json.terminal_reason);
    if (terminal && BY_TERMINAL[terminal]) return BY_TERMINAL[terminal] ?? 'agent_failed';
    const subtype = str(json.subtype);
    if (subtype === 'error_max_turns' || subtype === 'error_max_budget_usd') return 'agent_limit';
    return 'agent_failed';
  }
}
