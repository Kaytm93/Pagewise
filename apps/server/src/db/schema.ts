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
    /** Dürfen Bilder an diesen Anbieter gehen? Aus: Der Chat sendet nur Text (Abschnitt „Daten an Dritte“). */
    sendImages: integer('send_images', { mode: 'boolean' }).notNull().default(true),
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
 * Profile für den Agent-CLI-Adapter (Phase 1e): Mit welchem Zugang startet Pagewise das Programm „claude“?
 * Zugangsdaten stehen nie hier, sondern im Secret-Speicher unter `engine.<id>.token`. Das Claude-Abo hat
 * gar keine: Die Anmeldung macht die Person selbst in der CLI, Pagewise fasst keine Tokens an.
 */
export const engineProfiles = sqliteTable(
  'engine_profiles',
  {
    id: id(),
    kind: text('kind', {
      enum: ['claude-subscription', 'glm-coding-plan', 'anthropic-api'],
    }).notNull(),
    name: text('name').notNull(),
    /** Modell (bei GLM für alle Stufen), `NULL`: Voreinstellung des Profils. */
    model: text('model'),
    /** Höchste Laufzeit eines Auftrags in Minuten. */
    timeoutMinutes: integer('timeout_minutes').notNull().default(20),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('engine_profiles_name_nocase').on(sql`lower(${table.name})`)],
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
    /**
     * Eigener Fach-Prompt (Schicht 2), vom Nutzer geschrieben. `NULL` heißt „Standard aktiv“: Es gilt der
     * mitgelieferte Standardtext des Fachs (D-034). Ein eigener Text verdrängt ihn.
     */
    systemPrompt: text('system_prompt'),
    /** Schlüssel der Katalogvorlage, aus der das Fach entstand (verknüpft den Standard-Prompt), sonst `NULL`. */
    templateKey: text('template_key'),
    /** `default` ist das eingebaute Fach „Standard“ für den fachunabhängigen Chat (nicht löschbar, genau eines). */
    kind: text('kind', { enum: ['subject', 'default'] })
      .notNull()
      .default('subject'),
    /** Gewähltes Modell für dieses Fach (Anbieter und Modell zusammen), sonst gilt das Standardmodell. */
    modelProviderId: text('model_provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    modelId: text('model_id'),
    /** Gewählter Agent-CLI-Zugang für das Fach. Hat das Fach eine, gilt sie statt des Modells. */
    engineProfileId: text('engine_profile_id').references(() => engineProfiles.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('subjects_name_nocase').on(sql`lower(${table.name})`),
    uniqueIndex('subjects_single_default').on(table.kind).where(sql`${table.kind} = 'default'`),
  ],
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
 * Ein Gespräch. Es gehört zu genau einem Fach und optional zu einer Untergruppe dieses Fachs; wird die
 * Untergruppe gelöscht, bleibt der Chat im Fach. Ohne eigene Modellwahl gilt die des Fachs, dann der Standard.
 */
export const chats = sqliteTable(
  'chats',
  {
    id: id(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => subjectGroups.id, { onDelete: 'set null' }),
    /** Leer, bis die erste Nachricht gesendet ist; die Oberfläche zeigt dann „Neuer Chat“. */
    title: text('title').notNull().default(''),
    modelProviderId: text('model_provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    modelId: text('model_id'),
    /** Eigener Agent-CLI-Zugang des Chats (hat Vorrang vor Modell und Wahl des Fachs). */
    engineProfileId: text('engine_profile_id').references(() => engineProfiles.id, {
      onDelete: 'set null',
    }),
    /** Sitzung des Agenten, damit der nächste Auftrag im selben Gespräch weiterläuft (`--resume`). */
    agentSessionId: text('agent_session_id'),
    ...timestamps,
  },
  (table) => [
    index('chats_subject_updated').on(table.subjectId, table.updatedAt),
    index('chats_group').on(table.groupId),
  ],
);

/**
 * Nachrichten eines Chats in der Reihenfolge `seq`. Antworten des Modells werden unverändert als Text
 * gespeichert und erst beim Anzeigen bereinigt. Ein Fehler steht nur als Code, nie als Text des Anbieters.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull().default(''),
    status: text('status', {
      enum: ['complete', 'streaming', 'stopped', 'error', 'interrupted'],
    })
      .notNull()
      .default('complete'),
    /** Was geantwortet hat (nur Anzeige, bewusst ohne Fremdschlüssel: der Verlauf bleibt, wenn der Anbieter geht). */
    providerId: text('provider_id'),
    model: text('model'),
    /** Zugang, über den ein Agent geantwortet hat (nur Anzeige, ohne Fremdschlüssel wie `provider_id`). */
    engineProfileId: text('engine_profile_id'),
    /** Was der Agent getan hat (Werkzeug und Ziel, JSON-Liste), nie Inhalte. `NULL` bei Antworten ohne Agent. */
    activity: text('activity'),
    errorCode: text('error_code'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('messages_chat_seq').on(table.chatId, table.seq),
    check('messages_role', sql`${table.role} in ('user', 'assistant')`),
    check(
      'messages_status',
      sql`${table.status} in ('complete', 'streaming', 'stopped', 'error', 'interrupted')`,
    ),
  ],
);

/**
 * Dateien, die ein Agent in seinem Arbeitsordner erzeugt hat und die Pagewise übernommen hat. Die Datei
 * selbst liegt im Datenverzeichnis unter `assets/<id>`; hier stehen nur Angaben dazu. Mit dem Chat oder der
 * Nachricht verschwindet die Zeile, die Datei räumt `AssetService` weg.
 */
export const assets = sqliteTable(
  'assets',
  {
    id: id(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** Art zur Anzeige (pdf, pptx, bild, text, sonstiges). */
    kind: text('kind').notNull(),
    /** Von Pagewise festgelegt (nach der Endung), nie vom Agenten. */
    mime: text('mime').notNull(),
    /** Bereinigter Dateiname zum Herunterladen. */
    name: text('name').notNull(),
    size: integer('size').notNull(),
    ...timestamps,
  },
  (table) => [index('assets_message').on(table.messageId), index('assets_chat').on(table.chatId)],
);

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
export type ChatRow = typeof chats.$inferSelect;
export type EngineProfileRow = typeof engineProfiles.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
