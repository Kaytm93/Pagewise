import type { Profile, Subject } from '../api/types';

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type Override = (request: RecordedRequest) => Response | undefined;

export const TEST_PASSCODE = 'ein erfundener Beispiel-Passcode';
export const TEST_SETUP_CODE = 'ABCDE-FGHJK';
export const TEST_CSRF = 'csrf-token-nur-fuer-tests';

export function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

let counter = 0;
const nextId = () => `id-${++counter}`;

/** Kleiner Ersatz für den Server: hält Zustand im Speicher und prüft, dass der Client das CSRF-Token schickt. */
export class FakeServer {
  state: 'setup' | 'locked' | 'unlocked';
  unreachable = false;
  profile: Profile = {
    federalState: null,
    schoolType: null,
    gradeLevel: null,
    onboardingCompleted: true,
  };
  subjects: Subject[] = [];
  templates = [{ name: 'Beispielfach A' }, { name: 'Beispielfach B' }];
  requests: RecordedRequest[] = [];
  private overrides: Override[] = [];

  constructor(state: 'setup' | 'locked' | 'unlocked' = 'unlocked') {
    this.state = state;
  }

  /** Beantwortet passende Anfragen einmalig mit einer festen Antwort. */
  replyOnce(method: string, path: string, response: () => Response): void {
    let used = false;
    this.overrides.push((request) => {
      if (used || request.method !== method || request.path !== path) return undefined;
      used = true;
      return response();
    });
  }

  addSubject(name: string, extra: Partial<Subject> = {}): Subject {
    const subject: Subject = {
      id: nextId(),
      name,
      teacher: null,
      hoursPerWeek: null,
      icon: null,
      position: this.subjects.length,
      groups: [],
      ...extra,
    };
    this.subjects.push(subject);
    return subject;
  }

  calls(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.unreachable) throw new TypeError('Failed to fetch');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const request: RecordedRequest = { method, path, body, headers };
    this.requests.push(request);

    for (const override of this.overrides) {
      const response = override(request);
      if (response) return response;
    }
    return this.handle(request);
  };

  private handle({ method, path, body, headers }: RecordedRequest): Response {
    const data = (body ?? {}) as Record<string, unknown>;

    if (method === 'GET' && path === '/api/session') {
      return this.state === 'unlocked'
        ? json(200, { state: 'unlocked', csrfToken: TEST_CSRF })
        : json(200, { state: this.state });
    }
    if (method === 'POST' && path === '/api/auth/setup') {
      if (this.state !== 'setup') return json(409, { error: 'already_configured' });
      if (data.setupCode !== TEST_SETUP_CODE) return json(403, { error: 'invalid_setup_code' });
      this.state = 'unlocked';
      return json(201, { csrfToken: TEST_CSRF });
    }
    if (method === 'POST' && path === '/api/auth/login') {
      if (data.passcode !== TEST_PASSCODE) return json(401, { error: 'invalid_passcode' });
      this.state = 'unlocked';
      return json(200, { csrfToken: TEST_CSRF });
    }

    if (this.state !== 'unlocked') return json(401, { error: 'unauthorized' });
    if (method !== 'GET' && headers.get('x-csrf-token') !== TEST_CSRF) {
      return json(403, { error: 'csrf' });
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      this.state = 'locked';
      return json(204);
    }
    if (method === 'POST' && path === '/api/auth/passcode') {
      if (data.current !== TEST_PASSCODE) return json(403, { error: 'invalid_passcode' });
      return json(204);
    }

    if (method === 'GET' && path === '/api/profile') return json(200, this.profile);
    if (method === 'PATCH' && path === '/api/profile') {
      this.profile = { ...this.profile, ...data };
      return json(200, this.profile);
    }
    if (method === 'POST' && path === '/api/onboarding/complete') {
      this.profile = { ...this.profile, onboardingCompleted: true };
      return json(200, this.profile);
    }

    if (method === 'GET' && path === '/api/subjects') return json(200, { subjects: this.subjects });
    if (method === 'GET' && path === '/api/subjects/templates') {
      return json(200, { subjects: this.templates });
    }
    if (method === 'POST' && path === '/api/subjects') return this.createSubject(data);
    if (method === 'POST' && path === '/api/subjects/import') return this.importSubjects(data);

    const subjectMatch = /^\/api\/subjects\/([^/]+)$/.exec(path);
    if (subjectMatch) return this.subject(method, subjectMatch[1] as string, data);
    const groupsMatch = /^\/api\/subjects\/([^/]+)\/groups$/.exec(path);
    if (groupsMatch && method === 'POST') return this.createGroup(groupsMatch[1] as string, data);
    const groupMatch = /^\/api\/groups\/([^/]+)$/.exec(path);
    if (groupMatch) return this.group(method, groupMatch[1] as string, data);

    return json(404, { error: 'not_found' });
  }

  private taken(name: string, ignoreId?: string): boolean {
    return this.subjects.some(
      (s) => s.id !== ignoreId && s.name.toLowerCase() === name.trim().toLowerCase(),
    );
  }

  private createSubject(data: Record<string, unknown>): Response {
    const name = String(data.name ?? '').trim();
    if (!name) return json(400, { error: 'invalid_input', field: 'name' });
    if (this.taken(name)) return json(409, { error: 'name_taken' });
    const subject = this.addSubject(name, {
      teacher: (data.teacher as string | null | undefined) || null,
      hoursPerWeek: (data.hoursPerWeek as number | null | undefined) ?? null,
      icon: (data.icon as string | null | undefined) ?? null,
    });
    return json(201, subject);
  }

  private importSubjects(data: Record<string, unknown>): Response {
    let entries: { name?: string; teacher?: string; hours_per_week?: number }[];
    try {
      const parsed = JSON.parse(String(data.content)) as { subjects?: typeof entries };
      entries = parsed.subjects ?? [];
    } catch {
      return json(400, { error: 'invalid_input', field: 'content', reason: 'invalid_format' });
    }
    let created = 0;
    let skipped = 0;
    let invalid = 0;
    for (const entry of entries) {
      if (!entry.name) invalid += 1;
      else if (this.taken(entry.name)) skipped += 1;
      else {
        this.addSubject(entry.name, {
          teacher: entry.teacher ?? null,
          hoursPerWeek: entry.hours_per_week ?? null,
        });
        created += 1;
      }
    }
    return json(200, { created, skipped, invalid, subjects: this.subjects });
  }

  private subject(method: string, id: string, data: Record<string, unknown>): Response {
    const subject = this.subjects.find((s) => s.id === id);
    if (!subject) return json(404, { error: 'not_found' });
    if (method === 'DELETE') {
      this.subjects = this.subjects.filter((s) => s.id !== id);
      return json(204);
    }
    if (method === 'PATCH') {
      if (typeof data.name === 'string') {
        if (!data.name.trim()) return json(400, { error: 'invalid_input', field: 'name' });
        if (this.taken(data.name, id)) return json(409, { error: 'name_taken' });
        subject.name = data.name.trim();
      }
      if ('teacher' in data) subject.teacher = (data.teacher as string | null) || null;
      if ('hoursPerWeek' in data) subject.hoursPerWeek = data.hoursPerWeek as number | null;
      if ('icon' in data) subject.icon = data.icon as string | null;
      return json(200, subject);
    }
    return json(404, { error: 'not_found' });
  }

  private createGroup(subjectId: string, data: Record<string, unknown>): Response {
    const subject = this.subjects.find((s) => s.id === subjectId);
    if (!subject) return json(404, { error: 'not_found' });
    const name = String(data.name ?? '').trim();
    if (!name) return json(400, { error: 'invalid_input', field: 'name' });
    if (subject.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return json(409, { error: 'name_taken' });
    }
    const group = {
      id: nextId(),
      name,
      kind: (data.kind as string | null | undefined) || null,
      position: subject.groups.length,
    };
    subject.groups.push(group);
    return json(201, group);
  }

  private group(method: string, id: string, data: Record<string, unknown>): Response {
    for (const subject of this.subjects) {
      const group = subject.groups.find((g) => g.id === id);
      if (!group) continue;
      if (method === 'DELETE') {
        subject.groups = subject.groups.filter((g) => g.id !== id);
        return json(204);
      }
      if (method === 'PATCH') {
        if (typeof data.name === 'string') {
          const name = data.name.trim();
          if (!name) return json(400, { error: 'invalid_input', field: 'name' });
          if (
            subject.groups.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())
          ) {
            return json(409, { error: 'name_taken' });
          }
          group.name = name;
        }
        if ('kind' in data) group.kind = (data.kind as string | null) || null;
        return json(200, group);
      }
    }
    return json(404, { error: 'not_found' });
  }
}
