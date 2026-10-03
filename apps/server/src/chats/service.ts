import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
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
import type { ChatMessage } from '../providers/client';
import { ProviderError } from '../providers/errors';
import type { Selection } from '../providers/models';
import type { ProviderService } from '../providers/service';
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
  generating: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDetail extends ChatView {
  messages: MessageView[];
}

export type ChatFailure = {
  ok: false;
  error: 'not_found' | 'unknown_model' | 'busy' | 'too_busy' | 'no_model' | 'nothing_to_retry';
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
}

const TITLE_MAX = 120;

function selectionOf(providerId: string | null, modelId: string | null): Selection | null {
  return providerId && modelId ? { providerId, model: modelId } : null;
}

function toMessage(row: MessageRow): MessageView {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    status: row.status,
    providerId: row.providerId,
    model: row.model,
    errorCode: row.errorCode as ChatErrorCode | null,
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

  constructor(
    private readonly db: Db,
    private readonly providers: ProviderService,
    options: ChatServiceOptions = {},
  ) {
    this.maxActive = options.maxActive ?? 4;
    this.historyMax = options.historyMaxCharacters ?? HISTORY_MAX_CHARACTERS;
    this.flushIntervalMs = options.flushIntervalMs ?? 2_000;
    this.defaults = options.defaults ?? DefaultPrompts.empty();
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
    return { ok: true, value: { ...this.toChat(row), messages: rows.map(toMessage) } };
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

  update(id: string, patch: { title?: string; model?: Selection | null }): ChatResult<ChatView> {
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
    const result = this.db.delete(chats).where(eq(chats.id, id)).run();
    return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
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
      .set({ modelProviderId: model?.providerId ?? null, modelId: model?.model ?? null })
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

  stop(chatId: string): boolean {
    const generation = this.active.get(chatId);
    generation?.abort.abort();
    return generation !== undefined;
  }

  /**
   * Reihenfolge der Modelle für diesen Chat: eigene Wahl, sonst die des Fachs, sonst das
   * Standardmodell, danach die Ausweichmodelle.
   */
  private chainFor(chat: ChatRow): Selection[] {
    const subject = this.db.select().from(subjects).where(eq(subjects.id, chat.subjectId)).get();
    const candidates = [
      selectionOf(chat.modelProviderId, chat.modelId),
      selectionOf(subject?.modelProviderId ?? null, subject?.modelId ?? null),
    ];
    const primary = candidates.find((entry) => entry && this.providers.hasModel(entry)) ?? null;
    return this.providers.chain(primary);
  }

  /** Nimmt eine Nachricht an, legt die leere Antwort an und startet sie. Antwortet sofort. */
  send(chatId: string, content: string): ChatResult<StartedGeneration> {
    return this.start(chatId, content.replace(/\r\n?/g, '\n'));
  }

  /** Wiederholt die letzte Antwort, wenn sie fehlschlug, abgebrochen oder unterbrochen wurde. */
  retry(chatId: string): ChatResult<StartedGeneration> {
    return this.start(chatId, null);
  }

  private start(chatId: string, content: string | null): ChatResult<StartedGeneration> {
    const chat = this.row(chatId);
    if (!chat) return { ok: false, error: 'not_found' };
    if (this.active.has(chatId)) return { ok: false, error: 'busy' };
    if (this.active.size >= this.maxActive) return { ok: false, error: 'too_busy' };
    const chain = this.chainFor(chat);
    if (chain.length === 0) return { ok: false, error: 'no_model' };
    const prompt = buildSystemPrompt(this.db, this.defaults, chat.subjectId, chat.groupId);
    if (!prompt.ok) return { ok: false, error: 'not_found' };

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
        .values({ chatId, seq, role: 'assistant', content: '', status: 'streaming' })
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
    if (created === null) return { ok: false, error: 'nothing_to_retry' };

    const generation = new Generation(chatId, created.assistantRow.id);
    this.active.set(chatId, generation);
    void this.run(generation, {
      chain,
      system: prompt.value.system,
      history: buildHistory(created.history, this.historyMax),
    });
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
   * Führt die Antwort aus: probiert die Modelle der Reihe nach. Gewechselt wird nur bei einem Fehler,
   * bei dem ein anderes Modell helfen kann, und nur solange noch kein Text da ist. Eine Antwort, die
   * mitten im Text abbricht, bleibt als Teilantwort stehen.
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

        try {
          const stream = this.providers.client.streamChat(
            resolved.target,
            {
              model: selection.model,
              messages: [{ role: 'system', content: input.system }, ...input.history],
            },
            generation.abort.signal,
          );
          for await (const event of stream) {
            if (event.type === 'delta') {
              if (event.text === '') continue;
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
              usage = {
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
              };
            }
          }
          if (generation.text.trim() === '') {
            // Ein Modell, das nichts sagt: das nächste versuchen, sonst als Fehler melden.
            lastCode = 'empty_response';
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
          if (known?.retryable && generation.text === '' && index < input.chain.length - 1)
            continue;
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
      view = row ? toMessage(row) : null;
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
      model: model?.model ?? null,
      errorCode: code,
      createdAt: Date.now(),
    };
    this.active.delete(generation.chatId);
    if (status === 'complete') generation.emit({ type: 'done', message });
    else if (status === 'stopped') generation.emit({ type: 'stopped', message });
    else generation.emit({ type: 'failed', code: code ?? 'internal', message });
  }
}
