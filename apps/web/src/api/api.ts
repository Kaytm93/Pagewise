import type { ApiClient } from './client';
import type {
  AvailableModel,
  Group,
  ImportResult,
  ModelSettings,
  Profile,
  ProfilePatch,
  PromptPreview,
  PromptScope,
  Provider,
  ProviderInput,
  ProviderPatch,
  ProviderPreset,
  SessionInfo,
  Subject,
  SubjectInput,
  TestOutcome,
} from './types';

function promptPath(scope: PromptScope): string {
  if (scope.type === 'general') return '/api/prompts/general';
  return `/api/prompts/${scope.type === 'subject' ? 'subjects' : 'groups'}/${scope.id}`;
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

    profile: () => client.request<Profile>('GET', '/api/profile'),
    updateProfile: (patch: ProfilePatch) => client.request<Profile>('PATCH', '/api/profile', patch),
    completeOnboarding: () => client.request<Profile>('POST', '/api/onboarding/complete'),

    async subjects(): Promise<Subject[]> {
      const reply = await client.request<{ subjects: Subject[] }>('GET', '/api/subjects');
      return reply.subjects;
    },
    createSubject: (input: SubjectInput) => client.request<Subject>('POST', '/api/subjects', input),
    updateSubject: (id: string, patch: Partial<SubjectInput>) =>
      client.request<Subject>('PATCH', `/api/subjects/${id}`, patch),
    deleteSubject: (id: string) => client.request<void>('DELETE', `/api/subjects/${id}`),
    importSubjects: (format: 'json' | 'csv', content: string) =>
      client.request<ImportResult>('POST', '/api/subjects/import', { format, content }),
    subjectTemplates: () =>
      client.request<{ subjects: { name: string }[] }>('GET', '/api/subjects/templates'),

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

    async prompt(scope: PromptScope): Promise<string | null> {
      const reply = await client.request<{ text: string | null }>('GET', promptPath(scope));
      return reply.text;
    },
    async savePrompt(scope: PromptScope, text: string | null): Promise<string | null> {
      const reply = await client.request<{ text: string | null }>('PUT', promptPath(scope), {
        text,
      });
      return reply.text;
    },
    promptPreview: (subjectId: string, groupId: string | null) =>
      client.request<PromptPreview>(
        'GET',
        `/api/prompts/preview?subjectId=${subjectId}${groupId ? `&groupId=${groupId}` : ''}`,
      ),
  };
}

export type Api = ReturnType<typeof createApi>;
