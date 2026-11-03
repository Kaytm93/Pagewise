import { fail, hasControlChars, LIMITS, ok, type RenderError, type Result } from './errors';

/** Ein Blatt einer Tabellendatei: Name, optionale Kopfzeile und Zeilen mit Text oder Zahlen. */
export interface Sheet {
  name: string;
  header: string[] | undefined;
  rows: (string | number)[][];
}

export interface SheetSpec {
  title: string;
  sheets: Sheet[];
}

/** Obergrenzen: eine Tabelle für Schule und Alltag, keine Datenbank. */
const MAX = {
  title: 120,
  sheets: 5,
  name: 31,
  rows: 200,
  columns: 12,
  cell: 200,
} as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Excel erlaubt in Blattnamen diese Zeichen nicht: [ ] : * ? / \ */
const BAD_SHEET_NAME = /[[\]:*?/\\]/;

function readText(value: unknown, max: number): Result<string> {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    hasControlChars(value) ||
    /[\r\n\t]/.test(value)
  ) {
    return fail('invalid_sheet', 'text');
  }
  return ok(value);
}

function readRow(value: unknown, columns: number | null): Result<(string | number)[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX.columns) {
    return fail('invalid_sheet', 'rows');
  }
  if (columns !== null && value.length !== columns) return fail('invalid_sheet', 'rows');
  const cells: (string | number)[] = [];
  for (const cell of value) {
    if (typeof cell === 'number') {
      if (!Number.isFinite(cell) || Math.abs(cell) >= 1e15) return fail('invalid_sheet', 'number');
      cells.push(cell);
      continue;
    }
    const text = readText(cell, MAX.cell);
    if (!text.ok) return text;
    cells.push(text.value);
  }
  return ok(cells);
}

function readSheet(entry: unknown, taken: Set<string>): Result<Sheet> {
  if (!isObject(entry) || !hasOnly(entry, ['name', 'header', 'rows'])) {
    return fail('invalid_sheet', 'sheets');
  }
  const name = readText(entry.name, MAX.name);
  if (!name.ok) return name;
  const trimmed = name.value.trim();
  if (trimmed === '' || BAD_SHEET_NAME.test(trimmed) || trimmed.startsWith("'")) {
    return fail('invalid_sheet', 'name');
  }
  if (taken.has(trimmed.toLowerCase())) return fail('invalid_sheet', 'name');
  taken.add(trimmed.toLowerCase());

  const rows = entry.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX.rows) {
    return fail('invalid_sheet', 'rows');
  }
  const first = readRow(rows[0], null);
  if (!first.ok) return first;
  const columns = first.value.length;
  const table: (string | number)[][] = [first.value];
  for (const row of rows.slice(1)) {
    const read = readRow(row, columns);
    if (!read.ok) return read;
    table.push(read.value);
  }
  let header: string[] | undefined;
  if (entry.header !== undefined) {
    if (!Array.isArray(entry.header) || entry.header.length !== columns) {
      return fail('invalid_sheet', 'header');
    }
    header = [];
    for (const cell of entry.header) {
      const text = readText(cell, MAX.cell);
      if (!text.ok) return text;
      header.push(text.value);
    }
  }
  return ok({ name: trimmed, header, rows: table });
}

/**
 * Liest den Inhalt einer Tabellendatei (JSON): `title` und `sheets` mit je `name`, optionaler `header` und `rows`.
 * Zellen sind Text oder Zahlen (keine Formeln: ein Text, der mit `=` beginnt, bleibt Text). Unbekannte Felder
 * werden abgelehnt. Fehler tragen nur den Namen des Feldes als Hinweis.
 */
export function parseSheetSpec(source: string): Result<SheetSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.sheet) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json) || !hasOnly(json, ['title', 'sheets'])) return fail('invalid_sheet');
  const title = readText(json.title, MAX.title);
  if (!title.ok || title.value.trim() === '') return fail('invalid_sheet', 'title');
  const entries = json.sheets;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX.sheets) {
    return fail('invalid_sheet', 'sheets');
  }
  const taken = new Set<string>();
  const sheets: Sheet[] = [];
  for (const entry of entries) {
    const sheet = readSheet(entry, taken);
    if (!sheet.ok) return sheet;
    sheets.push(sheet.value);
  }
  return ok({ title: title.value, sheets });
}

/** Prüft eine Tabellendatei, ohne sie anzuzeigen. `null`, wenn sie in Ordnung ist. */
export function validateSheet(source: string): RenderError | null {
  const spec = parseSheetSpec(source);
  return spec.ok ? null : spec.error;
}
