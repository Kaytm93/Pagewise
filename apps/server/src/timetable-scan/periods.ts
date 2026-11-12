import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';
import { TIME_PATTERN } from '../domain/dates';
import { MAX_PERIOD_NUMBER } from './parse';

/** Eine Zeile der Stundentafel: Nummer der Unterrichtsstunde und ihre Uhrzeiten. */
export interface PeriodTime {
  period: number;
  startTime: string;
  endTime: string;
}

const KEY = 'timetableScan.periods';

/**
 * Voreinstellung: eine neutrale, erfundene Stundentafel (keine echten Schulzeiten). Sie gilt, bis
 * im Dialog eine eigene Tafel gespeichert wird.
 */
export const DEFAULT_PERIOD_TIMES: readonly PeriodTime[] = [
  { period: 1, startTime: '08:00', endTime: '08:45' },
  { period: 2, startTime: '08:50', endTime: '09:35' },
  { period: 3, startTime: '09:55', endTime: '10:40' },
  { period: 4, startTime: '10:45', endTime: '11:30' },
  { period: 5, startTime: '11:50', endTime: '12:35' },
  { period: 6, startTime: '12:40', endTime: '13:25' },
  { period: 7, startTime: '13:45', endTime: '14:30' },
  { period: 8, startTime: '14:35', endTime: '15:20' },
  { period: 9, startTime: '15:25', endTime: '16:10' },
  { period: 10, startTime: '16:15', endTime: '17:00' },
];

/**
 * Die Stundentafel ordnet Nummern von Unterrichtsstunden Uhrzeiten zu, wenn der Stundenplan im Bild
 * keine Uhrzeiten zeigt. Sie liegt als Einstellung in der Datenbank, nie als Schultafel im Code.
 */
export class PeriodTimes {
  constructor(private readonly db: Db) {}

  /** Gespeicherte Tafel; ohne gespeicherte Tafel die Voreinstellung. Aufsteigend nach Nummer. */
  list(): PeriodTime[] {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    let stored: unknown;
    if (row) {
      try {
        stored = JSON.parse(row.value);
      } catch {
        stored = undefined;
      }
    }
    const source = Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_PERIOD_TIMES;
    return source
      .filter(isRow)
      .filter(
        (entry, index, all) => all.findIndex((other) => other.period === entry.period) === index,
      )
      .sort((a, b) => a.period - b.period);
  }

  /** Ersetzt die ganze Tafel; die Route hat die Zeilen bereits geprüft. */
  replace(rows: readonly PeriodTime[]): void {
    const json = JSON.stringify(rows);
    this.db
      .insert(settings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }
}

function isRow(value: unknown): value is PeriodTime {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.period === 'number' &&
    Number.isInteger(row.period) &&
    row.period >= 1 &&
    row.period <= MAX_PERIOD_NUMBER &&
    typeof row.startTime === 'string' &&
    typeof row.endTime === 'string' &&
    TIME_PATTERN.test(row.startTime) &&
    TIME_PATTERN.test(row.endTime) &&
    row.endTime > row.startTime
  );
}
