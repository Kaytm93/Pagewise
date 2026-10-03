import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { subjectGroups, subjects } from '../db/schema';

export interface GroupView {
  id: string;
  name: string;
  kind: string | null;
  position: number;
}

export interface SubjectDetails {
  teacher: string | null;
  hoursPerWeek: number | null;
  icon: string | null;
}

export interface SubjectView extends SubjectDetails {
  id: string;
  name: string;
  position: number;
  groups: GroupView[];
}

export type DomainFailure = { ok: false; error: 'name_taken' | 'not_found' };
export type DomainResult<T> = { ok: true; value: T } | DomainFailure;

/** Änderungen an einem Fach. Fehlt ein Feld, bleibt es unverändert; `null` leert es. */
export interface SubjectPatch extends Partial<SubjectDetails> {
  name?: string;
}

export interface GroupPatch {
  name?: string;
  kind?: string | null;
}

/** Gleichheit für Namen: ohne Beachtung von Groß- und Kleinschreibung, Umlaute eingeschlossen. */
function key(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('de');
}

function toGroup(row: typeof subjectGroups.$inferSelect): GroupView {
  return { id: row.id, name: row.name, kind: row.kind, position: row.position };
}

function toSubject(row: typeof subjects.$inferSelect, groups: GroupView[]): SubjectView {
  return {
    id: row.id,
    name: row.name,
    teacher: row.teacher,
    hoursPerWeek: row.hoursPerWeek,
    icon: row.icon,
    position: row.position,
    groups,
  };
}

export function listSubjects(db: Db): SubjectView[] {
  const subjectRows = db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.position), asc(subjects.createdAt), asc(subjects.name))
    .all();
  const groupRows = db
    .select()
    .from(subjectGroups)
    .orderBy(asc(subjectGroups.position), asc(subjectGroups.createdAt), asc(subjectGroups.name))
    .all();
  return subjectRows.map((subject) =>
    toSubject(subject, groupRows.filter((group) => group.subjectId === subject.id).map(toGroup)),
  );
}

function getSubject(db: Db, id: string): SubjectView | undefined {
  return listSubjects(db).find((subject) => subject.id === id);
}

function nextPosition(current: number | null): number {
  return current === null ? 0 : current + 1;
}

export function createSubject(
  db: Db,
  name: string,
  details: Partial<SubjectDetails> = {},
): DomainResult<SubjectView> {
  const taken = db.select({ name: subjects.name }).from(subjects).all();
  if (taken.some((row) => key(row.name) === key(name))) return { ok: false, error: 'name_taken' };

  const last = db
    .select({ value: max(subjects.position) })
    .from(subjects)
    .get();
  try {
    const row = db
      .insert(subjects)
      .values({
        name,
        teacher: details.teacher ?? null,
        hoursPerWeek: details.hoursPerWeek ?? null,
        icon: details.icon ?? null,
        position: nextPosition(last?.value ?? null),
      })
      .returning()
      .get();
    return { ok: true, value: toSubject(row, []) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
}

export function updateSubject(db: Db, id: string, patch: SubjectPatch): DomainResult<SubjectView> {
  const existing = db.select().from(subjects).where(eq(subjects.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };

  const name = patch.name;
  if (name !== undefined) {
    const others = db
      .select()
      .from(subjects)
      .all()
      .filter((row) => row.id !== id);
    if (others.some((row) => key(row.name) === key(name)))
      return { ok: false, error: 'name_taken' };
  }

  const changes: Partial<typeof subjects.$inferInsert> = {};
  if (name !== undefined) changes.name = name;
  if (patch.teacher !== undefined) changes.teacher = patch.teacher;
  if (patch.hoursPerWeek !== undefined) changes.hoursPerWeek = patch.hoursPerWeek;
  if (patch.icon !== undefined) changes.icon = patch.icon;

  try {
    if (Object.keys(changes).length > 0) {
      db.update(subjects).set(changes).where(eq(subjects.id, id)).run();
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
  const view = getSubject(db, id);
  return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
}

/** Löscht das Fach samt Untergruppen (und später samt Chats und Hefteinträgen). */
export function deleteSubject(db: Db, id: string): DomainResult<null> {
  const result = db.delete(subjects).where(eq(subjects.id, id)).run();
  return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
}

export interface ImportSummary {
  created: number;
  /** Fächer, die es schon gab (gleicher Name, Groß- und Kleinschreibung egal). */
  skipped: number;
}

/**
 * Legt mehrere Fächer an. Jedes Fach wird für sich gespeichert, ein erneuter Import ist deshalb
 * harmlos: Vorhandenes wird übersprungen, nichts wird überschrieben.
 */
export function importSubjects(
  db: Db,
  entries: { name: string; teacher: string | null; hoursPerWeek: number | null }[],
): ImportSummary {
  const summary: ImportSummary = { created: 0, skipped: 0 };
  for (const entry of entries) {
    const result = createSubject(db, entry.name, {
      teacher: entry.teacher,
      hoursPerWeek: entry.hoursPerWeek,
    });
    if (result.ok) summary.created += 1;
    else summary.skipped += 1;
  }
  return summary;
}

export function createGroup(
  db: Db,
  subjectId: string,
  name: string,
  kind: string | null = null,
): DomainResult<GroupView> {
  const subject = db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .get();
  if (!subject) return { ok: false, error: 'not_found' };

  const taken = db
    .select({ name: subjectGroups.name })
    .from(subjectGroups)
    .where(eq(subjectGroups.subjectId, subjectId))
    .all();
  if (taken.some((row) => key(row.name) === key(name))) return { ok: false, error: 'name_taken' };

  const last = db
    .select({ value: max(subjectGroups.position) })
    .from(subjectGroups)
    .where(eq(subjectGroups.subjectId, subjectId))
    .get();
  try {
    const row = db
      .insert(subjectGroups)
      .values({ subjectId, name, kind, position: nextPosition(last?.value ?? null) })
      .returning()
      .get();
    return { ok: true, value: toGroup(row) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
}

export function updateGroup(db: Db, id: string, patch: GroupPatch): DomainResult<GroupView> {
  const existing = db.select().from(subjectGroups).where(eq(subjectGroups.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };

  const name = patch.name;
  if (name !== undefined) {
    const siblings = db
      .select()
      .from(subjectGroups)
      .where(eq(subjectGroups.subjectId, existing.subjectId))
      .all()
      .filter((row) => row.id !== id);
    if (siblings.some((row) => key(row.name) === key(name)))
      return { ok: false, error: 'name_taken' };
  }

  const changes: Partial<typeof subjectGroups.$inferInsert> = {};
  if (name !== undefined) changes.name = name;
  if (patch.kind !== undefined) changes.kind = patch.kind;

  try {
    if (Object.keys(changes).length > 0) {
      db.update(subjectGroups).set(changes).where(eq(subjectGroups.id, id)).run();
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
  const row = db.select().from(subjectGroups).where(eq(subjectGroups.id, id)).get();
  return row ? { ok: true, value: toGroup(row) } : { ok: false, error: 'not_found' };
}

export function deleteGroup(db: Db, id: string): DomainResult<null> {
  const result = db.delete(subjectGroups).where(eq(subjectGroups.id, id)).run();
  return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
}
