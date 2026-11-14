import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';
import { foldName } from '../domain/subject-templates';
import { type CourseAbbreviation, courseCore } from './codes';

export const MAX_ABBREVIATIONS = 100;
export const MAX_ABBREVIATION_CODE = 24;
export const MAX_ABBREVIATION_SUBJECT = 80;

const KEY = 'timetableScan.abbreviations';

// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Kürzel ohne Jahrgang und Kursnummer, damit „2inf2_2“ auch „1inf1_1“ trifft. */
export function abbreviationKey(code: string): string {
  return courseCore(code) || foldName(code).replace(/\s+/g, '');
}

function clean(entries: readonly unknown[]): CourseAbbreviation[] {
  const result: CourseAbbreviation[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { code, subject } = entry as Record<string, unknown>;
    if (typeof code !== 'string' || typeof subject !== 'string') continue;
    const key = abbreviationKey(code.trim());
    const name = subject.replace(/\s+/g, ' ').trim();
    if (key === '' || key.length > MAX_ABBREVIATION_CODE) continue;
    if (name === '' || name.length > MAX_ABBREVIATION_SUBJECT) continue;
    if (CONTROL.test(key) || CONTROL.test(name) || seen.has(key)) continue;
    seen.add(key);
    result.push({ code: key, subject: name });
    if (result.length >= MAX_ABBREVIATIONS) break;
  }
  return result;
}

/**
 * Eigene Kürzel für die Stundenplan-Erkennung („voc = Chor“). Sie liegen als Einstellung in der
 * Datenbank, nie im Repo, und gehen dem Katalog vor. Kurscodes werden auf ihren Kern gekürzt.
 */
export class ScanAbbreviations {
  constructor(private readonly db: Db) {}

  list(): CourseAbbreviation[] {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    if (!row) return [];
    try {
      const stored: unknown = JSON.parse(row.value);
      return Array.isArray(stored) ? clean(stored) : [];
    } catch {
      return [];
    }
  }

  /** Ersetzt alle Kürzel; liefert die bereinigte Liste. */
  replace(entries: readonly CourseAbbreviation[]): CourseAbbreviation[] {
    const cleaned = clean(entries);
    const json = JSON.stringify(cleaned);
    this.db
      .insert(settings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
    return cleaned;
  }
}
