import { z } from 'zod';
import { hoursField, nameField, optionalTextField } from '../http/fields';

/** Größen- und Mengengrenzen für den Import (siehe docs/import-format.md). */
export const IMPORT_MAX_CHARACTERS = 256 * 1024;
export const IMPORT_MAX_ENTRIES = 200;

export type ImportFormat = 'json' | 'csv';

export interface ImportEntry {
  name: string;
  teacher: string | null;
  hoursPerWeek: number | null;
}

export type ImportParse =
  | { ok: true; entries: ImportEntry[]; invalid: number }
  | { ok: false; reason: 'invalid_format' | 'too_many' | 'empty' };

// Unbekannte Spalten und Schlüssel (etwa Prompts) werden bewusst ignoriert, nie übernommen.
const entrySchema = z.object({
  name: nameField,
  teacher: optionalTextField.optional(),
  hours_per_week: hoursField.optional(),
});

/** Zerlegt CSV (RFC 4180, Komma als Trennzeichen). `null`, wenn ein Anführungszeichen offen bleibt. */
function parseCsv(input: string): string[][] | null {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endRow = (): void => {
    row.push(field);
    field = '';
    // Ganz leere Zeilen (ein einziges leeres Feld) gelten nicht als Datensatz.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += ch;
    }
  }
  if (quoted) return null;
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function rawEntriesFromJson(content: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { version, subjects } = parsed as { version?: unknown; subjects?: unknown };
  if (version !== 1 || !Array.isArray(subjects)) return null;
  return subjects;
}

function rawEntriesFromCsv(content: string): unknown[] | null {
  const rows = parseCsv(content);
  const header = rows?.[0];
  if (!rows || !header) return null;
  const columns = header.map((cell) => cell.trim().toLowerCase());
  const nameIndex = columns.indexOf('name');
  if (nameIndex < 0) return null;
  const teacherIndex = columns.indexOf('teacher');
  const hoursIndex = columns.indexOf('hours_per_week');

  return rows.slice(1).map((cells) => {
    const cell = (index: number): string => (index < 0 ? '' : (cells[index] ?? ''));
    const hours = cell(hoursIndex).trim();
    return {
      name: cell(nameIndex),
      teacher: cell(teacherIndex),
      // Leer heißt „nicht angegeben“. Alles, was keine Zahl ist, bleibt Text und fällt in der Prüfung durch.
      hours_per_week: hours === '' ? null : /^\d{1,2}$/.test(hours) ? Number(hours) : hours,
    };
  });
}

/**
 * Liest eine importierte Fächerliste. Der Inhalt gilt als nicht vertrauenswürdig: jeder Eintrag wird
 * einzeln geprüft, ungültige Einträge werden gezählt statt übernommen.
 */
export function parseSubjectImport(format: ImportFormat, content: string): ImportParse {
  if (content.length > IMPORT_MAX_CHARACTERS) return { ok: false, reason: 'invalid_format' };
  const raw = format === 'json' ? rawEntriesFromJson(content) : rawEntriesFromCsv(content);
  if (!raw) return { ok: false, reason: 'invalid_format' };
  if (raw.length === 0) return { ok: false, reason: 'empty' };
  if (raw.length > IMPORT_MAX_ENTRIES) return { ok: false, reason: 'too_many' };

  const entries: ImportEntry[] = [];
  let invalid = 0;
  for (const item of raw) {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    entries.push({
      name: parsed.data.name,
      teacher: parsed.data.teacher ?? null,
      hoursPerWeek: parsed.data.hours_per_week ?? null,
    });
  }
  return { ok: true, entries, invalid };
}
