export type SessionInfo =
  | { state: 'setup' }
  | { state: 'locked' }
  | { state: 'unlocked'; csrfToken: string };

export interface Group {
  id: string;
  name: string;
  kind: string | null;
  position: number;
}

export interface Subject {
  id: string;
  name: string;
  /** `default` ist das eingebaute Fach „Standard“ für den fachunabhängigen Chat (nicht änderbar, nicht löschbar). */
  kind: 'subject' | 'default';
  /** Schlüssel der Katalogvorlage, aus der das Fach entstand (verknüpft den Standard-Prompt), sonst `null`. */
  templateKey: string | null;
  /** Fachfarbe 0 bis 7 (gedämpfte Töne der Oberfläche); `null` für das eingebaute Fach „Standard“. */
  color: number | null;
  teacher: string | null;
  hoursPerWeek: number | null;
  icon: string | null;
  position: number;
  groups: Group[];
  /** Eigene Modellwahl des Fachs, `null`: es gilt das Standardmodell. */
  model: Selection | null;
  /** Gewählter Agent-CLI-Zugang des Fachs (statt eines Modells), sonst `null`. */
  engineProfileId: string | null;
}

export interface Profile {
  federalState: string | null;
  schoolType: string | null;
  gradeLevel: string | null;
  onboardingCompleted: boolean;
}

export type ProfilePatch = Partial<Pick<Profile, 'federalState' | 'schoolType' | 'gradeLevel'>>;

export interface SubjectInput {
  name: string;
  teacher?: string | null;
  hoursPerWeek?: number | null;
  icon?: string | null;
  /** Fachfarbe 0 bis 7. Ohne Angabe wählt der Server die am seltensten genutzte. */
  color?: number;
  /** Schlüssel der Katalogvorlage, aus der das Fach angelegt wird. */
  templateKey?: string;
}

/** Die Fächer des Nutzers und das eingebaute Fach „Standard“ (immer vorhanden). */
export interface SubjectList {
  subjects: Subject[];
  defaultSubject: Subject;
}

export interface TemplateCategory {
  id: string;
  name: string;
}

/** Eine Fachvorlage des Katalogs: nur Name, Kategorie, Symbol und Suchbegriffe, nichts Persönliches. */
export interface SubjectTemplate {
  /** `null` bei Katalogen im alten Format: solche Vorlagen haben keinen Standard-Prompt. */
  key: string | null;
  name: string;
  category: string | null;
  icon: string | null;
  aliases: string[];
}

export interface SubjectCatalog {
  categories: TemplateCategory[];
  subjects: SubjectTemplate[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  invalid: number;
  subjects: Subject[];
}

export type PresetId = 'openrouter' | 'zai' | 'ollama' | 'lmstudio' | 'custom';

/** Ein Modell eines Anbieters mit den Fähigkeiten, die Pagewise kennen muss. */
export interface ModelEntry {
  id: string;
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  streaming: boolean;
}

export interface ProviderModel extends ModelEntry {
  /** Kostenloses Modell: der Anbieter kann Eingaben protokollieren. */
  free: boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: 'openai-compatible';
  preset: PresetId;
  baseUrl: string;
  models: ProviderModel[];
  /** Bilder an diesen Anbieter senden? Aus: nur Text verlässt den Rechner. */
  sendImages: boolean;
  /** Darf das Modell Stundenplan und Tests über Werkzeuge einsehen? Aus: diese Daten gehen nie an den Anbieter. */
  allowTools: boolean;
  hasKey: boolean;
  /** Letzte vier Zeichen, nur bei langen Schlüsseln. Der Schlüssel selbst kommt nie an. */
  keyHint: string | null;
  warning: 'coding_plan' | null;
}

export interface ProviderPreset {
  id: PresetId;
  baseUrl: string;
  requiresKey: boolean;
  models: ModelEntry[];
}

export interface ProviderInput {
  name: string;
  preset: PresetId;
  baseUrl?: string;
  apiKey?: string;
  models?: ModelEntry[];
  sendImages?: boolean;
  allowTools?: boolean;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  models?: ModelEntry[];
  sendImages?: boolean;
  allowTools?: boolean;
  apiKey?: string;
  clearKey?: boolean;
}

export interface Selection {
  providerId: string;
  model: string;
}

export interface ModelSettings {
  default: Selection | null;
  fallback: Selection[];
}

export type TestOutcome =
  | { ok: true; latencyMs: number; modelCount: number | null }
  | { ok: false; code: string };

export interface AvailableModel {
  id: string;
  name: string | null;
  vision: boolean | null;
  tools: boolean | null;
  reasoning: boolean | null;
  free: boolean;
}

export type PromptScope =
  | { type: 'general' }
  | { type: 'subject'; id: string }
  | { type: 'group'; id: string };

/**
 * Stand einer Prompt-Ebene. `text` ist der eigene Text (`null`: keiner), `defaultText` der mitgelieferte
 * Standardtext des Fachs (nur beim Fach-Prompt, sonst `null`). `source` sagt, was im Chat gilt.
 */
export interface PromptState {
  text: string | null;
  defaultText: string | null;
  source: 'custom' | 'default' | 'none';
}

export interface PromptPreview {
  system: string;
  layers: { layer: 0 | 1 | 2 | 3; text: string; origin: 'code' | 'default' | 'custom' }[];
  /** Platzhalter, für die im Profil oder im Namen nichts hinterlegt ist. */
  missing: string[];
}

export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error' | 'interrupted';

/** Ein Schritt eines Agenten: Werkzeug und Ziel (Datei oder Anfang des Befehls), nie Inhalte. */
export interface ActivityEntry {
  id: string;
  /** Name des Werkzeugs, z. B. „Write“ oder „Bash“. */
  tool: string;
  target: string | null;
  state: 'running' | 'done' | 'error';
}

/** Eine Datei, die ein Agent erzeugt hat. Der Download läuft über `api.assetUrl(id)`. */
export interface ChatAsset {
  id: string;
  name: string;
  kind: 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'image' | 'text';
  mime: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  providerId: string | null;
  model: string | null;
  /** Zugang, über den ein Agent geantwortet hat, sonst `null`. */
  engineProfileId: string | null;
  /** Fehlercode einer fehlgeschlagenen Antwort, nie ein Text des Anbieters. */
  errorCode: string | null;
  /** Was der Agent getan hat. Leer bei Antworten von Modellen. */
  activity: ActivityEntry[];
  /** Dateien, die der Agent erzeugt hat. */
  assets: ChatAsset[];
  createdAt: number;
}

export interface Chat {
  id: string;
  subjectId: string;
  /** `null`: der Chat liegt im Fach selbst, nicht in einer Untergruppe. */
  groupId: string | null;
  /** Leer, solange noch nichts gesendet wurde. */
  title: string;
  /** Eigene Modellwahl des Chats, `null`: es gilt die des Fachs, dann das Standardmodell. */
  model: Selection | null;
  /** Eigener Agent-CLI-Zugang des Chats (statt eines Modells), `null`: es gilt die Wahl des Fachs. */
  engineProfileId: string | null;
  generating: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDetail extends Chat {
  messages: ChatMessage[];
}

/** Ereignisse einer laufenden Antwort (Server-Sent Events). */
export type StreamEvent =
  | { type: 'start'; userMessage: ChatMessage | null; assistantMessage: ChatMessage }
  | {
      type: 'snapshot';
      assistantMessageId: string;
      text: string;
      model: Selection | null;
      thinking: boolean;
      activity: ActivityEntry[];
    }
  | { type: 'model'; providerId: string; model: string }
  | { type: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'done'; message: ChatMessage }
  | { type: 'stopped'; message: ChatMessage }
  | { type: 'failed'; code: string; message: ChatMessage };

// --- Stundenplan und Tests (Welle 3) ----------------------------------------------------------------

export type WeekKind = 'all' | 'a' | 'b';

/** Eine Stunde im Stundenplan. Zeiten sind frei (`HH:MM`), `weekday` 1 = Montag bis 7 = Sonntag. */
export interface TimetableEntry {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  /** `null`: ohne Fach, oder das Fach wurde gelöscht. */
  subjectId: string | null;
  room: string | null;
  note: string | null;
  week: WeekKind;
}

export type TimetableInput = Omit<TimetableEntry, 'id'>;

/** Eine bekannte Woche („diese Woche ist A“): ihr Montag und ihre Art. */
export interface WeekAnchor {
  monday: string;
  week: 'a' | 'b';
}

export interface TimetableData {
  entries: TimetableEntry[];
  weekAnchor: WeekAnchor | null;
}

/** Ein Testeintrag (Schulaufgabe, Test, Ex, Referat …). `date` ist `YYYY-MM-DD`. */
export interface Exam {
  id: string;
  subjectId: string;
  kind: string;
  title: string | null;
  date: string;
  time: string | null;
  topics: string | null;
  notes: string | null;
}

export type ExamInput = Omit<Exam, 'id'>;

// --- Hefteinträge (Phase 1b) -----------------------------------------------------------------------

/** Ein Hefteintrag in Listen: ohne den ganzen Text, mit einem kurzen Auszug. Zeiten in Millisekunden. */
export interface NoteSummary {
  id: string;
  subjectId: string;
  groupId: string | null;
  title: string;
  pinned: boolean;
  tags: string[];
  excerpt: string;
  /** Der Chat, aus dem der Eintrag stammt, solange es ihn gibt. */
  sourceChatId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Note extends NoteSummary {
  markdown: string;
}

export interface NoteInput {
  subjectId: string;
  groupId?: string | null;
  title: string;
  markdown?: string;
  pinned?: boolean;
  tags?: string[];
}

export type NotePatch = Partial<Pick<Note, 'title' | 'markdown' | 'pinned' | 'tags' | 'groupId'>>;

// --- Agent-CLI (Phase 1e) -----------------------------------------------------------------------

export type EngineKind = 'claude-subscription' | 'glm-coding-plan' | 'anthropic-api';

/** Ein Zugang, mit dem Pagewise das Programm „claude“ startet. Der Schlüssel kommt nie zur Oberfläche. */
export interface EngineProfile {
  id: string;
  kind: EngineKind;
  name: string;
  /** Eigene Modellwahl, `null`: Voreinstellung der Art. */
  model: string | null;
  timeoutMinutes: number;
  hasToken: boolean;
  /** Letzte vier Zeichen, nur bei langen Schlüsseln. */
  tokenHint: string | null;
  position: number;
  createdAt: number;
}

export interface EngineKindInfo {
  kind: EngineKind;
  needsToken: boolean;
  defaultModel: string | null;
  /** Adresse, an die das Programm mit diesem Zugang spricht (nur wenn sie von der Voreinstellung abweicht). */
  endpoint: string | null;
}

export interface EnginesInfo {
  kinds: EngineKindInfo[];
  profiles: EngineProfile[];
}

export interface CliStatus {
  state: 'ready' | 'missing' | 'broken';
  path: string | null;
  version: string | null;
  /** Kandidaten, die geprüft wurden und nicht starten. */
  skipped: { path: string; reason: string }[];
}

export interface EngineInput {
  kind: EngineKind;
  name: string;
  model?: string | null;
  timeoutMinutes?: number;
  token?: string;
}

export interface EnginePatch {
  name?: string;
  model?: string | null;
  timeoutMinutes?: number;
  token?: string;
}
