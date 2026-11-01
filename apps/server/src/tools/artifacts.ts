import type { RenderError, Result } from '@pagewise/render';
import { parseDocumentSpec } from '@pagewise/render/document';
import { parseSlidesSpec } from '@pagewise/render/slides';
import { z } from 'zod';
import { type ArtifactKind, MAX_ARTIFACTS_PER_REPLY } from '../artifacts/service';
import { type ToolContext, type ToolDefinition, ToolError } from './registry';

/**
 * Datei-Werkzeuge (D-074): Das Modell beschreibt ein Dokument oder eine Präsentation als JSON, Pagewise prüft
 * es mit denselben Prüfern wie die Blöcke im Chat und legt die geprüfte Spezifikation an die Antwort. Die
 * Datei entsteht erst in der Oberfläche beim Anzeigen und Herunterladen. Diese Werkzeuge schreiben nur in
 * Pagewises eigenen Speicher (Tabelle `artifacts`), nie in Daten der Person.
 */

/** Größte Argumentzeichenfolge: die Spezifikation darf 16.384 Zeichen haben, dazu kommt Maskierung. */
const MAX_FILE_ARGUMENT_CHARACTERS = 24_576;

const Spec = z.record(z.string(), z.unknown());
type SpecArgs = z.infer<typeof Spec>;

const available = (context: ToolContext) => context.artifacts !== undefined;

/** Titel für die Anzeige am Werkzeugaufruf: kurz, ohne Steuerzeichen. Kein Inhalt der Datei. */
function titleOf(args: SpecArgs): string | null {
  const title = args.title;
  if (typeof title !== 'string') return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst entfernt.
  const clean = title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, 80);
}

function parseError(error: RenderError): ToolError {
  // Der Hinweis ist nur ein Feldname oder Zeichencodes, nie Text aus der Eingabe (siehe `RenderError`).
  return new ToolError(error.detail ? `${error.code}: ${error.detail}` : error.code);
}

function store<T extends { title: string }>(
  kind: ArtifactKind,
  args: SpecArgs,
  context: ToolContext,
  parse: (source: string) => Result<T>,
) {
  if (!context.artifacts) throw new ToolError('unavailable');
  if (context.budget.files >= MAX_ARTIFACTS_PER_REPLY) throw new ToolError('too_many_files');
  const parsed = parse(JSON.stringify(args));
  if (!parsed.ok) throw parseError(parsed.error);
  const created = context.artifacts.create(kind, parsed.value.title, JSON.stringify(parsed.value));
  if (!created) throw new ToolError('chat_full');
  context.budget.files += 1;
  return {
    ok: true,
    id: created.id,
    kind,
    title: parsed.value.title,
    note: 'Die Datei steht unter deiner Antwort mit Vorschau und Download. Nenne sie in einem Satz und wiederhole ihren Inhalt nicht.',
  };
}

export const createDocument: ToolDefinition<SpecArgs> = {
  name: 'create_document',
  description:
    'Legt ein Dokument an, das die Person als PDF herunterladen kann (Arbeitsblatt, Zusammenfassung, Lernzettel). Nutze es nur, wenn die Person eine Datei oder ein Blatt möchte. Aufbau wie der Block "document".',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titel des Dokuments (bis 120 Zeichen).' },
      parts: {
        type: 'array',
        description: 'Abschnitte in der Reihenfolge der Seite (höchstens 60).',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['heading', 'paragraph', 'list'] },
            text: { type: 'string', description: 'Text einer Überschrift oder eines Absatzes.' },
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'Punkte einer Liste (höchstens 30).',
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['title', 'parts'],
  },
  schema: Spec,
  maxArgumentCharacters: MAX_FILE_ARGUMENT_CHARACTERS,
  target: titleOf,
  available,
  run: (args, context) => store('document', args, context, parseDocumentSpec),
};

export const createPresentation: ToolDefinition<SpecArgs> = {
  name: 'create_presentation',
  description:
    'Legt eine Präsentation an, die die Person als PowerPoint herunterladen kann (Referat, Vortrag). Nutze es nur, wenn die Person Folien möchte. Aufbau wie der Block "slides".',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titel der Präsentation.' },
      slides: {
        type: 'array',
        description: 'Folien in der Reihenfolge (höchstens 20).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            bullets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Stichpunkte (höchstens 6, je 120 Zeichen).',
            },
            text: { type: 'string', description: 'Ein kurzer Absatz (bis 500 Zeichen).' },
          },
          required: ['title'],
        },
      },
    },
    required: ['title', 'slides'],
  },
  schema: Spec,
  maxArgumentCharacters: MAX_FILE_ARGUMENT_CHARACTERS,
  target: titleOf,
  available,
  run: (args, context) => store('slides', args, context, parseSlidesSpec),
};
