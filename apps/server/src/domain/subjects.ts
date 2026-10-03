import { and, asc, eq, max, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { subjectGroups, subjects } from '../db/schema';
import type { Selection } from '../providers/models';
import { DEFAULT_SUBJECT_NAME } from './subject-templates';

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
  /** `default` ist das eingebaute Fach „Standard“ (fachunabhängiger Chat), sonst `subject`. */
  kind: 'subject' | 'default';
  /** Schlüssel der Katalogvorlage, aus der das Fach angelegt wurde, sonst `null`. */
  templateKey: string | null;
  position: number;
  /** Gewähltes Modell für dieses Fach, `null`: es gilt das Standardmodell. */
  model: Selection | null;
  groups: GroupView[];
}

export type DomainFailure = {
  ok: false;
  /** `name_reserved`: der Name „Standard“ gehört dem eingebauten Fach. `builtin`: das eingebaute Fach lässt sich nicht ändern oder löschen. */
  error: 'name_taken' | 'not_found' | 'name_reserved' | 'builtin';
};
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
    kind: row.kind,
    templateKey: row.templateKey,
    teacher: row.teacher,
    hoursPerWeek: row.hoursPerWeek,
    icon: row.icon,
    position: row.position,
    model:
      row.modelProviderId && row.modelId
        ? { providerId: row.modelProviderId, model: row.modelId }
        : null,
    groups,
  };
}

function loadSubjects(db: Db, which: 'user' | 'all'): SubjectView[] {
  const subjectRows = db
    .select()
    .from(subjects)
    .where(which === 'user' ? ne(subjects.kind, 'default') : undefined)
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

/** Die Fächer des Nutzers in seiner Reihenfolge. Das eingebaute Fach „Standard“ gehört nicht dazu. */
export function listSubjects(db: Db): SubjectView[] {
  return loadSubjects(db, 'user');
}

/** Ein Fach, auch das eingebaute „Standard“. */
export function getSubject(db: Db, id: string): SubjectView | undefined {
  return loadSubjects(db, 'all').find((subject) => subject.id === id);
}

/**
 * Das eingebaute Fach „Standard“ für den fachunabhängigen Chat. Es wird beim Start, nach „Alles löschen“
 * und beim Laden der Fächer bei Bedarf angelegt (idempotent). Heißt schon ein Fach des Nutzers so (aus
 * einer Version vor dem Standard-Fach), bekommt dieses einen anderen Namen: das eingebaute Fach hat Vorrang.
 */
export function ensureDefaultSubject(db: Db): SubjectView {
  const existing = db.select().from(subjects).where(eq(subjects.kind, 'default')).get();
  if (existing) {
    return toSubject(
      existing,
      db
        .select()
        .from(subjectGroups)
        .where(eq(subjectGroups.subjectId, existing.id))
        .orderBy(asc(subjectGroups.position), asc(subjectGroups.createdAt))
        .all()
        .map(toGroup),
    );
  }
  const row = db.transaction((tx) => {
    const clash = tx
      .select()
      .from(subjects)
      .all()
      .find((entry) => key(entry.name) === key(DEFAULT_SUBJECT_NAME));
    if (clash) {
      const taken = new Set(
        tx
          .select({ name: subjects.name })
          .from(subjects)
          .all()
          .map((entry) => key(entry.name)),
      );
      let candidate = `${DEFAULT_SUBJECT_NAME} (eigenes Fach)`;
      for (let n = 2; taken.has(key(candidate)); n += 1) {
        candidate = `${DEFAULT_SUBJECT_NAME} (eigenes Fach) ${n}`;
      }
      tx.update(subjects).set({ name: candidate }).where(eq(subjects.id, clash.id)).run();
    }
    return tx
      .insert(subjects)
      .values({
        name: DEFAULT_SUBJECT_NAME,
        kind: 'default',
        templateKey: 'standard',
        // Vor allen Fächern des Nutzers; das erste eigene Fach bekommt dadurch Position 0.
        position: -1,
      })
      .returning()
      .get();
  });
  return toSubject(row, []);
}

function isReservedName(name: string): boolean {
  return key(name) === key(DEFAULT_SUBJECT_NAME);
}

function nextPosition(current: number | null): number {
  return current === null ? 0 : current + 1;
}

export function createSubject(
  db: Db,
  name: string,
  details: Partial<SubjectDetails> & { templateKey?: string | null } = {},
): DomainResult<SubjectView> {
  if (isReservedName(name)) return { ok: false, error: 'name_reserved' };
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
        templateKey: details.templateKey ?? null,
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
  if (existing.kind === 'default') return { ok: false, error: 'builtin' };

  const name = patch.name;
  if (name !== undefined) {
    if (isReservedName(name)) return { ok: false, error: 'name_reserved' };
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

/** Löscht das Fach samt Untergruppen und Chats. Das eingebaute Fach „Standard“ lässt sich nicht löschen. */
export function deleteSubject(db: Db, id: string): DomainResult<null> {
  const result = db
    .delete(subjects)
    .where(and(eq(subjects.id, id), ne(subjects.kind, 'default')))
    .run();
  if (result.changes === 0 && db.select().from(subjects).where(eq(subjects.id, id)).get()) {
    return { ok: false, error: 'builtin' };
  }
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
