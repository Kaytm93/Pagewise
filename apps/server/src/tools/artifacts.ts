import type { RenderError, Result } from '@pagewise/render';
import { parseDocumentSpec } from '@pagewise/render/document';
import { parseFigureArtifact } from '@pagewise/render/figure';
import { parseSheetSpec } from '@pagewise/render/sheet';
import { parseSlidesSpec } from '@pagewise/render/slides';
import {
  validateDocumentFigures,
  validateFigureArtifact,
  validateSlidesFigures,
} from '@pagewise/render/validate';
import { z } from 'zod';
import { type ArtifactKind, MAX_ARTIFACTS_PER_REPLY } from '../artifacts/service';
import { type ToolContext, type ToolDefinition, ToolError } from './registry';

/**
 * Datei-Werkzeuge (D-074): Das Modell beschreibt ein Dokument oder eine Präsentation als JSON, Pagewise prüft
 * es mit denselben Prüfern wie die Blöcke im Chat und legt die geprüfte Spezifikation an die Antwort. Die
 * Datei entsteht erst in der Oberfläche beim Anzeigen und Herunterladen. Diese Werkzeuge schreiben nur in
 * Pagewises eigenen Speicher (Tabelle `artifacts`), nie in Daten der Person.
 */

/** Größte Argumentzeichenfolge: die Spezifikation darf 24.576 Zeichen haben, dazu kommt Maskierung. */
const MAX_FILE_ARGUMENT_CHARACTERS = 32_768;

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

async function store<T extends { title: string }>(
  kind: ArtifactKind,
  args: SpecArgs,
  context: ToolContext,
  parse: (source: string) => Result<T>,
  /** Prüft Abbildungen so tief wie das Zeichnen (SMILES, Noten); der erste Fehler zählt. */
  deep: (spec: T) => Promise<RenderError | null>,
) {
  if (!context.artifacts) throw new ToolError('unavailable');
  if (context.budget.files >= MAX_ARTIFACTS_PER_REPLY) throw new ToolError('too_many_files');
  const parsed = parse(JSON.stringify(args));
  if (!parsed.ok) throw parseError(parsed.error);
  const deepError = await deep(parsed.value);
  if (deepError) throw parseError(deepError);
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

/** Felder einer Abbildung (Graph, Molekül, Noten); gleich für Dokumente und Folien. */
const FIGURE_PROPERTIES = {
  graph: {
    type: 'object',
    description:
      'Funktionsgraph: {"functions":["x^2-4"],"x":[-4,4],"y":[-6,6],"points":[{"x":2,"y":0,"label":"N"}]}. Ausdrücke nur mit x, Zahlen, + - * / ^, Klammern, sin, cos, tan, sqrt, abs, ln, log, exp, pi, e.',
  },
  formula: {
    type: 'string',
    description: 'Summenformel eines Schulmoleküls, zum Beispiel H2O, CO2, CH4, NH3.',
  },
  smiles: {
    type: 'string',
    description:
      'SMILES eines organischen Stoffs, zum Beispiel CCO. Die App zeichnet die Skelettformel.',
  },
  abc: {
    type: 'string',
    description: 'Noten in ABC-Notation mit den Zeilen X:, M:, L: und K:.',
  },
  chart: {
    type: 'object',
    description:
      'Diagramm: {"type":"bar"|"line"|"pie","categories":["Mo","Di"],"series":[{"name":"Regen","values":[3,5]}],"unit":"mm"}. Kreis: genau eine Reihe, Werte nicht negativ. Höchstens 24 Rubriken und 4 Reihen.',
  },
  caption: { type: 'string', description: 'Bildunterschrift (kurz).' },
} as const;

export const createDocument: ToolDefinition<SpecArgs> = {
  name: 'create_document',
  description:
    'Legt ein Dokument an, das die Person als PDF herunterladen kann (Arbeitsblatt, Zusammenfassung, Lernzettel). Nutze es nur, wenn die Person eine Datei oder ein Blatt möchte. Abschnitte: heading, paragraph, list, table sowie Abbildungen: graph (Funktionsgraph), molecule (Strukturformel), notes (Noten) und chart (Balken-, Linien- oder Kreisdiagramm). Die App zeichnet Abbildungen selbst, erfinde keine Koordinaten.',
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
            type: {
              type: 'string',
              enum: [
                'heading',
                'paragraph',
                'list',
                'table',
                'graph',
                'molecule',
                'notes',
                'chart',
              ],
            },
            text: { type: 'string', description: 'Text einer Überschrift oder eines Absatzes.' },
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'Punkte einer Liste (höchstens 30).',
            },
            header: {
              type: 'array',
              items: { type: 'string' },
              description: 'Kopfzeile einer Tabelle (gleich viele Zellen wie jede Zeile).',
            },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Zeilen einer Tabelle (höchstens 30 Zeilen mit je höchstens 6 Zellen).',
            },
            ...FIGURE_PROPERTIES,
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
  run: (args, context) =>
    store('document', args, context, parseDocumentSpec, validateDocumentFigures),
};

export const createPresentation: ToolDefinition<SpecArgs> = {
  name: 'create_presentation',
  description:
    'Legt eine Präsentation an, die die Person als PowerPoint herunterladen kann (Referat, Vortrag). Nutze es nur, wenn die Person Folien möchte. Eine Folie hat Titel, Stichpunkte, einen Absatz und höchstens eine Abbildung (figure): Funktionsgraph, Strukturformel, Noten oder Diagramm. Die App zeichnet Abbildungen selbst, erfinde keine Koordinaten.',
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
            figure: {
              type: 'object',
              description: 'Eine Abbildung für diese Folie.',
              properties: {
                type: { type: 'string', enum: ['graph', 'molecule', 'notes', 'chart'] },
                ...FIGURE_PROPERTIES,
              },
              required: ['type'],
            },
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
  run: (args, context) => store('slides', args, context, parseSlidesSpec, validateSlidesFigures),
};

export const createSpreadsheet: ToolDefinition<SpecArgs> = {
  name: 'create_spreadsheet',
  description:
    'Legt eine Tabellendatei an, die die Person als Excel (XLSX) oder CSV herunterladen kann (Notenliste, Vokabeltabelle, Messwerte). Nutze es nur, wenn die Person eine Tabelle als Datei möchte. Zellen sind Text oder Zahlen; Formeln gibt es nicht, rechne selbst.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titel der Datei (bis 120 Zeichen).' },
      sheets: {
        type: 'array',
        description: 'Blätter (höchstens 5).',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name des Blatts (bis 31 Zeichen, ohne [ ] : * ? / \\).',
            },
            header: {
              type: 'array',
              items: { type: 'string' },
              description: 'Kopfzeile (gleich viele Zellen wie jede Zeile).',
            },
            rows: {
              type: 'array',
              description: 'Zeilen (höchstens 200 mit je höchstens 12 Zellen).',
              items: { type: 'array', items: { type: ['string', 'number'] } },
            },
          },
          required: ['name', 'rows'],
        },
      },
    },
    required: ['title', 'sheets'],
  },
  schema: Spec,
  maxArgumentCharacters: MAX_FILE_ARGUMENT_CHARACTERS,
  target: titleOf,
  available,
  run: (args, context) => store('sheet', args, context, parseSheetSpec, async () => null),
};

export const createFigure: ToolDefinition<SpecArgs> = {
  name: 'create_figure',
  description:
    'Legt eine einzelne Abbildung als Datei an, die die Person als PNG oder SVG herunterladen kann: Funktionsgraph, Strukturformel, Noten oder Diagramm. Nutze es, wenn die Person die Zeichnung allein haben möchte (für ein Heft, eine Folie oder ein Blatt); für Dokumente und Folien setzt du Abbildungen direkt dort ein.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titel der Abbildung (bis 120 Zeichen).' },
      figure: {
        type: 'object',
        description: 'Die Abbildung.',
        properties: {
          type: { type: 'string', enum: ['graph', 'molecule', 'notes', 'chart'] },
          ...FIGURE_PROPERTIES,
        },
        required: ['type'],
      },
    },
    required: ['title', 'figure'],
  },
  schema: Spec,
  maxArgumentCharacters: MAX_FILE_ARGUMENT_CHARACTERS,
  target: titleOf,
  available,
  run: (args, context) =>
    store('figure', args, context, parseFigureArtifact, validateFigureArtifact),
};
