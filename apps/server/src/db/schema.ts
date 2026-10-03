import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Alle Zeitstempel sind Millisekunden seit 1970 (UTC). Die Tabellen enthalten keine Vorbelegung:
// Fächer, Untergruppen und Profilangaben legt der Nutzer selbst an.

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

/**
 * Lokales Profil, genau eine Zeile (id = 1). Die Angaben füllen später die Variablen der
 * Prompt-Schichten. Alles ist optional und nichts ist vorbelegt.
 */
export const profile = sqliteTable(
  'profile',
  {
    id: integer('id').primaryKey(),
    federalState: text('federal_state'),
    schoolType: text('school_type'),
    gradeLevel: text('grade_level'),
    onboardingCompletedAt: integer('onboarding_completed_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [check('profile_singleton', sql`${table.id} = 1`)],
);

export const subjects = sqliteTable(
  'subjects',
  {
    id: id(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('subjects_name_nocase').on(sql`lower(${table.name})`)],
);

/** Untergruppe eines Fachs (z. B. ein Themenblock). Wird mit dem Fach gelöscht. */
export const subjectGroups = sqliteTable(
  'subject_groups',
  {
    id: id(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('subject_groups_name_nocase').on(table.subjectId, sql`lower(${table.name})`),
  ],
);

export type Profile = typeof profile.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type SubjectGroup = typeof subjectGroups.$inferSelect;
