import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { profile, subjectGroups, subjects } from '../db/schema';
import { type ComposedPrompt, composePrompt, type PlaceholderValues } from '../prompts/compose';
import type { DomainResult } from './subjects';

/** Allgemeiner Schul-Prompt (Schicht 1). `null`, solange der Nutzer nichts eingetragen hat. */
export function getGeneralPrompt(db: Db): string | null {
  return db.select().from(profile).where(eq(profile.id, 1)).get()?.schoolPrompt ?? null;
}

export function setGeneralPrompt(db: Db, text: string | null): string | null {
  db.insert(profile).values({ id: 1 }).onConflictDoNothing().run();
  db.update(profile).set({ schoolPrompt: text }).where(eq(profile.id, 1)).run();
  return getGeneralPrompt(db);
}

export function getSubjectPrompt(db: Db, subjectId: string): DomainResult<string | null> {
  const row = db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
  return row ? { ok: true, value: row.systemPrompt } : { ok: false, error: 'not_found' };
}

export function setSubjectPrompt(
  db: Db,
  subjectId: string,
  text: string | null,
): DomainResult<string | null> {
  const result = db
    .update(subjects)
    .set({ systemPrompt: text })
    .where(eq(subjects.id, subjectId))
    .run();
  return result.changes > 0 ? { ok: true, value: text } : { ok: false, error: 'not_found' };
}

export function getGroupPrompt(db: Db, groupId: string): DomainResult<string | null> {
  const row = db.select().from(subjectGroups).where(eq(subjectGroups.id, groupId)).get();
  return row ? { ok: true, value: row.extraPrompt } : { ok: false, error: 'not_found' };
}

export function setGroupPrompt(
  db: Db,
  groupId: string,
  text: string | null,
): DomainResult<string | null> {
  const result = db
    .update(subjectGroups)
    .set({ extraPrompt: text })
    .where(eq(subjectGroups.id, groupId))
    .run();
  return result.changes > 0 ? { ok: true, value: text } : { ok: false, error: 'not_found' };
}

/**
 * Baut den System-Prompt für einen Chat im Fach (und optional in einer Untergruppe dieses Fachs).
 * Eine Untergruppe eines anderen Fachs zählt als unbekannt.
 */
export function buildSystemPrompt(
  db: Db,
  subjectId: string,
  groupId: string | null = null,
): DomainResult<ComposedPrompt> {
  const subject = db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
  if (!subject) return { ok: false, error: 'not_found' };

  let group: typeof subjectGroups.$inferSelect | undefined;
  if (groupId !== null) {
    group = db.select().from(subjectGroups).where(eq(subjectGroups.id, groupId)).get();
    if (!group || group.subjectId !== subject.id) return { ok: false, error: 'not_found' };
  }

  const row = db.select().from(profile).where(eq(profile.id, 1)).get();
  const values: PlaceholderValues = {
    bundesland: row?.federalState ?? null,
    schulform: row?.schoolType ?? null,
    jahrgangsstufe: row?.gradeLevel ?? null,
    fach: subject.name,
    untergruppe: group?.name ?? null,
  };
  return {
    ok: true,
    value: composePrompt(
      {
        general: row?.schoolPrompt ?? null,
        subject: subject.systemPrompt,
        group: group?.extraPrompt ?? null,
      },
      values,
    ),
  };
}
