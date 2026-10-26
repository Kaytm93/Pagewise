import { fail, hasControlChars, LIMITS, ok, type RenderError, type Result } from './errors';

/** Ein Abschnitt des Dokuments: Überschrift, Absatz oder Aufzählung. */
export type DocumentPart =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export interface DocumentSpec {
  title: string;
  parts: DocumentPart[];
}

/** Obergrenzen je Feld, damit ein Dokument überschaubar bleibt und in eine Seitenfolge passt. */
const MAX = {
  title: 120,
  parts: 60,
  heading: 120,
  paragraph: 1_200,
  items: 30,
  // Ein Listenpunkt darf so lang sein wie ein Absatz: Das PDF bricht lange Punkte um.
  item: 1_200,
} as const;

/**
 * Zeichen, die die eingebaute PDF-Schrift (Helvetica, WinAnsi) darstellt: ASCII ohne Steuerzeichen, Latin-1
 * und die Zusatzzeichen von Windows-1252 (€, „, “, –, …).
 */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Hochgestellte Zeichen und ihr Grundzeichen (`⁺` ist `+`). Das PDF setzt sie klein und erhöht. */
export const SUPERSCRIPTS: ReadonlyMap<string, string> = new Map([
  ['⁰', '0'],
  ['¹', '1'],
  ['²', '2'],
  ['³', '3'],
  ['⁴', '4'],
  ['⁵', '5'],
  ['⁶', '6'],
  ['⁷', '7'],
  ['⁸', '8'],
  ['⁹', '9'],
  ['⁺', '+'],
  ['⁻', '-'],
]);

/** Tiefgestellte Zeichen und ihr Grundzeichen (`₂` ist `2`). Das PDF setzt sie klein und gesenkt. */
export const SUBSCRIPTS: ReadonlyMap<string, string> = new Map([
  ['₀', '0'],
  ['₁', '1'],
  ['₂', '2'],
  ['₃', '3'],
  ['₄', '4'],
  ['₅', '5'],
  ['₆', '6'],
  ['₇', '7'],
  ['₈', '8'],
  ['₉', '9'],
  ['₊', '+'],
  ['₋', '-'],
]);

/** Mathezeichen, die das PDF als eigene Zeichen setzt: Pfeil, Minus, Vergleich, ungefähr gleich. */
export const MATH_SIGNS: ReadonlySet<string> = new Set(['→', '−', '≤', '≥', '≈']);

/**
 * `true`, wenn jedes Zeichen im PDF vorkommt: Schrift, Hoch- und Tiefstellung oder Mathezeichen. Zeilenumbrüche
 * gehören nicht dazu.
 */
export function isPdfText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const known = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
    if (known || WIN_ANSI_EXTRA.has(code)) continue;
    if (SUPERSCRIPTS.has(char) || SUBSCRIPTS.has(char) || MATH_SIGNS.has(char)) continue;
    return false;
  }
  return true;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Geschützte Bindestriche (U+2010, U+2011): Modelle schreiben sie oft statt „-“, das PDF setzt sie nicht. */
const HYPHEN_LOOKALIKES = /[‐‑]/g;

/** Zeichencodes (U+XXXX) der ersten drei Zeichen, die das PDF nicht setzt. Nie Text aus der Eingabe. */
function unsupportedCodes(value: string): string {
  const found = new Set<string>();
  for (const char of value) {
    if (isPdfText(char)) continue;
    found.add(`U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`);
    if (found.size === 3) break;
  }
  return [...found].join(', ');
}

/**
 * Text für ein Feld: nicht leer, nicht zu lang, ohne Steuerzeichen. Geschützte Bindestriche werden zu „-“. Zeichen,
 * die das PDF nicht setzt, bekommen einen eigenen Fehlercode mit ihrem Zeichencode, damit das Modell
 * (Korrekturanfrage) ein einfacheres Zeichen wählt.
 */
function readText(value: unknown, max: number, field: 'text' | 'items' = 'text'): Result<string> {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > max ||
    hasControlChars(value) ||
    /[\r\n\t]/.test(value)
  ) {
    return fail('invalid_document', field);
  }
  const text = value.replace(HYPHEN_LOOKALIKES, '-');
  if (!isPdfText(text)) return fail('unsupported_text', unsupportedCodes(text));
  return ok(text);
}

function readPart(entry: unknown): Result<DocumentPart> {
  if (!isObject(entry) || typeof entry.type !== 'string') return fail('invalid_document', 'parts');
  if (entry.type === 'heading' || entry.type === 'paragraph') {
    if (!hasOnly(entry, ['type', 'text'])) return fail('invalid_document', 'parts');
    const max = entry.type === 'heading' ? MAX.heading : MAX.paragraph;
    const text = readText(entry.text, max);
    if (!text.ok) return text;
    return ok({ type: entry.type, text: text.value });
  }
  if (entry.type === 'list') {
    if (!hasOnly(entry, ['type', 'items'])) return fail('invalid_document', 'parts');
    const items = entry.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX.items) {
      return fail('invalid_document', 'items');
    }
    const texts: string[] = [];
    for (const item of items) {
      const text = readText(item, MAX.item, 'items');
      if (!text.ok) return text;
      texts.push(text.value);
    }
    return ok({ type: 'list', items: texts });
  }
  return fail('invalid_document', 'parts');
}

/**
 * Liest den Inhalt eines ` ```document `-Blocks (JSON): `title` und `parts`, eine Liste mit Abschnitten vom Typ
 * `heading` (Überschrift, `text`), `paragraph` (Absatz, `text`) oder `list` (Aufzählung, `items`). Unbekannte
 * Felder werden abgelehnt. Von Hand geprüft wie die anderen Blöcke, ohne Schema-Bibliothek.
 *
 * Fehler tragen als Hinweis nur den Namen des Feldes, nie Text aus der Eingabe.
 */
export function parseDocumentSpec(source: string): Result<DocumentSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.document) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json) || !hasOnly(json, ['title', 'parts'])) return fail('invalid_document');

  const title = readText(json.title, MAX.title);
  if (!title.ok) return title;

  const entries = json.parts;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX.parts) {
    return fail('invalid_document', 'parts');
  }
  const parts: DocumentPart[] = [];
  for (const entry of entries) {
    const part = readPart(entry);
    if (!part.ok) return part;
    parts.push(part.value);
  }
  return ok({ title: title.value, parts });
}

/** Prüft einen ` ```document `-Block, ohne ihn anzuzeigen. `null`, wenn er in Ordnung ist. */
export function validateDocument(source: string): RenderError | null {
  const spec = parseDocumentSpec(source);
  return spec.ok ? null : spec.error;
}
