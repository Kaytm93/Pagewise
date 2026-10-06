import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { titleFrom } from '../chats/history';
import type { Db } from '../db/client';
import { chats, messages, notes, subjectGroups, subjects } from '../db/schema';

/** Ein Eintrag in Listen: ohne den ganzen Text, dafür mit einem kurzen Auszug. */
export interface NoteSummary {
  id: string;
  subjectId: string;
  groupId: string | null;
  title: string;
  pinned: boolean;
  tags: string[];
  /** Der Anfang des Textes ohne Blöcke, Formeln, Link-Adressen und Markdown-Zeichen, ohne Wiederholung des Titels, höchstens {@link EXCERPT_LENGTH} Zeichen. */
  excerpt: string;
  sourceChatId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NoteView extends NoteSummary {
  markdown: string;
}

export interface NoteInput {
  subjectId: string;
  groupId: string | null;
  title: string;
  markdown: string;
  pinned: boolean;
  tags: string[];
}

export type NotePatch = Partial<Omit<NoteInput, 'subjectId'>>;

export type NoteFailure = {
  ok: false;
  /**
   * `invalid_subject`: das Fach gibt es nicht. `invalid_group`: die Untergruppe gibt es nicht oder sie gehört zu
   * einem anderen Fach. `too_many`: Obergrenze erreicht. `not_savable`: die Nachricht ist keine fertige
   * Antwort des Modells (falsche Rolle, noch im Gange, Fehler, leer).
   */
  error: 'not_found' | 'invalid_subject' | 'invalid_group' | 'too_many' | 'not_savable';
};
export type NoteResult<T> = { ok: true; value: T } | NoteFailure;

export const MAX_NOTES = 5000;
/** Höchstens so viele Einträge in einer Liste (neueste und angeheftete zuerst). */
export const LIST_LIMIT = 200;
export const MARKDOWN_MAX_CHARACTERS = 100_000;
export const EXCERPT_LENGTH = 160;
/** Wie viel vom Anfang des Textes für den Auszug geladen wird, damit Listen nicht ganze Texte lesen. */
const HEAD_LENGTH = 800;

/** Markdown-Schreibweise weg: `[x](y)` → `x`, `[alt](y)` → ``, `$…$`/`$$…$$` → ``, Zeichen wie `#`/`*`/`\` entfernt. */
const stripMarkdown = (markdown: string): string =>
  markdown
    .replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$(?:[^$\n\\]|\\.|\\\n)+?\$/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)\n]*\)/g, ' ')
    .replace(/(?<!!)\[([^\]]*)\]\([^)\n]*\)/g, '$1')
    .replace(/[#>*_`~$|\\]/g, '')
    .replace(/\[!\w+\]/g, '');

/** Auszug: Blöcke, Formeln und Link-Adressen weg, Leerraum zusammengezogen. */
export function excerptOf(markdown: string): string {
  const text = stripMarkdown(markdown).replace(/\s+/g, ' ').trim();
  const characters = [...text];
  return characters.length > EXCERPT_LENGTH
    ? `${characters
        .slice(0, EXCERPT_LENGTH - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

/** Einrückung und Betonung um die Überschrift zählen nicht; verglichen wird ohne Groß- und Kleinschreibung. */
const headingTextOf = (line: string): string =>
  stripMarkdown(line.replace(/^\s{0,3}#{1,3}\s+/, ''));

/** Auszug ohne Wiederholung des Titels: Eine Überschrift am Anfang, die wie der Titel lautet, bleibt außen vor. */
export function excerptForTitleOf(title: string, markdown: string): string {
  const [firstLine = '', ...lines] = markdown.split('\n');
  const heading = headingTextOf(firstLine);
  const isHeading = /^\s{0,3}#{1,3}\s+\S/.test(firstLine);
  const repeats =
    isHeading && heading !== '' && heading.toLowerCase() === title.trim().toLowerCase();
  return excerptOf(repeats ? lines.join('\n') : markdown);
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

function summaryOf(row: typeof notes.$inferSelect, head: string): NoteSummary {
  return {
    id: row.id,
    subjectId: row.subjectId,
    groupId: row.groupId,
    title: row.title,
    pinned: row.pinned,
    tags: parseTags(row.tags),
    excerpt: excerptForTitleOf(row.title, head),
    sourceChatId: row.sourceChatId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function viewOf(row: typeof notes.$inferSelect): NoteView {
  return { ...summaryOf(row, row.markdown.slice(0, HEAD_LENGTH)), markdown: row.markdown };
}

/** `%` und `_` in der Suche sind gewöhnliche Zeichen, kein Platzhalter. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Die Einträge einer Ansicht: eines Fachs ohne Untergruppe (`groupId` ist `null`, „Allgemein“) oder einer
 * Untergruppe, wie bei den Chats. Angeheftete zuerst, dann nach letzter Änderung. Mit `query` nur Einträge, in
 * deren Titel oder Text die Eingabe vorkommt (ohne Groß- und Kleinschreibung).
 */
export function listNotes(
  db: Db,
  subjectId: string,
  groupId: string | null,
  query?: string,
): NoteSummary[] {
  const scope = and(
    eq(notes.subjectId, subjectId),
    groupId === null ? isNull(notes.groupId) : eq(notes.groupId, groupId),
  );
  const needle = query?.trim();
  const pattern = needle ? `%${escapeLike(needle)}%` : null;
  const match = pattern
    ? or(
        sql`${notes.title} like ${pattern} escape '\\'`,
        sql`${notes.markdown} like ${pattern} escape '\\'`,
      )
    : undefined;
  return db
    .select({ row: notes, head: sql<string>`substr(${notes.markdown}, 1, ${HEAD_LENGTH})` })
    .from(notes)
    .where(match ? and(scope, match) : scope)
    .orderBy(desc(notes.pinned), desc(notes.updatedAt), desc(notes.createdAt))
    .limit(LIST_LIMIT)
    .all()
    .map(({ row, head }) => summaryOf(row, head));
}

export function getNote(db: Db, id: string): NoteView | null {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  return row ? viewOf(row) : null;
}

function groupBelongsTo(db: Db, groupId: string, subjectId: string): boolean {
  return (
    db
      .select({ id: subjectGroups.id })
      .from(subjectGroups)
      .where(and(eq(subjectGroups.id, groupId), eq(subjectGroups.subjectId, subjectId)))
      .get() !== undefined
  );
}

function subjectExists(db: Db, subjectId: string): boolean {
  return (
    db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).get() !==
    undefined
  );
}

export interface NoteSource {
  chatId: string;
  messageId: string;
}

export function createNote(db: Db, input: NoteInput, source?: NoteSource): NoteResult<NoteView> {
  if (!subjectExists(db, input.subjectId)) return { ok: false, error: 'invalid_subject' };
  if (input.groupId !== null && !groupBelongsTo(db, input.groupId, input.subjectId)) {
    return { ok: false, error: 'invalid_group' };
  }
  const total = db.select({ n: count() }).from(notes).get()?.n ?? 0;
  if (total >= MAX_NOTES) return { ok: false, error: 'too_many' };
  const row = db
    .insert(notes)
    .values({
      subjectId: input.subjectId,
      groupId: input.groupId,
      title: input.title,
      markdown: input.markdown,
      pinned: input.pinned,
      tags: JSON.stringify(input.tags),
      sourceChatId: source?.chatId ?? null,
      sourceMessageId: source?.messageId ?? null,
    })
    .returning()
    .get();
  return { ok: true, value: viewOf(row) };
}

export function updateNote(db: Db, id: string, patch: NotePatch): NoteResult<NoteView> {
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return { ok: false, error: 'not_found' };
  if (
    patch.groupId !== undefined &&
    patch.groupId !== null &&
    !groupBelongsTo(db, patch.groupId, existing.subjectId)
  ) {
    return { ok: false, error: 'invalid_group' };
  }
  const { tags, ...rest } = patch;
  const row = db
    .update(notes)
    .set({ ...rest, ...(tags !== undefined && { tags: JSON.stringify(tags) }) })
    .where(eq(notes.id, id))
    .returning()
    .get();
  return row ? { ok: true, value: viewOf(row) } : { ok: false, error: 'not_found' };
}

export function deleteNote(db: Db, id: string): NoteResult<null> {
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  return result.changes > 0 ? { ok: true, value: null } : { ok: false, error: 'not_found' };
}

/** Titel aus einer Antwort: eine Überschrift am Anfang, sonst die erste Zeile; ohne Markdown-Zeichen. */
export function titleOfAnswer(content: string, fallback: string): string {
  const heading = content.split('\n').find((line) => /^\s{0,3}#{1,3}\s+\S/.test(line));
  const source = heading ?? content;
  const cleaned = source.replace(/^\s{0,3}#{1,3}\s+/, '').replace(/[*_`~$>[\]]/g, '');
  const title = titleFrom(cleaned);
  return title !== '' ? title : fallback;
}

/**
 * Macht aus einer fertigen Antwort des Modells einen Hefteintrag. Der Server liest den Text selbst aus der
 * Nachricht (nie vom Browser), die Antwort muss von `assistant` stammen und Text haben; angehaltene oder
 * unterbrochene Antworten sind erlaubt (ihr Text gilt), solche im Gange oder mit Fehler nicht. Fach und
 * Untergruppe übernimmt der Eintrag vom Chat.
 */
export function noteFromMessage(
  db: Db,
  chatId: string,
  messageId: string,
  fallbackTitle: string,
): NoteResult<NoteView> {
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
  if (!chat) return { ok: false, error: 'not_found' };
  const message = db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
    .get();
  if (!message) return { ok: false, error: 'not_found' };
  const savable = ['complete', 'stopped', 'interrupted'].includes(message.status);
  if (message.role !== 'assistant' || !savable || message.content.trim() === '') {
    return { ok: false, error: 'not_savable' };
  }
  const markdown = message.content.slice(0, MARKDOWN_MAX_CHARACTERS);
  return createNote(
    db,
    {
      subjectId: chat.subjectId,
      groupId: chat.groupId,
      title: titleOfAnswer(markdown, chat.title || fallbackTitle),
      markdown,
      pinned: false,
      tags: [],
    },
    { chatId, messageId },
  );
}
