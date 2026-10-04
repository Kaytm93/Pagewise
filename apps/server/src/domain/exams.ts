import { and, asc, count, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { exams } from '../db/schema';
import { isValidDate, isValidTime } from './dates';
import { isPlannerSubject, type PlannerResult } from './timetable';

export interface ExamView {
  id: string;
  subjectId: string;
  /** Art des Eintrags, frei (Schulaufgabe, Test, Ex, Referat …). */
  kind: string;
  title: string | null;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` oder `null`. */
  time: string | null;
  topics: string | null;
  notes: string | null;
}

export interface ExamInput {
  subjectId: string;
  kind: string;
  title: string | null;
  date: string;
  time: string | null;
  topics: string | null;
  notes: string | null;
}

export interface ExamFilter {
  from?: string;
  to?: string;
  subjectId?: string;
}

export const MAX_EXAMS = 2000;

function toView(row: typeof exams.$inferSelect): ExamView {
  return {
    id: row.id,
    subjectId: row.subjectId,
    kind: row.kind,
    title: row.title,
    date: row.date,
    time: row.time,
    topics: row.topics,
    notes: row.notes,
  };
}

/** Einträge nach Datum, bei gleichem Datum nach Uhrzeit (ohne Uhrzeit zuerst), dann nach Anlage. */
export function listExams(db: Db, filter: ExamFilter = {}): ExamView[] {
  const conditions = [
    filter.from ? gte(exams.date, filter.from) : undefined,
    filter.to ? lte(exams.date, filter.to) : undefined,
    filter.subjectId ? eq(exams.subjectId, filter.subjectId) : undefined,
  ].filter((condition) => condition !== undefined);
  return db
    .select()
    .from(exams)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(exams.date), asc(exams.time), asc(exams.createdAt))
    .all()
    .map(toView);
}

export function createExam(db: Db, input: ExamInput): PlannerResult<ExamView> {
  if (!isValidDate(input.date)) return { ok: false, error: 'invalid_date' };
  if (input.time !== null && !isValidTime(input.time)) return { ok: false, error: 'invalid_time' };
  if (!isPlannerSubject(db, input.subjectId)) return { ok: false, error: 'invalid_subject' };
  const total = db.select({ n: count() }).from(exams).get()?.n ?? 0;
  if (total >= MAX_EXAMS) return { ok: false, error: 'too_many' };
  return { ok: true, value: toView(db.insert(exams).values(input).returning().get()) };
}

export function updateExam(db: Db, id: string, patch: Partial<ExamInput>): PlannerResult<ExamView> {
  const existing = db.select().from(exams).where(eq(exams.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };
  if (patch.date !== undefined && !isValidDate(patch.date)) {
    return { ok: false, error: 'invalid_date' };
  }
  if (patch.time !== undefined && patch.time !== null && !isValidTime(patch.time)) {
    return { ok: false, error: 'invalid_time' };
  }
  if (patch.subjectId !== undefined && !isPlannerSubject(db, patch.subjectId)) {
    return { ok: false, error: 'invalid_subject' };
  }
  const row = db.update(exams).set(patch).where(eq(exams.id, id)).returning().get();
  return row ? { ok: true, value: toView(row) } : { ok: false, error: 'not_found' };
}

export function deleteExam(db: Db, id: string): PlannerResult<null> {
  const result = db.delete(exams).where(eq(exams.id, id)).run();
  return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
}
