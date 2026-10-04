import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings, subjects, timetableEntries } from '../db/schema';
import { isValidDate, isValidTime, mondayOf, type WeekAnchor, type WeekKind } from './dates';

export interface TimetableEntryView {
  id: string;
  /** 1 = Montag bis 7 = Sonntag. */
  weekday: number;
  startTime: string;
  endTime: string;
  subjectId: string | null;
  room: string | null;
  note: string | null;
  week: WeekKind;
}

export interface TimetableInput {
  weekday: number;
  startTime: string;
  endTime: string;
  subjectId: string | null;
  room: string | null;
  note: string | null;
  week: WeekKind;
}

export type PlannerFailure = {
  ok: false;
  /** `invalid_subject`: das Fach gibt es nicht (oder es ist das eingebaute „Standard“). `too_many`: Obergrenze erreicht. */
  error: 'not_found' | 'invalid_subject' | 'too_many' | 'invalid_time' | 'invalid_date';
};
export type PlannerResult<T> = { ok: true; value: T } | PlannerFailure;

export const MAX_TIMETABLE_ENTRIES = 500;
const ANCHOR_KEY = 'timetable.week_anchor';

function toView(row: typeof timetableEntries.$inferSelect): TimetableEntryView {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    subjectId: row.subjectId,
    room: row.room,
    note: row.note,
    week: row.week,
  };
}

/** Ob es das Fach gibt und es ein Fach des Nutzers ist (das eingebaute „Standard“ gehört nicht in den Plan). */
export function isPlannerSubject(db: Db, subjectId: string): boolean {
  const row = db
    .select({ kind: subjects.kind })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .get();
  return row !== undefined && row.kind !== 'default';
}

export function listTimetable(db: Db): TimetableEntryView[] {
  return db
    .select()
    .from(timetableEntries)
    .orderBy(
      asc(timetableEntries.weekday),
      asc(timetableEntries.startTime),
      asc(timetableEntries.createdAt),
    )
    .all()
    .map(toView);
}

function validTimes(input: Pick<TimetableInput, 'startTime' | 'endTime'>): boolean {
  return (
    isValidTime(input.startTime) && isValidTime(input.endTime) && input.endTime > input.startTime
  );
}

export function createTimetableEntry(
  db: Db,
  input: TimetableInput,
): PlannerResult<TimetableEntryView> {
  if (!validTimes(input)) return { ok: false, error: 'invalid_time' };
  if (input.subjectId !== null && !isPlannerSubject(db, input.subjectId)) {
    return { ok: false, error: 'invalid_subject' };
  }
  const total = db.select({ n: count() }).from(timetableEntries).get()?.n ?? 0;
  if (total >= MAX_TIMETABLE_ENTRIES) return { ok: false, error: 'too_many' };
  const row = db.insert(timetableEntries).values(input).returning().get();
  return { ok: true, value: toView(row) };
}

export function updateTimetableEntry(
  db: Db,
  id: string,
  patch: Partial<TimetableInput>,
): PlannerResult<TimetableEntryView> {
  const existing = db.select().from(timetableEntries).where(eq(timetableEntries.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };
  const next = { ...toView(existing), ...patch };
  if (!validTimes(next)) return { ok: false, error: 'invalid_time' };
  if (patch.subjectId !== undefined && patch.subjectId !== null) {
    if (!isPlannerSubject(db, patch.subjectId)) return { ok: false, error: 'invalid_subject' };
  }
  const row = db
    .update(timetableEntries)
    .set(patch)
    .where(eq(timetableEntries.id, id))
    .returning()
    .get();
  return row ? { ok: true, value: toView(row) } : { ok: false, error: 'not_found' };
}

export function deleteTimetableEntry(db: Db, id: string): PlannerResult<null> {
  const result = db.delete(timetableEntries).where(eq(timetableEntries.id, id)).run();
  return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
}

/** Die bekannte Woche („diese Woche ist A“), oder `null`, wenn die Person keine festgelegt hat. */
export function getWeekAnchor(db: Db): WeekAnchor | null {
  const row = db.select().from(settings).where(eq(settings.key, ANCHOR_KEY)).get();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as unknown;
    if (
      typeof value === 'object' &&
      value !== null &&
      'monday' in value &&
      'week' in value &&
      typeof value.monday === 'string' &&
      isValidDate(value.monday) &&
      (value.week === 'a' || value.week === 'b')
    ) {
      return { monday: value.monday, week: value.week };
    }
  } catch {
    // Ein beschädigter Wert gilt als „nicht festgelegt“.
  }
  return null;
}

/**
 * Legt fest, welche Wochenart die Woche mit dem Datum `date` hat (gespeichert wird ihr Montag), oder hebt die
 * Festlegung mit `null` auf.
 */
export function setWeekAnchor(
  db: Db,
  input: { date: string; week: 'a' | 'b' } | null,
): PlannerResult<WeekAnchor | null> {
  if (input === null) {
    db.delete(settings).where(eq(settings.key, ANCHOR_KEY)).run();
    return { ok: true, value: null };
  }
  if (!isValidDate(input.date)) return { ok: false, error: 'invalid_date' };
  const anchor: WeekAnchor = { monday: mondayOf(input.date), week: input.week };
  db.insert(settings)
    .values({ key: ANCHOR_KEY, value: JSON.stringify(anchor) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(anchor), updatedAt: new Date() },
    })
    .run();
  return { ok: true, value: anchor };
}
