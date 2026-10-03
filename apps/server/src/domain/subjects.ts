import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { subjectGroups, subjects } from '../db/schema';

export interface GroupView {
  id: string;
  name: string;
  position: number;
}

export interface SubjectView {
  id: string;
  name: string;
  position: number;
  groups: GroupView[];
}

export type DomainFailure = { ok: false; error: 'name_taken' | 'not_found' };
export type DomainResult<T> = { ok: true; value: T } | DomainFailure;

/** Gleichheit für Namen: ohne Beachtung von Groß- und Kleinschreibung, Umlaute eingeschlossen. */
function key(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('de');
}

function toGroup(row: typeof subjectGroups.$inferSelect): GroupView {
  return { id: row.id, name: row.name, position: row.position };
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
  return subjectRows.map((subject) => ({
    id: subject.id,
    name: subject.name,
    position: subject.position,
    groups: groupRows.filter((group) => group.subjectId === subject.id).map(toGroup),
  }));
}

function getSubject(db: Db, id: string): SubjectView | undefined {
  return listSubjects(db).find((subject) => subject.id === id);
}

function nextPosition(current: number | null): number {
  return current === null ? 0 : current + 1;
}

export function createSubject(db: Db, name: string): DomainResult<SubjectView> {
  const taken = db.select({ name: subjects.name }).from(subjects).all();
  if (taken.some((row) => key(row.name) === key(name))) return { ok: false, error: 'name_taken' };

  const last = db
    .select({ value: max(subjects.position) })
    .from(subjects)
    .get();
  try {
    const row = db
      .insert(subjects)
      .values({ name, position: nextPosition(last?.value ?? null) })
      .returning()
      .get();
    return { ok: true, value: { id: row.id, name: row.name, position: row.position, groups: [] } };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
}

export function renameSubject(db: Db, id: string, name: string): DomainResult<SubjectView> {
  const existing = db.select().from(subjects).where(eq(subjects.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };

  const others = db
    .select()
    .from(subjects)
    .all()
    .filter((row) => row.id !== id);
  if (others.some((row) => key(row.name) === key(name))) return { ok: false, error: 'name_taken' };

  try {
    db.update(subjects).set({ name }).where(eq(subjects.id, id)).run();
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

export function createGroup(db: Db, subjectId: string, name: string): DomainResult<GroupView> {
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
      .values({ subjectId, name, position: nextPosition(last?.value ?? null) })
      .returning()
      .get();
    return { ok: true, value: toGroup(row) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
    throw error;
  }
}

export function renameGroup(db: Db, id: string, name: string): DomainResult<GroupView> {
  const existing = db.select().from(subjectGroups).where(eq(subjectGroups.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };

  const siblings = db
    .select()
    .from(subjectGroups)
    .where(eq(subjectGroups.subjectId, existing.subjectId))
    .all()
    .filter((row) => row.id !== id);
  if (siblings.some((row) => key(row.name) === key(name)))
    return { ok: false, error: 'name_taken' };

  try {
    db.update(subjectGroups).set({ name }).where(eq(subjectGroups.id, id)).run();
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
