/**
 * Datums- und Zeitangaben für Stundenplan und Tests. Alles ist „lokal“, ohne Zeitzone: ein Datum ist
 * `YYYY-MM-DD`, eine Uhrzeit `HH:MM`. Die Rechnung läuft über UTC-Zeitpunkte desselben Datums, damit
 * Sommerzeit nie einen Tag verschiebt.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Plausibler Bereich, damit „9999-12-31“ oder „0001-01-01“ nicht als Test durchgeht. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function utc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function format(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Heute als lokales Datum (nicht UTC: gegen 0 Uhr darf „heute“ nicht um einen Tag danebenliegen). */
export function localDate(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Wochentag eines Datums: 1 = Montag bis 7 = Sonntag. */
export function weekdayOf(date: string): number {
  const day = utc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const next = utc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return format(next);
}

/** Der Montag der Woche, in der das Datum liegt. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

/** Ganze Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export type WeekKind = 'all' | 'a' | 'b';

/** Welche Woche gerade gilt: der Montag einer bekannten Woche und ihre Art. */
export interface WeekAnchor {
  monday: string;
  week: 'a' | 'b';
}

/**
 * Wochenart eines Datums („A“ oder „B“), ausgehend von einer bekannten Woche. Ohne Anker ist sie unbekannt
 * (`null`): dann gelten alle Einträge.
 */
export function weekKindOf(date: string, anchor: WeekAnchor | null): 'a' | 'b' | null {
  if (!anchor) return null;
  const weeks = Math.floor(daysBetween(anchor.monday, mondayOf(date)) / 7);
  const same = ((weeks % 2) + 2) % 2 === 0;
  return same ? anchor.week : anchor.week === 'a' ? 'b' : 'a';
}

/** Ob ein Eintrag mit Wochenart `week` in der Woche mit Art `current` gilt. Unbekannte Woche: immer. */
export function appliesInWeek(week: WeekKind, current: 'a' | 'b' | null): boolean {
  return week === 'all' || current === null || week === current;
}
