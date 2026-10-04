import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import { parseActivity, serializeActivity, settleActivity } from '../agents/activity';
import type { AssetService, AssetView } from '../agents/assets';
import { formatTranscript, withAgentInstructions } from '../agents/instructions';
import type { EngineProfileService } from '../agents/profiles';
import type { AgentOutcome, AgentRunner } from '../agents/runner';
import type { Db } from '../db/client';
import {
  type ChatRow,
  chats,
  type MessageRow,
  messages,
  subjectGroups,
  subjects,
} from '../db/schema';
import { buildSystemPrompt } from '../domain/prompts';
import { getSubject, type SubjectView } from '../domain/subjects';
import { DefaultPrompts } from '../prompts/defaults';
import type { ChatMessage, ToolCall } from '../providers/client';
import { ProviderError } from '../providers/errors';
import type { Selection } from '../providers/models';
import type { ProviderService } from '../providers/service';
import { withToolInstructions } from '../tools/instructions';
import type { ToolRegistry } from '../tools/registry';
import type { ToolSettings } from '../tools/settings';
import { type ChatErrorCode, Generation, type MessageStatus, type MessageView } from './generation';
import { buildHistory, HISTORY_MAX_CHARACTERS, titleFrom } from './history';

export interface ChatView {
  id: string;
  subjectId: string;
  /** `null`: der Chat liegt im Fach selbst („Allgemein“), nicht in einer Untergruppe. */
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

export interface ChatDetail extends ChatView {
  messages: MessageView[];
}

export type ChatFailure = {
  ok: false;
  error:
    | 'not_found'
    | 'unknown_model'
    | 'unknown_engine'
    | 'busy'
    | 'too_busy'
    | 'no_model'
    | 'nothing_to_retry'
    | 'workspace_busy';
};
export type ChatResult<T> = { ok: true; value: T } | ChatFailure;

export interface StartedGeneration {
  generation: Generation;
  /** Die neue Nachricht des Nutzers; bei „Erneut versuchen“ gibt es keine. */
  userMessage: MessageView | null;
  assistantMessage: MessageView;
}

export interface ChatServiceOptions {
  /** Wie viele Antworten gleichzeitig laufen dürfen. */
  maxActive?: number;
  historyMaxCharacters?: number;
  /** Wie oft ein Zwischenstand der laufenden Antwort in die Datenbank geschrieben wird. */
  flushIntervalMs?: number;
  /** Mitgelieferte Standard-Prompts je Fach (D-034). Ohne Angabe gibt es keine. */
  defaults?: DefaultPrompts;
  /** Zugänge für den Agent-CLI-Adapter. Ohne Angabe gibt es keine (nur API-Modelle). */
  engines?: EngineProfileService;
  /** Führt Antworten über einen Agenten aus. Ohne Angabe antworten Chats immer über API-Modelle. */
  agents?: AgentRunner;
  /** Dateien, die Agenten erzeugt haben (für Anzeige und Aufräumen). */
  assets?: AssetService;
  /** Wie viele Agenten gleichzeitig arbeiten dürfen (schwerer als eine Modellantwort). */
  maxAgents?: number;
  /** Werkzeuge, die Modelle aufrufen dürfen (Stundenplan, Tests). Ohne Angabe gibt es keine. */
  tools?: ToolRegistry;
  /** Globaler Schalter für Werkzeuge. Ohne Angabe gilt „an“. */
  toolSettings?: ToolSettings;
  /** Aktuelle Zeit; in Tests fest. */
  now?: () => Date;
}

/** Wie viele Runden von Werkzeugaufrufen eine Antwort höchstens macht; danach muss das Modell antworten. */
export const MAX_TOOL_ROUNDS = 4;
/** Wie viele Werkzeugaufrufe eine Antwort insgesamt höchstens ausführt. */
export const MAX_TOOL_CALLS = 12;

/** Womit ein Chat antwortet. */
type Target = { kind: 'engine'; profileId: string } | { kind: 'api'; chain: Selection[] };

const TITLE_MAX = 120;

function selectionOf(providerId: string | null, modelId: string | null): Selection | null {
  return providerId && modelId ? { providerId, model: modelId } : null;
}

function toMessage(row: MessageRow, assets: AssetView[] = []): MessageView {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    status: row.status,
    providerId: row.providerId,
    model: row.model,
    engineProfileId: row.engineProfileId,
    errorCode: row.errorCode as ChatErrorCode | null,
    activity: parseActivity(row.activity),
    assets,
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * Chats und ihre Antworten. Die Antwort eines Modells läuft als `Generation` im Speicher, unabhängig
 * von der Verbindung des Browsers: Geht das Gerät kurz in den Ruhezustand, läuft sie weiter und der
 * Browser kann sich später wieder anhängen. Fertige Antworten stehen in der Datenbank.
 */
export class ChatService {
  private readonly active = new Map<string, Generation>();
  private readonly maxActive: number;
  private readonly historyMax: number;
  private readonly flushIntervalMs: number;
  private readonly defaults: DefaultPrompts;
  private readonly engines: EngineProfileService | null;
  private readonly agents: AgentRunner | null;
  private readonly assets: AssetService | null;
  private readonly maxAgents: number;
  private readonly activeAgents = new Set<string>();
  private readonly tools: ToolRegistry | null;
  private readonly toolSettings: ToolSettings | null;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    private readonly providers: ProviderService,
    options: ChatServiceOptions = {},
  ) {
    this.maxActive = options.maxActive ?? 4;
    this.historyMax = options.historyMaxCharacters ?? HISTORY_MAX_CHARACTERS;
    this.flushIntervalMs = options.flushIntervalMs ?? 2_000;
    this.defaults = options.defaults ?? DefaultPrompts.empty();
    this.engines = options.engines ?? null;
    this.agents = options.agents ?? null;
    this.assets = options.assets ?? null;
    this.maxAgents = options.maxAgents ?? 2;
    this.tools = options.tools ?? null;
    this.toolSettings = options.toolSettings ?? null;
    this.now = options.now ?? (() => new Date());
    // Antworten, die beim letzten Beenden des Servers liefen, sind unterbrochen. Was schon da war, bleibt.
    this.db
      .update(messages)
      .set({ status: 'interrupted' })
      .where(eq(messages.status, 'streaming'))
      .run();
  }

  // --- Chats -----------------------------------------------------------------------------------

  private toChat(row: ChatRow): ChatView {
    return {
      id: row.id,
      subjectId: row.subjectId,
      groupId: row.groupId,
      title: row.title,
      model: selectionOf(row.modelProviderId, row.modelId),
      engineProfileId: row.engineProfileId,
      generating: this.active.has(row.id),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private row(id: string): ChatRow | undefined {
    return this.db.select().from(chats).where(eq(chats.id, id)).get();
  }

  private groupBelongs(subjectId: string, groupId: string): boolean {
    const group = this.db
      .select({ subjectId: subjectGroups.subjectId })
      .from(subjectGroups)
      .where(eq(subjectGroups.id, groupId))
      .get();
    return group !== undefined && group.subjectId === subjectId;
  }

  /** Chats einer Untergruppe, oder – ohne Untergruppe – die Chats im Fach selbst. Neueste zuerst. */
  list(subjectId: string, groupId: string | null): ChatResult<ChatView[]> {
    const subject = this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .get();
    if (!subject) return { ok: false, error: 'not_found' };
    if (groupId !== null && !this.groupBelongs(subjectId, groupId)) {
      return { ok: false, error: 'not_found' };
    }
    const scope = groupId === null ? isNull(chats.groupId) : eq(chats.groupId, groupId);
    const rows = this.db
      .select()
      .from(chats)
      .where(and(eq(chats.subjectId, subjectId), scope))
      .orderBy(desc(chats.updatedAt), desc(chats.createdAt))
      .all();
    return { ok: true, value: rows.map((row) => this.toChat(row)) };
  }

  get(id: string): ChatResult<ChatDetail> {
    const row = this.row(id);
    if (!row) return { ok: false, error: 'not_found' };
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, id))
      .orderBy(asc(messages.seq))
      .all();
    const files = this.assets?.forMessages(rows.map((message) => message.id)) ?? new Map();
    return {
      ok: true,
      value: {
        ...this.toChat(row),
        messages: rows.map((message) => toMessage(message, files.get(message.id) ?? [])),
      },
    };
  }

  create(subjectId: string, groupId: string | null, title = ''): ChatResult<ChatView> {
    const subject = this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .get();
    if (!subject) return { ok: false, error: 'not_found' };
    // Eine Untergruppe eines anderen Fachs zählt als unbekannt: Chats bleiben in ihrem Fach.
    if (groupId !== null && !this.groupBelongs(subjectId, groupId)) {
      return { ok: false, error: 'not_found' };
    }
    const row = this.db
      .insert(chats)
      .values({ subjectId, groupId, title: title.slice(0, TITLE_MAX) })
      .returning()
      .get();
    return { ok: true, value: this.toChat(row) };
  }

  /**
   * Titel, Modell oder Agent-CLI-Zugang eines Chats ändern. Modell und Zugang schließen sich aus: Wer
   * eines wählt, hebt das andere auf, damit nie unklar ist, womit ein Chat antwortet.
   */
  update(
    id: string,
    patch: { title?: string; model?: Selection | null; engineProfileId?: string | null },
  ): ChatResult<ChatView> {
    const row = this.row(id);
    if (!row) return { ok: false, error: 'not_found' };
    const changes: Partial<typeof chats.$inferInsert> = {};
    if (patch.title !== undefined) changes.title = patch.title.slice(0, TITLE_MAX);
    if (patch.model !== undefined) {
      if (patch.model !== null && !this.providers.hasModel(patch.model)) {
        return { ok: false, error: 'unknown_model' };
      }
      changes.modelProviderId = patch.model?.providerId ?? null;
      changes.modelId = patch.model?.model ?? null;
      if (patch.model !== null) changes.engineProfileId = null;
    }
    if (patch.engineProfileId !== undefined) {
      if (patch.engineProfileId !== null && !this.engines?.exists(patch.engineProfileId)) {
        return { ok: false, error: 'unknown_engine' };
      }
      changes.engineProfileId = patch.engineProfileId;
      if (patch.engineProfileId !== null) {
        changes.modelProviderId = null;
        changes.modelId = null;
        // Ein anderer Zugang ist eine andere Sitzung.
        if (patch.engineProfileId !== row.engineProfileId) changes.agentSessionId = null;
      }
    }
    // Umbenennen und Modellwahl zählen nicht als Aktivität: die Liste bleibt nach Nutzung sortiert.
    if (Object.keys(changes).length > 0) {
      this.db
        .update(chats)
        .set({ ...changes, updatedAt: row.updatedAt })
        .where(eq(chats.id, id))
        .run();
    }
    const updated = this.row(id);
    return updated ? { ok: true, value: this.toChat(updated) } : { ok: false, error: 'not_found' };
  }

  remove(id: string): ChatResult<null> {
    this.active.get(id)?.abort.abort();
    // Die Dateien auf der Platte folgen der Zeile: IDs vor dem Löschen sammeln.
    const files = this.assets?.idsForChat(id) ?? [];
    const result = this.db.delete(chats).where(eq(chats.id, id)).run();
    if (result.changes === 0) return { ok: false, error: 'not_found' };
    if (files.length > 0) void this.assets?.deleteFiles(files);
    return { ok: true, value: null };
  }

  /** Modellwahl eines Fachs setzen oder mit `null` aufheben. */
  setSubjectModel(subjectId: string, model: Selection | null): ChatResult<SubjectView> {
    const existing = this.db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
    if (!existing) return { ok: false, error: 'not_found' };
    if (model !== null && !this.providers.hasModel(model)) {
      return { ok: false, error: 'unknown_model' };
    }
    this.db
      .update(subjects)
      .set({
        modelProviderId: model?.providerId ?? null,
        modelId: model?.model ?? null,
        // Wer ein Modell wählt, hebt den Agent-CLI-Zugang des Fachs auf.
        ...(model !== null ? { engineProfileId: null } : {}),
      })
      .where(eq(subjects.id, subjectId))
      .run();
    const view = getSubject(this.db, subjectId);
    return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
  }

  /** Agent-CLI-Zugang eines Fachs setzen oder mit `null` aufheben (hebt die Modellwahl des Fachs auf). */
  setSubjectEngine(subjectId: string, engineProfileId: string | null): ChatResult<SubjectView> {
    const existing = this.db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
    if (!existing) return { ok: false, error: 'not_found' };
    if (engineProfileId !== null && !this.engines?.exists(engineProfileId)) {
      return { ok: false, error: 'unknown_engine' };
    }
    this.db
      .update(subjects)
      .set({
        engineProfileId,
        ...(engineProfileId !== null ? { modelProviderId: null, modelId: null } : {}),
      })
      .where(eq(subjects.id, subjectId))
      .run();
    const view = getSubject(this.db, subjectId);
    return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
  }

  // --- Antworten -------------------------------------------------------------------------------

  /** Laufende Antwort eines Chats, falls es eine gibt. */
  running(chatId: string): Generation | null {
    return this.active.get(chatId) ?? null;
  }

  /** Bricht alle laufenden Antworten ab und wartet kurz, bis sie beendet sind (z. B. vor „Alles löschen“). */
  async stopAll(timeoutMs = 3_000): Promise<void> {
    for (const generation of this.active.values()) generation.abort.abort();
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Bricht die laufenden Antworten dieser Chats ab und wartet kurz, bis sie beendet sind (vor dem Löschen eines Fachs). */
  async stopChats(chatIds: string[], timeoutMs = 5_000): Promise<void> {
    const running = chatIds.filter((id) => this.active.has(id));
    for (const id of running) this.active.get(id)?.abort.abort();
    const deadline = Date.now() + timeoutMs;
    while (running.some((id) => this.active.has(id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  stop(chatId: string): boolean {
    const generation = this.active.get(chatId);
    generation?.abort.abort();
    return generation !== undefined;
  }

  /**
   * Womit dieser Chat antwortet. Reihenfolge: eigener Agent-Zugang des Chats, eigene Modellwahl des Chats,
   * Agent-Zugang des Fachs, Modellwahl des Fachs, Standardmodell samt Ausweichmodellen. `viaApi` überspringt
   * die Agenten (für „Mit API-Modell erneut“ nach einem Fehler des Agenten, nur für diesen Versuch).
   */
  private targetFor(chat: ChatRow, viaApi: boolean): Target {
    const subject = this.db.select().from(subjects).where(eq(subjects.id, chat.subjectId)).get();
    const ownModel = selectionOf(chat.modelProviderId, chat.modelId);
    if (!viaApi && this.agents) {
      if (chat.engineProfileId) return { kind: 'engine', profileId: chat.engineProfileId };
      if (!ownModel && subject?.engineProfileId) {
        return { kind: 'engine', profileId: subject.engineProfileId };
      }
    }
    const candidates = [
      ownModel,
      selectionOf(subject?.modelProviderId ?? null, subject?.modelId ?? null),
    ];
    const primary = candidates.find((entry) => entry && this.providers.hasModel(entry)) ?? null;
    return { kind: 'api', chain: this.providers.chain(primary) };
  }

  /** Nimmt eine Nachricht an, legt die leere Antwort an und startet sie. Antwortet sofort. */
  send(chatId: string, content: string): ChatResult<StartedGeneration> {
    return this.start(chatId, content.replace(/\r\n?/g, '\n'), false);
  }

  /**
   * Wiederholt die letzte Antwort, wenn sie fehlschlug, abgebrochen oder unterbrochen wurde. Mit `viaApi`
   * antwortet ein API-Modell statt des gewählten Agenten.
   */
  retry(chatId: string, options: { viaApi?: boolean } = {}): ChatResult<StartedGeneration> {
    return this.start(chatId, null, options.viaApi === true);
  }

  private start(
    chatId: string,
    content: string | null,
    viaApi: boolean,
  ): ChatResult<StartedGeneration> {
    const chat = this.row(chatId);
    if (!chat) return { ok: false, error: 'not_found' };
    if (this.active.has(chatId)) return { ok: false, error: 'busy' };
    if (this.active.size >= this.maxActive) return { ok: false, error: 'too_busy' };
    const target = this.targetFor(chat, viaApi);
    if (target.kind === 'api' && target.chain.length === 0) return { ok: false, error: 'no_model' };
    let release: (() => void) | null = null;
    if (target.kind === 'engine') {
      if (this.activeAgents.size >= this.maxAgents) return { ok: false, error: 'too_busy' };
      release = this.agents?.reserve(chat.subjectId, chat.groupId) ?? null;
      if (!release) return { ok: false, error: 'workspace_busy' };
    }
    const prompt = buildSystemPrompt(this.db, this.defaults, chat.subjectId, chat.groupId);
    if (!prompt.ok) {
      release?.();
      return { ok: false, error: 'not_found' };
    }

    const created = this.db.transaction((tx) => {
      let userRow: MessageRow | undefined;
      let seq: number;
      if (content === null) {
        const last = tx
          .select()
          .from(messages)
          .where(eq(messages.chatId, chatId))
          .orderBy(desc(messages.seq))
          .limit(1)
          .get();
        if (last?.role !== 'assistant' || last.status === 'complete') return null;
        tx.delete(messages).where(eq(messages.id, last.id)).run();
        seq = last.seq;
      } else {
        const top = tx
          .select({ value: max(messages.seq) })
          .from(messages)
          .where(eq(messages.chatId, chatId))
          .get();
        seq = (top?.value ?? 0) + 1;
        userRow = tx
          .insert(messages)
          .values({ chatId, seq, role: 'user', content, status: 'complete' })
          .returning()
          .get();
        seq += 1;
      }
      const assistantRow = tx
        .insert(messages)
        .values({
          chatId,
          seq,
          role: 'assistant',
          content: '',
          status: 'streaming',
          ...(target.kind === 'engine' ? { engineProfileId: target.profileId } : {}),
        })
        .returning()
        .get();
      tx.update(chats)
        .set({
          updatedAt: new Date(),
          ...(content !== null && chat.title === '' ? { title: titleFrom(content) } : {}),
        })
        .where(eq(chats.id, chatId))
        .run();
      const history = tx
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.seq))
        .all()
        .filter((row) => row.id !== assistantRow.id);
      return { userRow, assistantRow, history };
    });
    if (created === null) {
      release?.();
      return { ok: false, error: 'nothing_to_retry' };
    }

    const generation = new Generation(chatId, created.assistantRow.id);
    this.active.set(chatId, generation);
    const history = buildHistory(created.history, this.historyMax);
    if (target.kind === 'engine') {
      this.activeAgents.add(chatId);
      void this.runAgent(generation, {
        release,
        chat,
        profileId: target.profileId,
        system: withAgentInstructions(prompt.value.system),
        history,
        sessionId: chat.agentSessionId,
      });
    } else {
      void this.run(generation, { chain: target.chain, system: prompt.value.system, history });
    }
    return {
      ok: true,
      value: {
        generation,
        userMessage: created.userRow ? toMessage(created.userRow) : null,
        assistantMessage: toMessage(created.assistantRow),
      },
    };
  }

  /**
   * Führt die Antwort über einen Agenten aus. Den Verlauf kennt der Agent aus seiner Sitzung (`--resume`);
   * gibt es keine (erste Nachricht, anderer Zugang, Sitzung verloren), steht der bisherige Verlauf im Auftrag.
   */
  private async runAgent(
    generation: Generation,
    input: {
      /** Gibt den Arbeitsordner frei, wenn der Lauf zu Ende ist. */
      release: (() => void) | null;
      chat: ChatRow;
      profileId: string;
      system: string;
      history: ChatMessage[];
      sessionId: string | null;
    },
  ): Promise<void> {
    const runner = this.agents;
    const lastUser = [...input.history].reverse().find((message) => message.role === 'user');
    let lastFlush = Date.now();
    let outcome: AgentOutcome;
    try {
      if (!runner || !lastUser) throw new Error('Kein Agent oder kein Auftrag.');
      const earlier = input.history.slice(0, input.history.lastIndexOf(lastUser));
      outcome = await runner.run({
        chatId: input.chat.id,
        assistantId: generation.assistantId,
        subjectId: input.chat.subjectId,
        groupId: input.chat.groupId,
        profileId: input.profileId,
        system: input.system,
        prompt: (resumed) =>
          resumed || earlier.length === 0
            ? lastUser.content
            : formatTranscript(earlier, lastUser.content),
        sessionId: input.sessionId,
        signal: generation.abort.signal,
        onEvent: (event) => {
          if (event.type === 'delta') {
            generation.emit({ type: 'delta', text: event.text });
            if (Date.now() - lastFlush >= this.flushIntervalMs) {
              lastFlush = Date.now();
              this.db
                .update(messages)
                .set({ content: generation.text })
                .where(eq(messages.id, generation.assistantId))
                .run();
            }
          } else if (event.type === 'thinking') generation.emit({ type: 'thinking' });
          else generation.emit({ type: 'activity', entry: event.entry });
        },
      });
    } catch {
      outcome = {
        status: 'error',
        code: 'internal',
        sessionId: input.sessionId,
        model: null,
        activity: generation.activity,
        assets: [],
      };
    }
    this.activeAgents.delete(input.chat.id);
    input.release?.();
    this.finish(generation, outcome.status, outcome.code, null, {
      engineProfileId: input.profileId,
      model: outcome.model,
      activity: outcome.activity,
      assets: outcome.assets,
    });
  }

  /**
   * Führt die Antwort aus: probiert die Modelle der Reihe nach. Gewechselt wird nur bei einem Fehler,
   * bei dem ein anderes Modell helfen kann, und nur solange noch kein Text da ist und kein Werkzeug lief.
   * Eine Antwort, die mitten im Text abbricht, bleibt als Teilantwort stehen.
   *
   * Werkzeuge (Stundenplan, Tests): Nur wenn der globale Schalter an ist, der Anbieter sie erlaubt und das
   * Modell sie kann, bekommt das Modell sie angeboten. Ruft es welche auf, laufen sie hier (nur lesend, geprüft,
   * begrenzt), ihre Ergebnisse gehen als Daten zurück an das Modell, höchstens {@link MAX_TOOL_ROUNDS} Runden.
   * Gespeichert wird nur, welches Werkzeug lief, nie Argumente oder Ergebnisse.
   */
  private async run(
    generation: Generation,
    input: {
      chain: Selection[];
      system: string;
      history: ChatMessage[];
    },
  ): Promise<void> {
    const assistantId = generation.assistantId;
    let lastCode: ChatErrorCode = 'no_model';
    let usage: { promptTokens: number | null; completionTokens: number | null } | null = null;
    let lastFlush = Date.now();
    let status: MessageStatus = 'error';
    let code: ChatErrorCode | null = 'no_model';
    let settled = false;

    try {
      for (const [index, selection] of input.chain.entries()) {
        if (generation.abort.signal.aborted) {
          status = 'stopped';
          code = null;
          settled = true;
          break;
        }
        const resolved = await this.providers.resolve(selection);
        if (!resolved) {
          lastCode = 'model_not_found';
          continue;
        }
        generation.emit({
          type: 'model',
          providerId: selection.providerId,
          model: selection.model,
        });
        this.db
          .update(messages)
          .set({ providerId: selection.providerId, model: selection.model })
          .where(eq(messages.id, assistantId))
          .run();
        usage = null;

        const registry = this.tools;
        const toolsOn =
          registry !== null &&
          (this.toolSettings?.enabled() ?? true) &&
          resolved.allowTools &&
          resolved.model.tools;
        const system = toolsOn ? withToolInstructions(input.system, this.now()) : input.system;
        const conversation: ChatMessage[] = [{ role: 'system', content: system }, ...input.history];
        let rounds = 0;
        let calls = 0;
        let usedTools = false;
        // Die Nutzung zählt über alle Runden einer Antwort zusammen.
        const addUsage = (next: {
          promptTokens: number | null;
          completionTokens: number | null;
        }) => {
          usage = {
            promptTokens: sum(usage?.promptTokens ?? null, next.promptTokens),
            completionTokens: sum(usage?.completionTokens ?? null, next.completionTokens),
          };
        };

        try {
          for (;;) {
            let roundText = '';
            let requested: ToolCall[] | null = null;
            const stream = this.providers.client.streamChat(
              resolved.target,
              {
                model: selection.model,
                messages: conversation,
                // In der letzten Runde ohne Werkzeuge: Das Modell muss mit dem antworten, was es hat.
                tools:
                  toolsOn && registry && rounds < MAX_TOOL_ROUNDS ? registry.specs() : undefined,
              },
              generation.abort.signal,
            );
            for await (const event of stream) {
              if (event.type === 'delta') {
                if (event.text === '') continue;
                // Zwischen dem Text vor und nach einem Werkzeugaufruf steht ein Absatz.
                if (roundText === '' && generation.text !== '' && !generation.text.endsWith('\n')) {
                  generation.emit({ type: 'delta', text: '\n\n' });
                }
                roundText += event.text;
                generation.emit({ type: 'delta', text: event.text });
                if (Date.now() - lastFlush >= this.flushIntervalMs) {
                  lastFlush = Date.now();
                  this.db
                    .update(messages)
                    .set({ content: generation.text })
                    .where(eq(messages.id, assistantId))
                    .run();
                }
              } else if (event.type === 'reasoning') {
                generation.emit({ type: 'thinking' });
              } else if (event.type === 'usage') {
                addUsage({
                  promptTokens: event.promptTokens,
                  completionTokens: event.completionTokens,
                });
              } else if (event.type === 'tool_calls') {
                requested = event.calls;
              }
            }

            if (!requested || !toolsOn || !registry) break;
            rounds += 1;
            usedTools = true;
            conversation.push({ role: 'assistant', content: roundText, toolCalls: requested });
            for (const call of requested) {
              if (generation.abort.signal.aborted) break;
              const id = `tool-${calls}`;
              if (calls >= MAX_TOOL_CALLS) {
                conversation.push({
                  role: 'tool',
                  toolCallId: call.id,
                  content: JSON.stringify({ error: 'too_many_calls' }),
                });
                continue;
              }
              calls += 1;
              generation.emit({
                type: 'activity',
                entry: { id, tool: call.name, target: null, state: 'running' },
              });
              const outcome = registry.execute(call.name, call.arguments, {
                db: this.db,
                now: this.now,
              });
              generation.emit({
                type: 'activity',
                entry: {
                  id,
                  tool: call.name,
                  target: outcome.ok ? outcome.target : null,
                  state: outcome.ok ? 'done' : 'error',
                },
              });
              conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
            }
            if (generation.abort.signal.aborted) {
              status = 'stopped';
              code = null;
              settled = true;
              break;
            }
          }
          if (settled) break;
          if (generation.text.trim() === '') {
            // Ein Modell, das nichts sagt: das nächste versuchen, sonst als Fehler melden.
            lastCode = 'empty_response';
            if (usedTools) {
              status = 'error';
              code = lastCode;
              settled = true;
              break;
            }
            continue;
          }
          status = 'complete';
          code = null;
          settled = true;
          break;
        } catch (error) {
          if (error instanceof ProviderError && error.code === 'aborted') {
            status = 'stopped';
            code = null;
            settled = true;
            break;
          }
          // Nie die Meldung eines Fehlers weitergeben: sie könnte Teile von Schlüssel oder Eingabe enthalten.
          const known = error instanceof ProviderError ? error : null;
          lastCode = known?.code ?? 'internal';
          if (
            known?.retryable &&
            generation.text === '' &&
            !usedTools &&
            index < input.chain.length - 1
          ) {
            continue;
          }
          status = 'error';
          code = lastCode;
          settled = true;
          break;
        }
      }
      if (!settled) {
        status = 'error';
        code = lastCode;
      }
    } catch {
      status = 'error';
      code = 'internal';
    }

    this.finish(generation, status, code, usage);
  }

  private finish(
    generation: Generation,
    status: MessageStatus,
    code: ChatErrorCode | null,
    usage: { promptTokens: number | null; completionTokens: number | null } | null,
    agent: {
      engineProfileId: string;
      model: string | null;
      activity: AgentOutcome['activity'];
      assets: AssetView[];
    } | null = null,
  ): void {
    const model = generation.model;
    let view: MessageView | null = null;
    try {
      this.db
        .update(messages)
        .set({
          content: generation.text,
          status,
          errorCode: code,
          ...(model ? { providerId: model.providerId, model: model.model } : {}),
          ...(agent
            ? {
                engineProfileId: agent.engineProfileId,
                model: agent.model,
                activity: serializeActivity(agent.activity),
              }
            : {
                // Werkzeugaufrufe eines Modells: nur Name und Zustand, nie Argumente oder Ergebnisse.
                activity: serializeActivity(
                  settleActivity(generation.activity, status === 'stopped'),
                ),
              }),
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
        })
        .where(eq(messages.id, generation.assistantId))
        .run();
      const row = this.db
        .select()
        .from(messages)
        .where(eq(messages.id, generation.assistantId))
        .get();
      view = row ? toMessage(row, agent?.assets ?? []) : null;
    } catch {
      view = null;
    }
    // Wurde der Chat inzwischen gelöscht, gibt es keine Zeile mehr; das Ende melden wir trotzdem.
    const message: MessageView = view ?? {
      id: generation.assistantId,
      seq: 0,
      role: 'assistant',
      content: generation.text,
      status,
      providerId: model?.providerId ?? null,
      model: model?.model ?? agent?.model ?? null,
      engineProfileId: agent?.engineProfileId ?? null,
      errorCode: code,
      activity: agent?.activity ?? [],
      assets: agent?.assets ?? [],
      createdAt: Date.now(),
    };
    this.active.delete(generation.chatId);
    if (status === 'complete') generation.emit({ type: 'done', message });
    else if (status === 'stopped') generation.emit({ type: 'stopped', message });
    else generation.emit({ type: 'failed', code: code ?? 'internal', message });
  }
}

function sum(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}
