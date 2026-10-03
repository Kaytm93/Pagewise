import type { ApiClient } from './client';
import type {
  Group,
  ImportResult,
  Profile,
  ProfilePatch,
  SessionInfo,
  Subject,
  SubjectInput,
} from './types';

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
  };
}

export type Api = ReturnType<typeof createApi>;
