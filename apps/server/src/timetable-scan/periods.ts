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

/** Eine Pause nach einer Unterrichtsstunde. Sie ersetzt dort die übliche Wechselzeit. */
export interface PeriodBreak {
  after: number;
  minutes: number;
}

/**
 * Die Stundentafel als Regel: Unterrichtsbeginn, Länge einer Stunde, Wechselzeit und Pausen. Daraus
 * entstehen die Uhrzeiten aller Stunden, für jeden Wochentag gleich.
 */
export interface PeriodSchedule {
  start: string;
  lessonMinutes: number;
  /** Minuten zwischen zwei Stunden, nach denen keine Pause liegt. */
  gapMinutes: number;
  count: number;
  breaks: PeriodBreak[];
  /** Zwei gleiche Stunden hintereinander werden zu einer Doppelstunde zusammengefasst. */
  mergeDoubles: boolean;
}

export const SCHEDULE_LIMITS = {
  lessonMinutes: { min: 5, max: 240 },
  gapMinutes: { min: 0, max: 60 },
  breakMinutes: { min: 0, max: 240 },
} as const;

const KEY = 'timetableScan.schedule';
/** Ältere Fassung (D-120): eine Liste einzelner Zeiten. Wird beim Lesen in eine Regel übersetzt. */
const LEGACY_KEY = 'timetableScan.periods';
const MINUTES_PER_DAY = 24 * 60;

/** Voreinstellung: neutral und erfunden (keine echten Schulzeiten). */
export const DEFAULT_SCHEDULE: PeriodSchedule = {
  start: '08:00',
  lessonMinutes: 45,
  gapMinutes: 5,
  count: 10,
  breaks: [
    { after: 2, minutes: 20 },
    { after: 4, minutes: 20 },
    { after: 6, minutes: 20 },
  ],
  mergeDoubles: true,
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function toClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Uhrzeiten aller Stunden aus der Regel. Stunden, die über Mitternacht reichen würden, entfallen;
 * die Route lehnt solche Regeln vorher ab.
 */
export function periodsFromSchedule(schedule: PeriodSchedule): PeriodTime[] {
  const pauses = new Map(schedule.breaks.map((entry) => [entry.after, entry.minutes]));
  const rows: PeriodTime[] = [];
  let cursor = toMinutes(schedule.start);
  for (let period = 1; period <= schedule.count; period += 1) {
    const end = cursor + schedule.lessonMinutes;
    if (end >= MINUTES_PER_DAY) break;
    rows.push({ period, startTime: toClock(cursor), endTime: toClock(end) });
    cursor = end + (pauses.get(period) ?? schedule.gapMinutes);
  }
  return rows;
}

/** Häufigster Wert; bei Gleichstand der kleinere. */
function mostCommon(values: readonly number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Erkennt Unterrichtsbeginn, Stundenlänge, Wechselzeit und Pausen aus einzelnen Zeiten: die
 * häufigste Lücke ist die Wechselzeit, jede andere Lücke eine Pause.
 */
export function scheduleFromPeriods(rows: readonly PeriodTime[]): PeriodSchedule {
  const sorted = [...rows].sort((a, b) => a.period - b.period);
  const first = sorted[0];
  if (!first) return { ...DEFAULT_SCHEDULE, breaks: [...DEFAULT_SCHEDULE.breaks] };
  const lessonMinutes = mostCommon(
    sorted.map((row) => toMinutes(row.endTime) - toMinutes(row.startTime)),
    DEFAULT_SCHEDULE.lessonMinutes,
  );
  const gaps: { after: number; minutes: number }[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current || current.period !== previous.period + 1) continue;
    const minutes = toMinutes(current.startTime) - toMinutes(previous.endTime);
    if (minutes >= 0) gaps.push({ after: previous.period, minutes });
  }
  const gapMinutes = Math.min(
    SCHEDULE_LIMITS.gapMinutes.max,
    mostCommon(
      gaps.map((gap) => gap.minutes),
      0,
    ),
  );
  const lesson = Math.min(
    SCHEDULE_LIMITS.lessonMinutes.max,
    Math.max(SCHEDULE_LIMITS.lessonMinutes.min, lessonMinutes),
  );
  // Fehlen die ersten Stunden, rechnet die Regel vom Beginn der ersten vorhandenen zurück.
  const start = Math.max(
    0,
    toMinutes(first.startTime) - (first.period - 1) * (lesson + gapMinutes),
  );
  return {
    start: toClock(start),
    lessonMinutes: lesson,
    gapMinutes,
    count: Math.min(MAX_PERIOD_NUMBER, sorted[sorted.length - 1]?.period ?? first.period),
    breaks: gaps
      .filter((gap) => gap.minutes !== gapMinutes)
      .map((gap) => ({
        after: gap.after,
        minutes: Math.min(SCHEDULE_LIMITS.breakMinutes.max, gap.minutes),
      })),
    mergeDoubles: true,
  };
}

/** `true`, wenn die Regel in sich stimmig ist und alle Stunden vor Mitternacht enden. */
export function isValidSchedule(schedule: PeriodSchedule): boolean {
  if (!TIME_PATTERN.test(schedule.start)) return false;
  const afters = schedule.breaks.map((entry) => entry.after);
  if (new Set(afters).size !== afters.length) return false;
  if (afters.some((after) => after >= schedule.count)) return false;
  return periodsFromSchedule(schedule).length === schedule.count;
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

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isSchedule(value: unknown): value is PeriodSchedule {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.start === 'string' &&
    isInteger(
      s.lessonMinutes,
      SCHEDULE_LIMITS.lessonMinutes.min,
      SCHEDULE_LIMITS.lessonMinutes.max,
    ) &&
    isInteger(s.gapMinutes, SCHEDULE_LIMITS.gapMinutes.min, SCHEDULE_LIMITS.gapMinutes.max) &&
    isInteger(s.count, 1, MAX_PERIOD_NUMBER) &&
    typeof s.mergeDoubles === 'boolean' &&
    Array.isArray(s.breaks) &&
    s.breaks.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        isInteger((entry as PeriodBreak).after, 1, MAX_PERIOD_NUMBER) &&
        isInteger(
          (entry as PeriodBreak).minutes,
          SCHEDULE_LIMITS.breakMinutes.min,
          SCHEDULE_LIMITS.breakMinutes.max,
        ),
    ) &&
    isValidSchedule(s as unknown as PeriodSchedule)
  );
}

/**
 * Die Stundentafel ordnet Nummern von Unterrichtsstunden Uhrzeiten zu, wenn der Stundenplan im Bild
 * keine Uhrzeiten zeigt. Gespeichert wird die Regel (Beginn, Länge, Pausen) als Einstellung in der
 * Datenbank, nie als Schultafel im Code.
 */
export class PeriodTimes {
  constructor(private readonly db: Db) {}

  private read(key: string): unknown {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  /** Gespeicherte Regel; sonst aus einer älteren Tafel erkannt; sonst die Voreinstellung. */
  schedule(): PeriodSchedule {
    const stored = this.read(KEY);
    if (isSchedule(stored)) {
      return {
        start: stored.start,
        lessonMinutes: stored.lessonMinutes,
        gapMinutes: stored.gapMinutes,
        count: stored.count,
        breaks: [...stored.breaks]
          .map((entry) => ({ after: entry.after, minutes: entry.minutes }))
          .sort((a, b) => a.after - b.after),
        mergeDoubles: stored.mergeDoubles,
      };
    }
    const legacy = this.read(LEGACY_KEY);
    if (Array.isArray(legacy)) {
      const rows = legacy
        .filter(isRow)
        .filter((entry, index, all) => all.findIndex((o) => o.period === entry.period) === index);
      if (rows.length > 0) {
        const inferred = scheduleFromPeriods(rows);
        if (isValidSchedule(inferred)) return inferred;
      }
    }
    return { ...DEFAULT_SCHEDULE, breaks: [...DEFAULT_SCHEDULE.breaks] };
  }

  /** Uhrzeiten aller Stunden, aufsteigend nach Nummer. */
  list(): PeriodTime[] {
    return periodsFromSchedule(this.schedule());
  }

  /** Ersetzt die Regel; die Route hat sie bereits geprüft. */
  replace(schedule: PeriodSchedule): void {
    const json = JSON.stringify({
      ...schedule,
      breaks: [...schedule.breaks].sort((a, b) => a.after - b.after),
    });
    this.db
      .insert(settings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }
}
