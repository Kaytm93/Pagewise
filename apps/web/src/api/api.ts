import type { ApiClient } from './client';
import type { SseMessage } from './sse';
import type {
  AvailableModel,
  Chat,
  ChatDetail,
  CliStatus,
  EngineInput,
  EnginePatch,
  EngineProfile,
  EnginesInfo,
  Exam,
  ExamInput,
  Group,
  ImportResult,
  ModelSettings,
  Profile,
  ProfilePatch,
  PromptPreview,
  PromptScope,
  PromptState,
  Provider,
  ProviderInput,
  ProviderPatch,
  ProviderPreset,
  Selection,
  SessionInfo,
  Subject,
  SubjectCatalog,
  SubjectInput,
  SubjectList,
  TestOutcome,
  TimetableData,
  TimetableEntry,
  TimetableInput,
  WeekAnchor,
} from './types';

function promptPath(scope: PromptScope): string {
  if (scope.type === 'general') return '/api/prompts/general';
  return `/api/prompts/${scope.type === 'subject' ? 'subjects' : 'groups'}/${scope.id}`;
}

interface PromptReply {
  text: string | null;
  defaultText?: string | null;
  source?: 'custom' | 'default' | 'none';
}

/** Allgemeiner Prompt und Untergruppen-Zusatz haben keinen Standardtext und liefern nur `text`. */
function toPromptState(reply: PromptReply): PromptState {
  return {
    text: reply.text,
    defaultText: reply.defaultText ?? null,
    source: reply.source ?? (reply.text === null ? 'none' : 'custom'),
  };
}

/** Alle Aufrufe der Oberfläche an den Server, an einer Stelle. */
export function createApi(client: ApiClient) {
  return {
    client,

    session: () => client.request<SessionInfo>('GET', '/api/session'),

    async setup(setupCode: string, passcode: string): Promise<void> {
      const reply = await client.request<{ csrfToken: string }>('POST', '/api/auth/setup', {
        setupCode,
        passcode,
      });
      client.setCsrfToken(reply.csrfToken);
    },

    async login(passcode: string): Promise<void> {
      const reply = await client.request<{ csrfToken: string }>('POST', '/api/auth/login', {
        passcode,
      });
      client.setCsrfToken(reply.csrfToken);
    },

    async logout(): Promise<void> {
      try {
        await client.request<void>('POST', '/api/auth/logout');
      } finally {
        client.setCsrfToken(null);
      }
    },

    changePasscode: (current: string, next: string) =>
      client.request<void>('POST', '/api/auth/passcode', { current, next }),

    /** „Alles löschen“. Verlangt den Passcode, auch bei bestehender Sitzung. */
    eraseAllData: (passcode: string) =>
      client.request<void>('POST', '/api/data/erase', { passcode }),

    profile: () => client.request<Profile>('GET', '/api/profile'),
    updateProfile: (patch: ProfilePatch) => client.request<Profile>('PATCH', '/api/profile', patch),
    completeOnboarding: () => client.request<Profile>('POST', '/api/onboarding/complete'),

    subjects: () => client.request<SubjectList>('GET', '/api/subjects'),
    createSubject: (input: SubjectInput) => client.request<Subject>('POST', '/api/subjects', input),
    updateSubject: (id: string, patch: Partial<SubjectInput>) =>
      client.request<Subject>('PATCH', `/api/subjects/${id}`, patch),
    deleteSubject: (id: string) => client.request<void>('DELETE', `/api/subjects/${id}`),
    importSubjects: (format: 'json' | 'csv', content: string) =>
      client.request<ImportResult>('POST', '/api/subjects/import', { format, content }),
    subjectTemplates: () => client.request<SubjectCatalog>('GET', '/api/subjects/templates'),

    createGroup: (subjectId: string, input: { name: string; kind?: string | null }) =>
      client.request<Group>('POST', `/api/subjects/${subjectId}/groups`, input),
    updateGroup: (id: string, patch: { name?: string; kind?: string | null }) =>
      client.request<Group>('PATCH', `/api/groups/${id}`, patch),
    deleteGroup: (id: string) => client.request<void>('DELETE', `/api/groups/${id}`),

    async providers(): Promise<Provider[]> {
      const reply = await client.request<{ providers: Provider[] }>('GET', '/api/providers');
      return reply.providers;
    },
    async providerPresets(): Promise<ProviderPreset[]> {
      const reply = await client.request<{ presets: ProviderPreset[] }>(
        'GET',
        '/api/provider-presets',
      );
      return reply.presets;
    },
    createProvider: (input: ProviderInput) =>
      client.request<Provider>('POST', '/api/providers', input),
    updateProvider: (id: string, patch: ProviderPatch) =>
      client.request<Provider>('PATCH', `/api/providers/${id}`, patch),
    deleteProvider: (id: string) => client.request<void>('DELETE', `/api/providers/${id}`),
    testProvider: (id: string) => client.request<TestOutcome>('POST', `/api/providers/${id}/test`),
    async availableModels(id: string): Promise<AvailableModel[]> {
      const reply = await client.request<{ models: AvailableModel[] }>(
        'GET',
        `/api/providers/${id}/available-models`,
      );
      return reply.models;
    },
    modelSettings: () => client.request<ModelSettings>('GET', '/api/model-settings'),
    saveModelSettings: (settings: ModelSettings) =>
      client.request<ModelSettings>('PUT', '/api/model-settings', settings),

    /** Stand einer Prompt-Ebene. Nur der Fach-Prompt hat einen Standardtext (`defaultText`). */
    async prompt(scope: PromptScope): Promise<PromptState> {
      return toPromptState(await client.request<PromptReply>('GET', promptPath(scope)));
    },
    /** Speichert den eigenen Text. `null` oder leer setzt den Fach-Prompt auf den Standard zurück. */
    async savePrompt(scope: PromptScope, text: string | null): Promise<PromptState> {
      return toPromptState(await client.request<PromptReply>('PUT', promptPath(scope), { text }));
    },
    async chats(subjectId: string, groupId: string | null): Promise<Chat[]> {
      const query = `subjectId=${subjectId}${groupId ? `&groupId=${groupId}` : ''}`;
      const reply = await client.request<{ chats: Chat[] }>('GET', `/api/chats?${query}`);
      return reply.chats;
    },
    createChat: (subjectId: string, groupId: string | null) =>
      client.request<Chat>('POST', '/api/chats', { subjectId, groupId }),
    chat: (id: string) => client.request<ChatDetail>('GET', `/api/chats/${id}`),
    updateChat: (
      id: string,
      patch: { title?: string; model?: Selection | null; engineProfileId?: string | null },
    ) => client.request<Chat>('PATCH', `/api/chats/${id}`, patch),
    deleteChat: (id: string) => client.request<void>('DELETE', `/api/chats/${id}`),
    stopChat: (id: string) => client.request<void>('POST', `/api/chats/${id}/stop`),
    setSubjectModel: (subjectId: string, model: Selection | null) =>
      client.request<Subject>('PUT', `/api/subjects/${subjectId}/model`, { model }),
    setSubjectEngine: (subjectId: string, engineProfileId: string | null) =>
      client.request<Subject>('PUT', `/api/subjects/${subjectId}/engine`, { engineProfileId }),

    // Agent-CLI: Zugänge (schnell) und das gefundene Programm (startet Programme, getrennt geladen)
    engines: () => client.request<EnginesInfo>('GET', '/api/engines'),
    createEngine: (input: EngineInput) =>
      client.request<EngineProfile>('POST', '/api/engines', input),
    updateEngine: (id: string, patch: EnginePatch) =>
      client.request<EngineProfile>('PATCH', `/api/engines/${id}`, patch),
    deleteEngine: (id: string) => client.request<void>('DELETE', `/api/engines/${id}`),
    async cliStatus(): Promise<CliStatus> {
      return (await client.request<{ cli: CliStatus }>('GET', '/api/engines/cli')).cli;
    },
    async detectCli(): Promise<CliStatus> {
      return (await client.request<{ cli: CliStatus }>('POST', '/api/engines/detect')).cli;
    },
    // Stundenplan, Tests und der Schalter für den Werkzeugzugriff der KI (Welle 3)
    timetable: () => client.request<TimetableData>('GET', '/api/timetable'),
    createTimetableEntry: (input: TimetableInput) =>
      client.request<TimetableEntry>('POST', '/api/timetable', input),
    updateTimetableEntry: (id: string, patch: Partial<TimetableInput>) =>
      client.request<TimetableEntry>('PATCH', `/api/timetable/${id}`, patch),
    deleteTimetableEntry: (id: string) => client.request<void>('DELETE', `/api/timetable/${id}`),
    /** Legt fest, welche Wochenart die Woche mit diesem Datum hat, oder hebt es mit `null` auf. */
    async setWeekAnchor(
      anchor: { date: string; week: 'a' | 'b' } | null,
    ): Promise<WeekAnchor | null> {
      return (
        await client.request<{ weekAnchor: WeekAnchor | null }>('PUT', '/api/timetable/week', {
          anchor,
        })
      ).weekAnchor;
    },
    async exams(): Promise<Exam[]> {
      return (await client.request<{ exams: Exam[] }>('GET', '/api/exams')).exams;
    },
    createExam: (input: ExamInput) => client.request<Exam>('POST', '/api/exams', input),
    updateExam: (id: string, patch: Partial<ExamInput>) =>
      client.request<Exam>('PATCH', `/api/exams/${id}`, patch),
    deleteExam: (id: string) => client.request<void>('DELETE', `/api/exams/${id}`),
    async toolsEnabled(): Promise<boolean> {
      return (await client.request<{ enabled: boolean }>('GET', '/api/tool-settings')).enabled;
    },
    async setToolsEnabled(enabled: boolean): Promise<boolean> {
      return (await client.request<{ enabled: boolean }>('PUT', '/api/tool-settings', { enabled }))
        .enabled;
    },

    /** Adresse zum Herunterladen einer Datei (gleiche Herkunft, Anmeldung per Cookie). */
    assetUrl: (id: string) => `/api/assets/${id}/download`,
    /** Sendet eine Nachricht und liest die Antwort als Strom mit. */
    sendMessage: (
      chatId: string,
      content: string,
      onMessage: (message: SseMessage) => void,
      signal?: AbortSignal,
    ) => client.stream('POST', `/api/chats/${chatId}/messages`, { content }, onMessage, signal),
    /**
     * Wiederholt die letzte Antwort, wenn sie fehlschlug, abgebrochen oder unterbrochen wurde. Mit `viaApi`
     * antwortet für diesen Versuch ein API-Modell statt des gewählten Agenten.
     */
    retryChat: (
      chatId: string,
      onMessage: (message: SseMessage) => void,
      signal?: AbortSignal,
      options: { viaApi?: boolean } = {},
    ) =>
      client.stream(
        'POST',
        `/api/chats/${chatId}/retry`,
        options.viaApi ? { viaApi: true } : undefined,
        onMessage,
        signal,
      ),
    /** Hängt sich an eine laufende Antwort an, z. B. nach dem Aufwecken des Geräts. */
    attachChat: (chatId: string, onMessage: (message: SseMessage) => void, signal?: AbortSignal) =>
      client.stream('GET', `/api/chats/${chatId}/generation`, undefined, onMessage, signal),

    promptPreview: (subjectId: string, groupId: string | null) =>
      client.request<PromptPreview>(
        'GET',
        `/api/prompts/preview?subjectId=${subjectId}${groupId ? `&groupId=${groupId}` : ''}`,
      ),
  };
}

export type Api = ReturnType<typeof createApi>;
