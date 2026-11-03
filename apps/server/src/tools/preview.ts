import { z } from 'zod';
import { type ToolContext, type ToolDefinition, ToolError } from './registry';

/**
 * `preview_file` (D-080, Stufe 3b): Das Modell sieht sich eine Datei an, die es mit `run_python` erzeugt hat. Pagewise
 * rendert die ersten Seiten (LibreOffice und poppler in der Sandbox) und schickt sie als Bilder an dasselbe
 * Modell, damit es Layout, abgeschnittene Texte und Überlappungen prüfen und das Skript korrigieren kann.
 *
 * Das Werkzeug wird nur angeboten, wenn das Modell Bilder versteht, der Bilder-Schalter des Anbieters an ist
 * (D-033), Code-Ausführung freigegeben ist und LibreOffice sowie poppler gefunden wurden. Die Bilder gehen nur an
 * dieses Modell in dieser Antwort, nie an einen anderen Anbieter, und werden nicht gespeichert.
 */

/** Höchstzahl der Vorschauen je Antwort. */
export const MAX_PREVIEWS_PER_REPLY = 4;
const MAX_PAGES = 6;
const DEFAULT_PAGES = 3;

const Args = z.strictObject({
  file: z.string().min(1).max(100),
  pages: z.number().int().min(1).max(MAX_PAGES).optional(),
});
type PreviewArgs = z.infer<typeof Args>;

/** Dateiname für die Anzeige am Werkzeugaufruf: ohne Steuerzeichen, gekürzt. */
function targetOf(args: PreviewArgs): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = args.file.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, 80);
}

export const previewFile: ToolDefinition<PreviewArgs> = {
  name: 'preview_file',
  description:
    'Sieht sich eine Datei an, die du mit run_python im Hauptordner erzeugt hast (pptx, docx, xlsx, pdf, odp, odt, ods). Pagewise rendert die ersten Seiten und schickt sie dir als Bilder in der nächsten Nachricht. Nutze es zum Prüfen von Layout, Lesbarkeit, abgeschnittenen oder überlappenden Texten und leeren Seiten, bevor du der Person die Datei übergibst. Höchstens 4 Vorschauen je Antwort.',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Name der Datei im Hauptordner, zum Beispiel "folien.pptx" (kein Pfad).',
      },
      pages: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGES,
        description: `Wie viele Seiten ab der ersten (Standard ${DEFAULT_PAGES}, höchstens ${MAX_PAGES}).`,
      },
    },
    required: ['file'],
  },
  schema: Args,
  target: targetOf,
  available: (context: ToolContext) =>
    context.preview !== undefined && context.images !== undefined,
  run: async (args, context) => {
    if (!context.preview || !context.images) throw new ToolError('unavailable');
    if (context.budget.previews >= MAX_PREVIEWS_PER_REPLY) throw new ToolError('too_many_previews');
    context.budget.previews += 1;
    const result = await context.preview.render({
      file: args.file,
      pages: args.pages ?? DEFAULT_PAGES,
      signal: context.signal,
    });
    for (const page of result.pages) {
      context.images.push({ label: `${args.file}, Seite ${page.number}`, base64: page.base64 });
    }
    return {
      ok: true,
      file: args.file,
      pages_total: result.pagesTotal,
      pages_shown: result.pages.map((page) => page.number),
      note: 'Die Bilder der Seiten folgen in der nächsten Nachricht.',
    };
  },
};
