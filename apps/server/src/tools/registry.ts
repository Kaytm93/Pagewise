import type { z } from 'zod';
import type { Db } from '../db/client';
import type { WebSearch } from '../search/types';

/**
 * Werkzeuge, die ein Modell im Chat aufrufen kann (Tool Calling). Das Register ist allgemein gehalten, weil
 * auch der Agent-Modus für API-Modelle (Phase 3) es nutzt. Regeln, die hier erzwungen werden:
 *
 * - Die Argumente stammen vom Modell und sind nicht vertrauenswürdig: Sie werden als JSON gelesen (nie `eval`),
 *   in der Größe begrenzt und gegen ein striktes Schema geprüft, bevor ein Werkzeug läuft.
 * - Werkzeuge lesen nur. Ein Werkzeug, das etwas ändert, braucht eine eigene Entscheidung (D-044).
 * - Die Ausgabe ist begrenzt (Zeichen) und wird dem Modell als Daten übergeben, nie als Anweisung.
 * - Weder Argumente noch Ergebnisse stehen in Logs oder Fehlermeldungen; nach außen gehen nur Name, ein kurzer
 *   Hinweis zum Ziel (zum Beispiel ein Wochentag) und der Zustand.
 */

/** Zähler je Antwort: Was ein Werkzeug in dieser Antwort schon getan hat. */
export interface ToolBudget {
  webSearches: number;
}

export interface ToolContext {
  db: Db;
  /** Aktuelle Zeit; in Tests fest. */
  now: () => Date;
  /** Bricht Werkzeuge mit Netzzugriff ab, wenn die Person „Stopp“ drückt. */
  signal?: AbortSignal;
  /** Websuche. Ohne Angabe ist `web_search` nicht verfügbar. */
  web?: WebSearch;
  /** Zähler dieser Antwort über alle Runden hinweg. */
  budget: ToolBudget;
}

export interface ToolDefinition<Args = unknown> {
  name: string;
  /** Beschreibung für das Modell. */
  description: string;
  /** JSON-Schema der Argumente (OpenAI-Format). */
  parameters: Record<string, unknown>;
  /** Strenge Prüfung der Argumente. Unbekannte Felder werden abgelehnt. */
  schema: z.ZodType<Args>;
  /** Kurzer Hinweis für die Oberfläche („Montag“), nie Inhalte. */
  target: (args: Args) => string | null;
  /** Ob das Werkzeug gerade angeboten wird (zum Beispiel nur mit gespeichertem Schlüssel). Ohne Angabe immer. */
  available?: (context: ToolContext) => boolean | Promise<boolean>;
  /**
   * Führt das Werkzeug aus. Gibt reine Daten (JSON) zurück. Ein Fehler mit kurzem Code wird als `ToolError`
   * geworfen; jede andere Ausnahme wird zu `failed`.
   */
  run: (args: Args, context: ToolContext) => unknown | Promise<unknown>;
}

/** Ein Fehler mit kurzem Code, den das Modell lesen darf. Die Meldung selbst bleibt intern und landet nie im Chat. */
export class ToolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ToolError';
  }
}

/** Angabe eines Werkzeugs für die Anfrage an den Anbieter. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolOutcome =
  | { ok: true; content: string; target: string | null }
  | {
      ok: false;
      code: 'unknown_tool' | 'invalid_arguments' | 'failed';
      content: string;
      /** Auch bei Fehlern: Ein Werkzeug, das schon etwas nach außen geschickt hat, nennt, was es war. */
      target: string | null;
    };

/** Größte Argumentzeichenfolge, die ein Modell schicken darf. */
export const MAX_ARGUMENT_CHARACTERS = 4_096;
/** Größte Ausgabe eines Werkzeugs in Zeichen. Mehr geht nicht an das Modell. */
export const MAX_OUTPUT_CHARACTERS = 12_000;

const errorContent = (code: string) => JSON.stringify({ error: code });

/** Kürzt eine Liste von Einträgen, bis die Ausgabe in die Grenze passt, und vermerkt die Kürzung. */
export function limitList<T>(
  build: (items: T[], truncated: boolean) => unknown,
  items: T[],
  limit = MAX_OUTPUT_CHARACTERS,
): string {
  let count = items.length;
  for (;;) {
    const text = JSON.stringify(build(items.slice(0, count), count < items.length));
    if (text.length <= limit || count <= 1) {
      return text.length <= limit ? text : JSON.stringify(build([], true));
    }
    count = Math.max(1, Math.floor(count * 0.7));
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<Args>(tool: ToolDefinition<Args>): this {
    if (this.tools.has(tool.name)) throw new Error(`Werkzeug doppelt: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolDefinition);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Die Werkzeuge für eine Anfrage, die gerade verfügbar sind, in der Reihenfolge der Anmeldung. */
  async specs(context: ToolContext): Promise<ToolSpec[]> {
    const offered: ToolSpec[] = [];
    for (const tool of this.tools.values()) {
      if (tool.available && !(await tool.available(context))) continue;
      offered.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
    }
    return offered;
  }

  /**
   * Führt einen Aufruf des Modells aus. Fehler (unbekanntes Werkzeug, ungültige Argumente, Ausnahme im
   * Werkzeug) werden zu einem Ergebnis mit Fehlercode, das das Modell lesen kann; sie brechen den Chat nicht ab
   * und enthalten nie Eingaben.
   */
  async execute(name: string, rawArguments: string, context: ToolContext): Promise<ToolOutcome> {
    const tool = this.tools.get(name);
    if (!tool || (tool.available && !(await tool.available(context)))) {
      return {
        ok: false,
        code: 'unknown_tool',
        content: errorContent('unknown_tool'),
        target: null,
      };
    }
    const invalid: ToolOutcome = {
      ok: false,
      code: 'invalid_arguments',
      content: errorContent('invalid_arguments'),
      target: null,
    };
    if (rawArguments.length > MAX_ARGUMENT_CHARACTERS) return invalid;
    let input: unknown = {};
    if (rawArguments.trim() !== '') {
      try {
        input = JSON.parse(rawArguments);
      } catch {
        return invalid;
      }
    }
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) return invalid;
    const target = tool.target(parsed.data);
    try {
      const content = JSON.stringify(await tool.run(parsed.data, context));
      if (content.length > MAX_OUTPUT_CHARACTERS) {
        return {
          ok: false,
          code: 'failed',
          content: errorContent('output_too_large'),
          target,
        };
      }
      return { ok: true, content, target };
    } catch (error) {
      const code = error instanceof ToolError ? error.code : 'failed';
      return { ok: false, code: 'failed', content: errorContent(code), target };
    }
  }
}
