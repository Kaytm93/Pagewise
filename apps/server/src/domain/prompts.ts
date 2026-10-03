import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { profile, subjectGroups, subjects } from '../db/schema';
import { type ComposedPrompt, composePrompt, type PlaceholderValues } from '../prompts/compose';
import type { DefaultPrompts } from '../prompts/defaults';
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

/** Fach-Prompt (Schicht 2) in beiden Fassungen: eigener Text des Nutzers und mitgelieferter Standard. */
export interface SubjectPromptView {
  /** Eigener Text. `null`: Der Standard ist aktiv (D-034). */
  text: string | null;
  /** Mitgelieferter Standardtext zu diesem Fach, `null` wenn es keinen gibt. Variablen noch nicht eingesetzt. */
  defaultText: string | null;
  /** Der Text, der im Chat gilt, und woher er kommt. */
  source: 'custom' | 'default' | 'none';
}

function subjectPromptView(
  row: typeof subjects.$inferSelect,
  defaults: DefaultPrompts,
): SubjectPromptView {
  const standard = defaults.resolve({
    name: row.name,
    templateKey: row.templateKey,
    kind: row.kind,
  });
  const custom = row.systemPrompt;
  return {
    text: custom,
    defaultText: standard?.text ?? null,
    source: custom !== null ? 'custom' : standard ? 'default' : 'none',
  };
}

export function getSubjectPrompt(
  db: Db,
  subjectId: string,
  defaults: DefaultPrompts,
): DomainResult<SubjectPromptView> {
  const row = db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
  return row
    ? { ok: true, value: subjectPromptView(row, defaults) }
    : { ok: false, error: 'not_found' };
}

/** Schreibt den eigenen Fach-Prompt. `null` (leerer Text) setzt auf den Standard zurück. */
export function setSubjectPrompt(
  db: Db,
  subjectId: string,
  text: string | null,
  defaults: DefaultPrompts,
): DomainResult<SubjectPromptView> {
  const result = db
    .update(subjects)
    .set({ systemPrompt: text })
    .where(eq(subjects.id, subjectId))
    .run();
  if (result.changes === 0) return { ok: false, error: 'not_found' };
  return getSubjectPrompt(db, subjectId, defaults);
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
 * Baut den System-Prompt für einen Chat im Fach (und optional in einer Untergruppe dieses Fachs). Schicht 2
 * ist der eigene Text des Nutzers, sonst der Standardtext des Fachs. Eine Untergruppe eines anderen Fachs
 * zählt als unbekannt.
 */
export function buildSystemPrompt(
  db: Db,
  defaults: DefaultPrompts,
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
  const subjectPrompt = subjectPromptView(subject, defaults);
  return {
    ok: true,
    value: composePrompt(
      {
        general: row?.schoolPrompt ?? null,
        subject: subjectPrompt.text ?? subjectPrompt.defaultText,
        subjectSource: subjectPrompt.source === 'default' ? 'default' : 'custom',
        group: group?.extraPrompt ?? null,
      },
      values,
    ),
  };
}
