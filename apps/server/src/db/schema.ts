import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    /** Allgemeiner Schul-Prompt (Schicht 1), vom Nutzer geschrieben. Nie vorbelegt. */
    schoolPrompt: text('school_prompt'),
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
    /** Lehrkraft (Name oder Kürzel), optional. */
    teacher: text('teacher'),
    hoursPerWeek: integer('hours_per_week'),
    /** Kennung eines Linien-Icons der Oberfläche, optional. Unbekannte Kennungen zeigen das Standard-Icon. */
    icon: text('icon'),
    /** Fach-Prompt (Schicht 2), vom Nutzer geschrieben. Nie vorbelegt. */
    systemPrompt: text('system_prompt'),
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
    /** Art der Untergruppe in freien Worten (z. B. „Schulaufgabe“), optional. */
    kind: text('kind'),
    /** Zusatz der Untergruppe (Schicht 3), optional. */
    extraPrompt: text('extra_prompt'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('subject_groups_name_nocase').on(table.subjectId, sql`lower(${table.name})`),
  ],
);

/**
 * Modell-Anbieter. Der API-Schlüssel steht nicht hier, sondern im Secret-Speicher unter
 * `provider.<id>.key`. `models` ist eine JSON-Liste, die der Nutzer pflegt (siehe providers/models.ts).
 */
export const providers = sqliteTable(
  'providers',
  {
    id: id(),
    name: text('name').notNull(),
    /** Schnittstellenart. Bisher nur `openai-compatible`. */
    type: text('type').notNull().default('openai-compatible'),
    /** Voreinstellung, aus der der Eintrag entstand (nur zur Anzeige), oder `custom`. */
    preset: text('preset').notNull().default('custom'),
    baseUrl: text('base_url').notNull(),
    models: text('models').notNull().default('[]'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('providers_name_nocase').on(sql`lower(${table.name})`)],
);

/** Einstellungen als Schlüssel und JSON-Wert (z. B. Standardmodell und Fallback-Kette). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...timestamps,
});

/**
 * Zugangsdaten, genau eine Zeile (id = 1). Gespeichert wird nur der Hash des Passcodes,
 * nie der Passcode selbst. Gibt es keine Zeile, ist Pagewise noch nicht eingerichtet.
 */
export const authCredentials = sqliteTable(
  'auth_credentials',
  {
    id: integer('id').primaryKey(),
    passcodeHash: text('passcode_hash').notNull(),
    ...timestamps,
  },
  (table) => [check('auth_credentials_singleton', sql`${table.id} = 1`)],
);

/**
 * Angemeldete Sitzungen. Der Cookie enthält ein zufälliges Token, in der Datenbank steht nur
 * dessen SHA-256-Hash. So hilft eine Kopie der Datenbank niemandem, eine Sitzung zu übernehmen.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    csrfToken: text('csrf_token').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('sessions_expires_at').on(table.expiresAt)],
);

export type Profile = typeof profile.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type SubjectGroup = typeof subjectGroups.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
