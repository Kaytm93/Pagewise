import type {
  ActivityEntry,
  AvailableModel,
  Chat,
  ChatMessage,
  CliStatus,
  EngineKindInfo,
  EngineProfile,
  Exam,
  ModelEntry,
  ModelSettings,
  Note,
  Profile,
  PromptPreview,
  Provider,
  ProviderPreset,
  Selection,
  Subject,
  SubjectCatalog,
  TestOutcome,
  TimetableEntry,
  WeekAnchor,
} from '../api/types';

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
  signal?: AbortSignal | null;
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

const encoder = new TextEncoder();

/**
 * Eine laufende Antwort im Server-Ersatz. Der Test steuert sie von Hand (`delta`, `finish`, `fail`,
 * `stop`, `drop`), so lassen sich Strom, Abbruch und Verbindungsverlust genau nachstellen.
 */
export class FakeGeneration {
  text = '';
  thinkingSeen = false;
  model: Selection | null = null;
  steps: ActivityEntry[] = [];
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(
    private readonly server: FakeServer,
    readonly chatId: string,
    readonly assistant: ChatMessage,
  ) {}

  /** Neuer Strom für einen Zuhörer; schickt zuerst `snapshot` (und `start`, wenn angegeben). */
  open(signal?: AbortSignal | null, start?: { user: ChatMessage | null }): Response {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: () => {
        this.streams.delete(controller);
      },
    });
    this.streams.add(controller);
    signal?.addEventListener('abort', () => {
      if (!this.streams.delete(controller)) return;
      controller.error(new DOMException('aborted', 'AbortError'));
    });
    if (start) {
      this.write(controller, 'start', {
        userMessage: start.user,
        assistantMessage: this.assistant,
      });
    }
    this.write(controller, 'snapshot', {
      assistantMessageId: this.assistant.id,
      text: this.text,
      model: this.model,
      thinking: this.thinkingSeen,
      activity: this.steps,
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  /** Anzahl offener Ströme. */
  get listeners(): number {
    return this.streams.size;
  }

  private write(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ) {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  emit(event: string, data: unknown) {
    for (const controller of this.streams) this.write(controller, event, data);
  }

  setModel(selection: Selection) {
    this.model = selection;
    this.emit('model', selection);
  }

  thinking() {
    this.thinkingSeen = true;
    this.emit('thinking', {});
  }

  delta(text: string) {
    this.text += text;
    this.emit('delta', { text });
  }

  /** Ein Werkzeugaufruf eines Agenten beginnt oder endet (gleiche `id` ersetzt den früheren Stand). */
  activity(entry: ActivityEntry) {
    const index = this.steps.findIndex((item) => item.id === entry.id);
    if (index === -1) this.steps = [...this.steps, entry];
    else this.steps = this.steps.map((item, at) => (at === index ? entry : item));
    this.emit('activity', { entry });
  }

  private end(event: 'done' | 'stopped' | 'failed', patch: Partial<ChatMessage>, extra = {}) {
    const message: ChatMessage = {
      ...this.assistant,
      content: this.text,
      providerId: this.model?.providerId ?? null,
      model: this.model?.model ?? null,
      activity: this.steps.map((entry) =>
        entry.state === 'running' ? { ...entry, state: 'done' as const } : entry,
      ),
      ...patch,
    };
    this.server.settle(this.chatId, message);
    this.emit(event, { message, ...extra });
    this.close();
  }

  finish(patch: Partial<ChatMessage> = {}) {
    this.end('done', { status: 'complete', ...patch });
  }

  stop() {
    this.end('stopped', { status: 'stopped' });
  }

  fail(code: string) {
    this.end('failed', { status: 'error', errorCode: code }, { code });
  }

  /** Beendet nur die Ströme, wie bei einem Verbindungsabbruch; die Antwort läuft weiter. */
  drop() {
    this.close();
  }

  private close() {
    for (const controller of this.streams) {
      try {
        controller.close();
      } catch {
        // schon geschlossen
      }
    }
    this.streams.clear();
  }
}

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
  /** Stundenplan, Tests, bekannte Woche und der Schalter für den Werkzeugzugriff der KI (Welle 3). */
  timetable: TimetableEntry[] = [];
  weekAnchor: WeekAnchor | null = null;
  exams: Exam[] = [];
  notes: Note[] = [];
  toolsEnabled = true;
  /** Das eingebaute Fach „Standard“, wie es der echte Server immer mitliefert. */
  defaultSubject: Subject = this.freshDefaultSubject();
  /** Katalog der Fachvorlagen (erfundene Namen). */
  catalog: SubjectCatalog = {
    categories: [
      { id: 'beispiele', name: 'Beispiele' },
      { id: 'weitere', name: 'Weitere Beispiele' },
    ],
    subjects: [
      {
        key: 'beispiel-a',
        name: 'Beispielfach A',
        category: 'beispiele',
        icon: 'book',
        aliases: ['Fach A'],
      },
      {
        key: 'beispiel-b',
        name: 'Beispielfach B',
        category: 'beispiele',
        icon: 'flask',
        aliases: [],
      },
      {
        key: 'beispiel-c',
        name: 'Übungsfach C',
        category: 'weitere',
        icon: null,
        aliases: ['Erdfach'],
      },
    ],
  };
  /** Mitgelieferte Standardtexte je Schlüssel der Vorlage (`standard`: Fach „Standard“, `_generic`: Rückfall). */
  defaultPrompts: Record<string, string> = {
    standard: 'Standardtext fachlos',
    'beispiel-a': 'Standardtext A für {{fach}}',
    _generic: 'Allgemeiner Standardtext für {{fach}}',
  };
  providers: Provider[] = [];
  /** Schlüssel liegen nur hier und werden in keiner Antwort herausgegeben, wie beim echten Server. */
  secrets = new Map<string, string>();
  modelSettings: ModelSettings = { default: null, fallback: [] };
  presets: ProviderPreset[] = [
    {
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      requiresKey: true,
      models: [
        { id: 'z-ai/glm-5.3-flash', vision: true, tools: true, reasoning: true, streaming: true },
        { id: 'openrouter/free', vision: true, tools: true, reasoning: true, streaming: true },
      ],
    },
    { id: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', requiresKey: true, models: [] },
    { id: 'ollama', baseUrl: 'http://localhost:11434/v1', requiresKey: false, models: [] },
    { id: 'lmstudio', baseUrl: 'http://localhost:1234/v1', requiresKey: false, models: [] },
    { id: 'custom', baseUrl: '', requiresKey: false, models: [] },
  ];
  /** Antwort auf den nächsten „Verbindung testen“-Aufruf. */
  testOutcome: TestOutcome = { ok: true, latencyMs: 42, modelCount: null };
  available: AvailableModel[] = [];
  prompts = new Map<string, string | null>();
  /** Zugänge für die Agent-CLI. Schlüssel liegen nur in `secrets`, nie in Antworten. */
  engines: EngineProfile[] = [];
  engineKinds: EngineKindInfo[] = [
    { kind: 'claude-subscription', needsToken: false, defaultModel: null, endpoint: null },
    {
      kind: 'glm-coding-plan',
      needsToken: true,
      defaultModel: 'glm-5.3-flash',
      endpoint: 'https://api.z.ai/api/anthropic',
    },
    { kind: 'anthropic-api', needsToken: true, defaultModel: null, endpoint: null },
  ];
  /** Das „gefundene“ Programm; ein Test kann es auf `missing` oder `broken` setzen. */
  cli: CliStatus = {
    state: 'ready',
    path: '/usr/local/bin/claude',
    version: '2.1.220',
    skipped: [],
  };
  chats: Chat[] = [];
  chatMessages = new Map<string, ChatMessage[]>();
  generations = new Map<string, FakeGeneration>();
  /** Wie oft „Alles löschen“ erfolgreich war. */
  erased = 0;
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

  private freshDefaultSubject(): Subject {
    return {
      id: nextId(),
      name: 'Standard',
      kind: 'default',
      templateKey: 'standard',
      color: null,
      teacher: null,
      hoursPerWeek: null,
      icon: null,
      position: -1,
      groups: [],
      model: null,
      engineProfileId: null,
    };
  }

  /** Alle Fächer einschließlich des eingebauten. */
  private allSubjects(): Subject[] {
    return [this.defaultSubject, ...this.subjects];
  }

  addGroup(subjectId: string, name: string): { id: string; name: string } {
    const subject = this.allSubjects().find((entry) => entry.id === subjectId);
    if (!subject) throw new Error('Fach unbekannt');
    const group = { id: nextId(), name, kind: null, position: subject.groups.length };
    subject.groups.push(group);
    return group;
  }

  addSubject(name: string, extra: Partial<Subject> = {}): Subject {
    const subject: Subject = {
      id: nextId(),
      name,
      kind: 'subject',
      templateKey: null,
      color: this.subjects.length % 8,
      teacher: null,
      hoursPerWeek: null,
      icon: null,
      position: this.subjects.length,
      groups: [],
      model: null,
      engineProfileId: null,
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
    const request: RecordedRequest = { method, path, body, headers, signal: init?.signal };
    this.requests.push(request);

    for (const override of this.overrides) {
      const response = override(request);
      if (response) return response;
    }
    return this.handle(request);
  };

  private handle({ method, path, body, headers, signal }: RecordedRequest): Response {
    const data = (body ?? {}) as Record<string, unknown>;

    if (method === 'GET' && path === '/api/health') {
      return json(200, { status: 'ok', version: 'test' });
    }
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

    if (method === 'POST' && path === '/api/data/erase') {
      if (data.passcode !== TEST_PASSCODE) return json(403, { error: 'invalid_passcode' });
      this.erased += 1;
      for (const generation of this.generations.values()) generation.stop();
      this.generations.clear();
      this.subjects = [];
      this.defaultSubject = this.freshDefaultSubject();
      this.prompts.clear();
      this.engines = [];
      this.chats = [];
      this.notes = [];
      this.providers = [];
      this.secrets.clear();
      this.modelSettings = { default: null, fallback: [] };
      this.profile = {
        ...this.profile,
        federalState: null,
        schoolType: null,
        gradeLevel: null,
        onboardingCompleted: false,
      };
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

    if (method === 'GET' && path === '/api/subjects') {
      return json(200, { subjects: this.subjects, defaultSubject: this.defaultSubject });
    }
    if (method === 'GET' && path === '/api/subjects/templates') return json(200, this.catalog);
    if (method === 'POST' && path === '/api/subjects') return this.createSubject(data);
    if (method === 'POST' && path === '/api/subjects/import') return this.importSubjects(data);

    const subjectMatch = /^\/api\/subjects\/([^/]+)$/.exec(path);
    if (subjectMatch) return this.subject(method, subjectMatch[1] as string, data);
    const groupsMatch = /^\/api\/subjects\/([^/]+)\/groups$/.exec(path);
    if (groupsMatch && method === 'POST') return this.createGroup(groupsMatch[1] as string, data);
    const groupMatch = /^\/api\/groups\/([^/]+)$/.exec(path);
    if (groupMatch) return this.group(method, groupMatch[1] as string, data);

    const extra =
      this.handleProviders(method, path, data) ??
      this.handleEngines(method, path, data) ??
      this.handlePrompts(method, path, data) ??
      this.handlePlanner(method, path, data) ??
      this.handleNotes(method, path, data) ??
      this.handleChats(method, path, data, signal);
    if (extra) return extra;

    return json(404, { error: 'not_found' });
  }

  addProvider(name: string, extra: Partial<Provider> = {}): Provider {
    const provider: Provider = {
      id: nextId(),
      name,
      type: 'openai-compatible',
      preset: 'custom',
      baseUrl: 'https://anbieter.example.test/v1',
      models: [],
      sendImages: true,
      allowTools: true,
      hasKey: false,
      keyHint: null,
      warning: null,
      ...extra,
    };
    this.providers.push(provider);
    return provider;
  }

  private withFree(models: ModelEntry[]): Provider['models'] {
    return models.map((model) => ({
      ...model,
      free: model.id === 'openrouter/free' || model.id.endsWith(':free'),
    }));
  }

  private validBaseUrl(raw: string): 'invalid' | 'insecure' | null {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return 'invalid';
    }
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
      return 'insecure';
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'invalid';
  }

  private pruneSettings(): void {
    const valid = (s: { providerId: string; model: string }) =>
      this.providers.some((p) => p.id === s.providerId && p.models.some((m) => m.id === s.model));
    this.modelSettings = {
      default:
        this.modelSettings.default && valid(this.modelSettings.default)
          ? this.modelSettings.default
          : null,
      fallback: this.modelSettings.fallback.filter(valid),
    };
  }

  private handleProviders(
    method: string,
    path: string,
    data: Record<string, unknown>,
  ): Response | undefined {
    if (method === 'GET' && path === '/api/provider-presets') {
      return json(200, { presets: this.presets });
    }
    if (method === 'GET' && path === '/api/providers')
      return json(200, { providers: this.providers });
    if (method === 'GET' && path === '/api/model-settings') return json(200, this.modelSettings);
    if (method === 'PUT' && path === '/api/model-settings') {
      this.modelSettings = data as unknown as ModelSettings;
      this.pruneSettings();
      return json(200, this.modelSettings);
    }

    if (method === 'POST' && path === '/api/providers') {
      const name = String(data.name ?? '').trim();
      if (!name) return json(400, { error: 'invalid_input', field: 'name' });
      const preset = this.presets.find((p) => p.id === data.preset) ?? this.presets[4];
      const baseUrl = String(data.baseUrl ?? preset?.baseUrl ?? '');
      const problem = this.validBaseUrl(baseUrl);
      if (problem) return json(400, { error: 'invalid_input', field: 'baseUrl', reason: problem });
      if (this.providers.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return json(409, { error: 'name_taken' });
      }
      const models = (data.models as ModelEntry[] | undefined) ?? preset?.models ?? [];
      const provider = this.addProvider(name, {
        preset: preset?.id ?? 'custom',
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        models: this.withFree(models),
        sendImages: data.sendImages !== false,
        allowTools: data.allowTools !== false,
        warning: /\/api\/coding(\/|$)/.test(baseUrl) ? 'coding_plan' : null,
      });
      if (typeof data.apiKey === 'string') {
        this.secrets.set(provider.id, data.apiKey);
        provider.hasKey = true;
        provider.keyHint = data.apiKey.length >= 16 ? data.apiKey.slice(-4) : null;
      }
      if (!this.modelSettings.default && preset?.id === 'openrouter') {
        const flash = { providerId: provider.id, model: 'z-ai/glm-5.3-flash' };
        this.modelSettings = { default: flash, fallback: [flash] };
      }
      return json(201, provider);
    }

    const match = /^\/api\/providers\/([^/]+)(\/test|\/available-models)?$/.exec(path);
    if (!match) return undefined;
    const provider = this.providers.find((p) => p.id === match[1]);
    if (!provider) return json(404, { error: 'not_found' });

    if (match[2] === '/test' && method === 'POST') return json(200, this.testOutcome);
    if (match[2] === '/available-models' && method === 'GET') {
      return json(200, { models: this.available });
    }
    if (method === 'DELETE') {
      this.providers = this.providers.filter((p) => p.id !== provider.id);
      this.secrets.delete(provider.id);
      this.pruneSettings();
      return json(204);
    }
    if (method === 'PATCH') {
      if (typeof data.name === 'string') {
        const name = data.name.trim();
        if (!name) return json(400, { error: 'invalid_input', field: 'name' });
        if (
          this.providers.some(
            (p) => p.id !== provider.id && p.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          return json(409, { error: 'name_taken' });
        }
        provider.name = name;
      }
      if (typeof data.baseUrl === 'string') {
        const problem = this.validBaseUrl(data.baseUrl);
        if (problem)
          return json(400, { error: 'invalid_input', field: 'baseUrl', reason: problem });
        provider.baseUrl = data.baseUrl.trim().replace(/\/+$/, '');
        provider.warning = /\/api\/coding(\/|$)/.test(provider.baseUrl) ? 'coding_plan' : null;
      }
      if (Array.isArray(data.models)) provider.models = this.withFree(data.models as ModelEntry[]);
      if (typeof data.sendImages === 'boolean') provider.sendImages = data.sendImages;
      if (typeof data.allowTools === 'boolean') provider.allowTools = data.allowTools;
      if (typeof data.apiKey === 'string') {
        this.secrets.set(provider.id, data.apiKey);
        provider.hasKey = true;
        provider.keyHint = data.apiKey.length >= 16 ? data.apiKey.slice(-4) : null;
      }
      if (data.clearKey) {
        this.secrets.delete(provider.id);
        provider.hasKey = false;
        provider.keyHint = null;
      }
      this.pruneSettings();
      return json(200, provider);
    }
    return undefined;
  }

  addChat(subjectId: string, extra: Partial<Chat> = {}): Chat {
    const chat: Chat = {
      id: nextId(),
      subjectId,
      groupId: null,
      title: '',
      model: null,
      engineProfileId: null,
      generating: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    };
    this.chats.push(chat);
    this.chatMessages.set(chat.id, []);
    return chat;
  }

  /** Legt Nachrichten in einen Chat, ohne den Server zu bemühen. */
  addMessage(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage {
    const list = this.chatMessages.get(chatId) ?? [];
    const message: ChatMessage = {
      id: nextId(),
      seq: (list[list.length - 1]?.seq ?? 0) + 1,
      role,
      content,
      status: 'complete',
      providerId: null,
      model: null,
      engineProfileId: null,
      errorCode: null,
      activity: [],
      assets: [],
      createdAt: Date.now(),
      ...extra,
    };
    list.push(message);
    this.chatMessages.set(chatId, list);
    return message;
  }

  /** Die laufende Antwort eines Chats, damit der Test sie steuern kann. */
  generation(chatId: string): FakeGeneration {
    const generation = this.generations.get(chatId);
    if (!generation) throw new Error('Im Chat läuft keine Antwort');
    return generation;
  }

  /** Speichert das Ende einer Antwort (wird von `FakeGeneration` aufgerufen). */
  settle(chatId: string, message: ChatMessage): void {
    const list = this.chatMessages.get(chatId) ?? [];
    this.chatMessages.set(
      chatId,
      list.map((entry) => (entry.id === message.id ? message : entry)),
    );
    this.generations.delete(chatId);
    const chat = this.chats.find((entry) => entry.id === chatId);
    if (chat) chat.updatedAt = Date.now();
  }

  /** Startet eine Antwort, als hätte ein anderes Gerät gefragt: ohne offenen Strom. */
  begin(chatId: string, question: string): FakeGeneration {
    this.addMessage(chatId, 'user', question);
    const assistant = this.addMessage(chatId, 'assistant', '', { status: 'streaming' });
    const generation = new FakeGeneration(this, chatId, assistant);
    this.generations.set(chatId, generation);
    return generation;
  }

  private view(chat: Chat): Chat {
    return { ...chat, generating: this.generations.has(chat.id) };
  }

  /** Womit der Chat antwortet: Agent-Zugang (Chat, dann Fach) oder Modell. `viaApi` überspringt die Agenten. */
  private engineFor(chat: Chat, viaApi: boolean): string | null {
    if (viaApi) return null;
    const subject = this.allSubjects().find((entry) => entry.id === chat.subjectId);
    if (chat.engineProfileId) return chat.engineProfileId;
    return chat.model ? null : (subject?.engineProfileId ?? null);
  }

  private hasModel(chat: Chat, viaApi = false): boolean {
    if (this.engineFor(chat, viaApi)) return true;
    const subject = this.allSubjects().find((entry) => entry.id === chat.subjectId);
    return Boolean(chat.model ?? subject?.model ?? this.modelSettings.default);
  }

  private startGeneration(chat: Chat, user: ChatMessage | null, viaApi = false): Response {
    const assistant = this.addMessage(chat.id, 'assistant', '', {
      status: 'streaming',
      engineProfileId: this.engineFor(chat, viaApi),
    });
    const generation = new FakeGeneration(this, chat.id, assistant);
    this.generations.set(chat.id, generation);
    return generation.open(null, { user });
  }

  private handleChats(
    method: string,
    path: string,
    data: Record<string, unknown>,
    signal?: AbortSignal | null,
  ): Response | undefined {
    const [route = '', query = ''] = path.split('?');

    if (method === 'GET' && route === '/api/chats') {
      const params = new URLSearchParams(query);
      const subjectId = params.get('subjectId');
      const groupId = params.get('groupId');
      const list = this.chats
        .filter((chat) => chat.subjectId === subjectId && chat.groupId === groupId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((chat) => this.view(chat));
      return json(200, { chats: list });
    }
    if (method === 'POST' && route === '/api/chats') {
      const subject = this.allSubjects().find((entry) => entry.id === data.subjectId);
      if (!subject) return json(404, { error: 'not_found' });
      const groupId = (data.groupId as string | null | undefined) ?? null;
      if (groupId && !subject.groups.some((group) => group.id === groupId)) {
        return json(404, { error: 'not_found' });
      }
      return json(201, this.view(this.addChat(subject.id, { groupId })));
    }

    const subjectModel = /^\/api\/subjects\/([^/]+)\/model$/.exec(route);
    if (subjectModel && method === 'PUT') {
      const subject = this.allSubjects().find((entry) => entry.id === subjectModel[1]);
      if (!subject) return json(404, { error: 'not_found' });
      subject.model = (data.model as Selection | null) ?? null;
      if (subject.model) subject.engineProfileId = null;
      return json(200, subject);
    }
    const subjectEngine = /^\/api\/subjects\/([^/]+)\/engine$/.exec(route);
    if (subjectEngine && method === 'PUT') {
      const subject = this.allSubjects().find((entry) => entry.id === subjectEngine[1]);
      if (!subject) return json(404, { error: 'not_found' });
      const id = (data.engineProfileId as string | null) ?? null;
      if (id !== null && !this.engines.some((entry) => entry.id === id)) {
        return json(400, { error: 'invalid_input', field: 'engineProfileId' });
      }
      subject.engineProfileId = id;
      if (id !== null) subject.model = null;
      return json(200, subject);
    }

    const match = /^\/api\/chats\/([^/]+)(\/messages|\/retry|\/generation|\/stop)?$/.exec(route);
    if (!match) return undefined;
    const chat = this.chats.find((entry) => entry.id === match[1]);
    if (!chat) return json(404, { error: 'not_found' });
    const action = match[2];

    if (!action && method === 'GET') {
      return json(200, { ...this.view(chat), messages: this.chatMessages.get(chat.id) ?? [] });
    }
    if (!action && method === 'PATCH') {
      if (typeof data.title === 'string') chat.title = data.title.trim();
      if ('model' in data) {
        chat.model = (data.model as Selection | null) ?? null;
        if (chat.model) chat.engineProfileId = null;
      }
      if ('engineProfileId' in data) {
        const id = (data.engineProfileId as string | null) ?? null;
        if (id !== null && !this.engines.some((entry) => entry.id === id)) {
          return json(400, { error: 'invalid_input', field: 'engineProfileId' });
        }
        chat.engineProfileId = id;
        if (id !== null) chat.model = null;
      }
      return json(200, this.view(chat));
    }
    if (!action && method === 'DELETE') {
      this.chats = this.chats.filter((entry) => entry.id !== chat.id);
      this.chatMessages.delete(chat.id);
      return json(204);
    }

    if (action === '/generation' && method === 'GET') {
      const generation = this.generations.get(chat.id);
      return generation ? generation.open(signal) : json(204);
    }
    if (action === '/stop' && method === 'POST') {
      this.generations.get(chat.id)?.stop();
      return json(204);
    }

    if ((action === '/messages' || action === '/retry') && method === 'POST') {
      if (this.generations.has(chat.id)) return json(409, { error: 'busy' });
      const viaApi = action === '/retry' && data.viaApi === true;
      if (!this.hasModel(chat, viaApi)) return json(409, { error: 'no_model' });
      const list = this.chatMessages.get(chat.id) ?? [];
      if (action === '/retry') {
        const last = list[list.length - 1];
        if (last?.role !== 'assistant' || last.status === 'complete') {
          return json(409, { error: 'nothing_to_retry' });
        }
        this.chatMessages.set(chat.id, list.slice(0, -1));
        return this.startGeneration(chat, null, viaApi);
      }
      const content = typeof data.content === 'string' ? data.content : '';
      if (content.trim() === '') return json(400, { error: 'invalid_input', field: 'content' });
      const user = this.addMessage(chat.id, 'user', content);
      if (chat.title === '')
        chat.title = [...(content.split('\n')[0]?.trim() ?? '')].slice(0, 60).join('');
      return this.startGeneration(chat, user);
    }
    return undefined;
  }

  private handlePrompts(
    method: string,
    path: string,
    data: Record<string, unknown>,
  ): Response | undefined {
    if (method === 'GET' && path.startsWith('/api/prompts/preview')) {
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      const subject = this.allSubjects().find((s) => s.id === query.get('subjectId'));
      if (!subject) return json(404, { error: 'not_found' });
      const groupId = query.get('groupId');
      const own = this.prompts.get(`subject:${subject.id}`);
      const standard = this.defaultFor(subject);
      const fill = (text: string) => text.replaceAll('{{fach}}', subject.name);
      const texts: [0 | 1 | 2 | 3, string | null | undefined, 'code' | 'default' | 'custom'][] = [
        [0, 'Antworte in Markdown.', 'code'],
        [1, this.prompts.get('general'), 'custom'],
        [2, own ? fill(own) : standard ? fill(standard) : null, own ? 'custom' : 'default'],
        [3, groupId ? this.prompts.get(`group:${groupId}`) : null, 'custom'],
      ];
      const layers = texts.flatMap(([layer, text, origin]) =>
        text ? [{ layer, text, origin }] : [],
      );
      const preview: PromptPreview = {
        system: layers.map((l) => l.text).join('\n\n'),
        layers,
        missing: this.profile.federalState ? [] : ['bundesland'],
      };
      return json(200, preview);
    }

    const match = /^\/api\/prompts\/(general|subjects\/([^/]+)|groups\/([^/]+))$/.exec(path);
    if (!match) return undefined;
    const key =
      match[1] === 'general' ? 'general' : match[2] ? `subject:${match[2]}` : `group:${match[3]}`;
    const subject = match[2] ? this.allSubjects().find((s) => s.id === match[2]) : undefined;
    if (match[2] && !subject) return json(404, { error: 'not_found' });
    const view = (text: string | null) => {
      if (!subject) return { text };
      const defaultText = this.defaultFor(subject);
      return {
        text,
        defaultText,
        source: text !== null ? 'custom' : defaultText !== null ? 'default' : 'none',
      };
    };
    if (method === 'GET') return json(200, view(this.prompts.get(key) ?? null));
    if (method === 'PUT') {
      const text = typeof data.text === 'string' && data.text.trim() !== '' ? data.text : null;
      this.prompts.set(key, text);
      return json(200, view(text));
    }
    return undefined;
  }

  addLesson(extra: Partial<TimetableEntry> = {}): TimetableEntry {
    const entry: TimetableEntry = {
      id: nextId(),
      weekday: 1,
      startTime: '08:00',
      endTime: '08:45',
      subjectId: null,
      room: null,
      note: null,
      week: 'all',
      ...extra,
    };
    this.timetable.push(entry);
    return entry;
  }

  addNote(subjectId: string, extra: Partial<Note> = {}): Note {
    const now = Date.now();
    const note: Note = {
      id: nextId(),
      subjectId,
      groupId: null,
      title: 'Beispieleintrag',
      markdown: '',
      pinned: false,
      tags: [],
      excerpt: '',
      sourceChatId: null,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
    this.notes.push(note);
    return note;
  }

  private withExcerpt(note: Note): Note {
    return { ...note, excerpt: note.markdown.replace(/\s+/g, ' ').trim().slice(0, 160) };
  }

  private handleNotes(
    method: string,
    path: string,
    data: Record<string, unknown>,
  ): Response | undefined {
    const [route = '', query = ''] = path.split('?');
    if (route === '/api/notes' && method === 'GET') {
      const params = new URLSearchParams(query);
      const subjectId = params.get('subjectId');
      if (!subjectId) return json(400, { error: 'invalid_input', field: 'subjectId' });
      const groupId = params.get('groupId');
      const needle = (params.get('q') ?? '').toLowerCase();
      const list = this.notes
        .filter(
          (note) =>
            note.subjectId === subjectId &&
            (note.groupId ?? null) === (groupId ?? null) &&
            (needle === '' ||
              note.title.toLowerCase().includes(needle) ||
              note.markdown.toLowerCase().includes(needle)),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
        .map((note) => {
          const { markdown: _text, ...summary } = this.withExcerpt(note);
          return summary;
        });
      return json(200, { notes: list });
    }
    if (route === '/api/notes' && method === 'POST') {
      const title = String(data.title ?? '').trim();
      if (title === '' || [...title].length > 120) {
        return json(400, { error: 'invalid_input', field: 'title' });
      }
      const subjectId = String(data.subjectId ?? '');
      if (!this.allSubjects().some((subject) => subject.id === subjectId)) {
        return json(400, { error: 'invalid_input', field: 'subjectId' });
      }
      const note = this.addNote(subjectId, {
        groupId: typeof data.groupId === 'string' ? data.groupId : null,
        title,
        markdown: String(data.markdown ?? ''),
        pinned: data.pinned === true,
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      });
      return json(201, this.withExcerpt(note));
    }
    const one = /^\/api\/notes\/([^/]+)$/.exec(route);
    if (one) {
      const note = this.notes.find((entry) => entry.id === one[1]);
      if (!note) return json(404, { error: 'not_found' });
      if (method === 'GET') return json(200, this.withExcerpt(note));
      if (method === 'DELETE') {
        this.notes = this.notes.filter((entry) => entry !== note);
        return json(204);
      }
      if (method === 'PATCH') {
        if ('title' in data) {
          const title = String(data.title ?? '').trim();
          if (title === '') return json(400, { error: 'invalid_input', field: 'title' });
          note.title = title;
        }
        if ('markdown' in data) note.markdown = String(data.markdown ?? '');
        if ('pinned' in data) note.pinned = data.pinned === true;
        if ('tags' in data && Array.isArray(data.tags)) note.tags = data.tags as string[];
        if ('groupId' in data)
          note.groupId = typeof data.groupId === 'string' ? data.groupId : null;
        note.updatedAt = Date.now();
        return json(200, this.withExcerpt(note));
      }
    }
    const fromMessage = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/note$/.exec(route);
    if (fromMessage && method === 'POST') {
      const chat = this.chats.find((entry) => entry.id === fromMessage[1]);
      const message = this.chatMessages
        .get(fromMessage[1] as string)
        ?.find((entry) => entry.id === fromMessage[2]);
      if (!chat || !message) return json(404, { error: 'not_found' });
      const savable = ['complete', 'stopped', 'interrupted'].includes(message.status);
      if (message.role !== 'assistant' || !savable || message.content.trim() === '') {
        return json(409, { error: 'not_savable' });
      }
      const heading = message.content.split('\n').find((line) => /^\s{0,3}#{1,3}\s+\S/.test(line));
      const title =
        (heading ?? message.content)
          .replace(/^\s{0,3}#{1,3}\s+/, '')
          .trim()
          .split('\n')[0]
          ?.slice(0, 60) || 'Hefteintrag';
      const note = this.addNote(chat.subjectId, {
        groupId: chat.groupId,
        title,
        markdown: message.content,
        sourceChatId: chat.id,
      });
      return json(201, this.withExcerpt(note));
    }
    return undefined;
  }

  addExam(subjectId: string, extra: Partial<Exam> = {}): Exam {
    const exam: Exam = {
      id: nextId(),
      subjectId,
      kind: 'Test',
      title: null,
      date: '2026-10-08',
      time: null,
      topics: null,
      notes: null,
      ...extra,
    };
    this.exams.push(exam);
    return exam;
  }

  private handlePlanner(
    method: string,
    path: string,
    data: Record<string, unknown>,
  ): Response | undefined {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (path === '/api/tool-settings') {
      if (method === 'PUT') this.toolsEnabled = data.enabled === true;
      return json(200, { enabled: this.toolsEnabled });
    }
    if (path === '/api/timetable' && method === 'GET') {
      return json(200, { entries: this.timetable, weekAnchor: this.weekAnchor });
    }
    if (path === '/api/timetable' && method === 'POST') {
      const start = String(data.startTime ?? '');
      const end = String(data.endTime ?? '');
      if (!time.test(start) || !time.test(end) || end <= start) {
        return json(400, { error: 'invalid_input', field: 'endTime', reason: 'before_start' });
      }
      const weekday = Number(data.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        return json(400, { error: 'invalid_input', field: 'weekday' });
      }
      return json(
        201,
        this.addLesson({
          weekday,
          startTime: start,
          endTime: end,
          subjectId: (data.subjectId as string | null) ?? null,
          room: (data.room as string | null) ?? null,
          note: (data.note as string | null) ?? null,
          week: (data.week as TimetableEntry['week']) ?? 'all',
        }),
      );
    }
    if (path === '/api/timetable/week' && method === 'PUT') {
      const anchor = data.anchor as { date: string; week: 'a' | 'b' } | null;
      this.weekAnchor = anchor ? { monday: mondayOfDate(anchor.date), week: anchor.week } : null;
      return json(200, { weekAnchor: this.weekAnchor });
    }
    const lesson = /^\/api\/timetable\/([^/]+)$/.exec(path);
    if (lesson) {
      const found = this.timetable.find((entry) => entry.id === lesson[1]);
      if (!found) return json(404, { error: 'not_found' });
      if (method === 'DELETE') {
        this.timetable = this.timetable.filter((entry) => entry !== found);
        return json(204);
      }
      if (method === 'PATCH') {
        const next = { ...found, ...data } as TimetableEntry;
        if (next.endTime <= next.startTime) {
          return json(400, { error: 'invalid_input', field: 'endTime', reason: 'before_start' });
        }
        Object.assign(found, next);
        return json(200, found);
      }
    }
    if (path === '/api/exams' && method === 'GET') return json(200, { exams: this.exams });
    if (path === '/api/exams' && method === 'POST') {
      if (!date.test(String(data.date ?? ''))) {
        return json(400, { error: 'invalid_input', field: 'date' });
      }
      if (
        !this.allSubjects().some((entry) => entry.id === data.subjectId && entry.kind !== 'default')
      ) {
        return json(400, { error: 'invalid_input', field: 'subjectId' });
      }
      return json(
        201,
        this.addExam(String(data.subjectId), {
          kind: String(data.kind ?? ''),
          title: (data.title as string | null) ?? null,
          date: String(data.date),
          time: (data.time as string | null) ?? null,
          topics: (data.topics as string | null) ?? null,
          notes: (data.notes as string | null) ?? null,
        }),
      );
    }
    const exam = /^\/api\/exams\/([^/]+)$/.exec(path);
    if (exam) {
      const found = this.exams.find((entry) => entry.id === exam[1]);
      if (!found) return json(404, { error: 'not_found' });
      if (method === 'DELETE') {
        this.exams = this.exams.filter((entry) => entry !== found);
        return json(204);
      }
      if (method === 'PATCH') {
        Object.assign(found, data);
        return json(200, found);
      }
    }
    return undefined;
  }

  addEngine(name: string, extra: Partial<EngineProfile> = {}): EngineProfile {
    const profile: EngineProfile = {
      id: nextId(),
      kind: 'claude-subscription',
      name,
      model: null,
      timeoutMinutes: 20,
      hasToken: false,
      tokenHint: null,
      position: this.engines.length,
      createdAt: Date.now(),
      ...extra,
    };
    this.engines.push(profile);
    return profile;
  }

  private handleEngines(
    method: string,
    path: string,
    data: Record<string, unknown>,
  ): Response | undefined {
    if (method === 'GET' && path === '/api/engines') {
      return json(200, { kinds: this.engineKinds, profiles: this.engines });
    }
    if (method === 'GET' && path === '/api/engines/cli') return json(200, { cli: this.cli });
    if (method === 'POST' && path === '/api/engines/detect') return json(200, { cli: this.cli });

    if (method === 'POST' && path === '/api/engines') {
      const kind = data.kind as EngineProfile['kind'];
      const info = this.engineKinds.find((entry) => entry.kind === kind);
      const name = String(data.name ?? '').trim();
      if (!info || !name)
        return json(400, { error: 'invalid_input', field: !info ? 'kind' : 'name' });
      const token = typeof data.token === 'string' ? data.token.trim() : '';
      if (info.needsToken && !token) {
        return json(400, { error: 'invalid_input', field: 'token', reason: 'token_required' });
      }
      if (!info.needsToken && token) {
        return json(400, { error: 'invalid_input', field: 'token', reason: 'token_not_allowed' });
      }
      if (this.engines.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
        return json(409, { error: 'name_taken' });
      }
      const profile = this.addEngine(name, {
        kind,
        model: (data.model as string | null | undefined) ?? null,
        timeoutMinutes: (data.timeoutMinutes as number | undefined) ?? 20,
        hasToken: info.needsToken,
        tokenHint: info.needsToken && token.length >= 16 ? token.slice(-4) : null,
      });
      if (info.needsToken) this.secrets.set(`engine.${profile.id}.token`, token);
      return json(201, profile);
    }

    const match = /^\/api\/engines\/([^/]+)$/.exec(path);
    if (!match) return undefined;
    const profile = this.engines.find((entry) => entry.id === match[1]);
    if (!profile) return json(404, { error: 'not_found' });
    if (method === 'DELETE') {
      this.engines = this.engines.filter((entry) => entry.id !== profile.id);
      this.secrets.delete(`engine.${profile.id}.token`);
      for (const subject of this.allSubjects()) {
        if (subject.engineProfileId === profile.id) subject.engineProfileId = null;
      }
      for (const chat of this.chats)
        if (chat.engineProfileId === profile.id) chat.engineProfileId = null;
      return json(204);
    }
    if (method === 'PATCH') {
      if (typeof data.name === 'string') {
        const name = data.name.trim();
        if (
          this.engines.some(
            (entry) => entry.id !== profile.id && entry.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          return json(409, { error: 'name_taken' });
        }
        profile.name = name;
      }
      if ('model' in data) profile.model = (data.model as string | null) ?? null;
      if (typeof data.timeoutMinutes === 'number') profile.timeoutMinutes = data.timeoutMinutes;
      if (typeof data.token === 'string' && data.token.trim()) {
        const token = data.token.trim();
        this.secrets.set(`engine.${profile.id}.token`, token);
        profile.hasToken = true;
        profile.tokenHint = token.length >= 16 ? token.slice(-4) : null;
      }
      return json(200, profile);
    }
    return undefined;
  }

  /** Standardtext zu einem Fach: nach Schlüssel der Vorlage, sonst allgemein (wie der echte Server). */
  private defaultFor(subject: Subject): string | null {
    const key = subject.kind === 'default' ? 'standard' : (subject.templateKey ?? '');
    return this.defaultPrompts[key] ?? this.defaultPrompts._generic ?? null;
  }

  private taken(name: string, ignoreId?: string): boolean {
    return this.subjects.some(
      (s) => s.id !== ignoreId && s.name.toLowerCase() === name.trim().toLowerCase(),
    );
  }

  private createSubject(data: Record<string, unknown>): Response {
    const name = String(data.name ?? '').trim();
    if (!name) return json(400, { error: 'invalid_input', field: 'name' });
    if (name.toLowerCase() === 'standard') return json(409, { error: 'name_reserved' });
    if (this.taken(name)) return json(409, { error: 'name_taken' });
    const templateKey = data.templateKey as string | undefined;
    if (templateKey !== undefined && !this.catalog.subjects.some((e) => e.key === templateKey)) {
      return json(400, { error: 'invalid_input', field: 'templateKey' });
    }
    const subject = this.addSubject(name, {
      teacher: (data.teacher as string | null | undefined) || null,
      hoursPerWeek: (data.hoursPerWeek as number | null | undefined) ?? null,
      icon: (data.icon as string | null | undefined) ?? null,
      templateKey: templateKey ?? null,
      ...(typeof data.color === 'number' ? { color: data.color } : {}),
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
    const subject = this.allSubjects().find((s) => s.id === id);
    if (!subject) return json(404, { error: 'not_found' });
    if (subject.kind === 'default' && (method === 'DELETE' || method === 'PATCH')) {
      return json(409, { error: 'builtin' });
    }
    if (method === 'DELETE') {
      this.subjects = this.subjects.filter((s) => s.id !== id);
      return json(204);
    }
    if (method === 'PATCH') {
      if (typeof data.name === 'string') {
        if (!data.name.trim()) return json(400, { error: 'invalid_input', field: 'name' });
        if (data.name.trim().toLowerCase() === 'standard') {
          return json(409, { error: 'name_reserved' });
        }
        if (this.taken(data.name, id)) return json(409, { error: 'name_taken' });
        subject.name = data.name.trim();
      }
      if ('teacher' in data) subject.teacher = (data.teacher as string | null) || null;
      if ('hoursPerWeek' in data) subject.hoursPerWeek = data.hoursPerWeek as number | null;
      if ('icon' in data) subject.icon = data.icon as string | null;
      if (typeof data.color === 'number') subject.color = data.color;
      return json(200, subject);
    }
    return json(404, { error: 'not_found' });
  }

  private createGroup(subjectId: string, data: Record<string, unknown>): Response {
    const subject = this.allSubjects().find((s) => s.id === subjectId);
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
    for (const subject of this.allSubjects()) {
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

/** Montag der Woche eines Datums (`YYYY-MM-DD`), für den Server-Ersatz. */
function mondayOfDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay() === 0 ? 7 : value.getUTCDay();
  value.setUTCDate(value.getUTCDate() + 1 - weekday);
  return value.toISOString().slice(0, 10);
}
