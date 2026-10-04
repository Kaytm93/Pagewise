/**
 * Datums- und Zeitangaben für Stundenplan und Tests (gleiche Regeln wie auf dem Server, siehe
 * `apps/server/src/domain/dates.ts`): ein Datum ist `YYYY-MM-DD` ohne Zeitzone, eine Uhrzeit `HH:MM`. Gerechnet
 * wird über UTC-Zeitpunkte desselben Datums, damit die Sommerzeit nie einen Tag verschiebt.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type WeekKind = 'all' | 'a' | 'b';

export interface WeekAnchor {
  /** Montag einer bekannten Woche. */
  monday: string;
  week: 'a' | 'b';
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

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (year < 2000 || year > 2100) return false;
  const check = utc(value);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/** Heute als lokales Datum (nicht UTC). */
export function localDate(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Minuten seit Mitternacht (lokal). */
export function minutesOfDay(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** Wochentag: 1 = Montag bis 7 = Sonntag. */
export function weekdayOf(date: string): number {
  const day = utc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const next = utc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return format(next);
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** Wochenart („a“ oder „b“) eines Datums ausgehend von einer bekannten Woche; ohne Anker unbekannt. */
export function weekKindOf(date: string, anchor: WeekAnchor | null): 'a' | 'b' | null {
  if (!anchor) return null;
  const weeks = Math.floor(daysBetween(anchor.monday, mondayOf(date)) / 7);
  const same = ((weeks % 2) + 2) % 2 === 0;
  return same ? anchor.week : anchor.week === 'a' ? 'b' : 'a';
}

export function appliesInWeek(week: WeekKind, current: 'a' | 'b' | null): boolean {
  return week === 'all' || current === null || week === current;
}

const dayFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const longDayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

/** Das Datum als Anzeige: „8. Oktober“, „Donnerstag, 8. Oktober“ oder „Do., 8.10.“. */
export function formatDate(date: string, style: 'day' | 'long' | 'short' = 'day'): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Das lokale Datum gleicher Zahlen: so zeigt die Anzeige immer genau diesen Kalendertag.
  const local = new Date(year, month - 1, day);
  const format = style === 'long' ? longDayFormat : style === 'short' ? shortFormat : dayFormat;
  return format.format(local);
}

const monthFormat = new Intl.DateTimeFormat('de-DE', { month: 'short' });

/** Der Monat eines Datums kurz („Okt.“). */
export function monthShort(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return monthFormat.format(new Date(year, month - 1, day));
}
