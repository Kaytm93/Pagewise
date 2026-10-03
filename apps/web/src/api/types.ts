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
  teacher: string | null;
  hoursPerWeek: number | null;
  icon: string | null;
  position: number;
  groups: Group[];
  /** Eigene Modellwahl des Fachs, `null`: es gilt das Standardmodell. */
  model: Selection | null;
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
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  models?: ModelEntry[];
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

export interface PromptPreview {
  system: string;
  layers: { layer: 0 | 1 | 2 | 3; text: string }[];
  /** Platzhalter, für die im Profil oder im Namen nichts hinterlegt ist. */
  missing: string[];
}

export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error' | 'interrupted';

export interface ChatMessage {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  providerId: string | null;
  model: string | null;
  /** Fehlercode einer fehlgeschlagenen Antwort, nie ein Text des Anbieters. */
  errorCode: string | null;
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
    }
  | { type: 'model'; providerId: string; model: string }
  | { type: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'stopped'; message: ChatMessage }
  | { type: 'failed'; code: string; message: ChatMessage };
