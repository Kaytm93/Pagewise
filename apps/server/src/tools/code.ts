import { z } from 'zod';
import {
  MAX_OUTPUT_CHARACTERS,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from './registry';

/**
 * `run_python` (D-079): Das Modell schreibt ein Python-Skript, Pagewise führt es in einer Sandbox auf dem eigenen
 * Rechner aus, und neue Dateien im Arbeitsordner werden Dateien der Antwort. Das Skript ist Text des Modells und
 * nicht vertrauenswürdig: Es läuft ohne Netz, ohne Zugriff auf das Datenverzeichnis und ohne Schlüssel. Seine
 * Ausgabe geht als Daten zurück, nie als Anweisung. Weder Skript noch Ausgabe stehen in Logs oder Fehlermeldungen.
 */

/** Höchstzahl der Läufe je Antwort. */
export const MAX_CODE_RUNS_PER_REPLY = 8;
/** Größte Argumentzeichenfolge: das Skript darf 24.000 Zeichen haben, dazu kommt die Maskierung. */
const MAX_CODE_ARGUMENT_CHARACTERS = 49_152;
const MAX_SCRIPT_CHARACTERS = 24_000;

const Args = z.strictObject({
  code: z.string().min(1).max(MAX_SCRIPT_CHARACTERS),
  purpose: z.string().max(120).optional(),
});
type CodeArgs = z.infer<typeof Args>;

/** Kurzer Zweck für die Anzeige am Werkzeugaufruf: ohne Steuerzeichen, gekürzt. */
function purposeOf(args: CodeArgs): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = (args.purpose ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, 80);
}

const clip = (text: string, limit: number, keepEnd: boolean): string =>
  text.length <= limit ? text : keepEnd ? text.slice(text.length - limit) : text.slice(0, limit);

export const runPython: ToolDefinition<CodeArgs> = {
  name: 'run_python',
  description:
    'Führt ein Python-Skript auf dem Rechner der Person aus, in einer abgeschlossenen Umgebung ohne Netz. Gedacht für Dateien mit freiem Aufbau (PowerPoint mit python-pptx, Word mit python-docx, Excel mit openpyxl oder XlsxWriter, PDF mit reportlab, Diagramme mit matplotlib als PNG oder SVG). Neue Dateien im Hauptordner (pptx, docx, xlsx, pdf, png, svg, csv, txt, md) erscheinen unter deiner Antwort. Der Ordner bleibt im Chat erhalten, spätere Aufrufe können darauf aufbauen. Ausgabe und Fehlermeldungen des Skripts kommen als Daten zurück.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Das vollständige Python-Skript (Python 3.13, bis 24.000 Zeichen).',
      },
      purpose: {
        type: 'string',
        description: 'Ein kurzer Satz, was das Skript tut (wird der Person angezeigt).',
      },
    },
    required: ['code'],
  },
  schema: Args,
  maxArgumentCharacters: MAX_CODE_ARGUMENT_CHARACTERS,
  target: purposeOf,
  available: (context: ToolContext) => context.code !== undefined,
  run: async (args, context) => {
    if (!context.code) throw new ToolError('unavailable');
    if (context.budget.codeRuns >= MAX_CODE_RUNS_PER_REPLY) throw new ToolError('too_many_runs');
    context.budget.codeRuns += 1;
    const result = await context.code.run({
      script: args.code,
      purpose: purposeOf(args),
      signal: context.signal,
    });
    if (!result) throw new ToolError('chat_full');
    // Die Registry lehnt Ausgaben über der Grenze ab: Der Text wird so lange gekürzt, bis alles passt.
    let keep = 3_000;
    for (;;) {
      const body = {
        ok: result.outcome === 'ok',
        outcome: result.outcome,
        exit_code: result.exitCode,
        seconds: Math.round(result.durationMs / 100) / 10,
        stdout: clip(result.stdout, keep, false),
        stderr: clip(result.stderr, keep, true),
        output_truncated:
          result.truncated || result.stdout.length > keep || result.stderr.length > keep,
        files: result.files.slice(0, 20),
      };
      if (JSON.stringify(body).length <= MAX_OUTPUT_CHARACTERS - 200 || keep <= 200) return body;
      keep = Math.floor(keep / 2);
    }
  },
};
