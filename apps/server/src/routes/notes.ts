import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  MARKDOWN_MAX_CHARACTERS,
  type NoteFailure,
  noteFromMessage,
  updateNote,
} from '../domain/notes';
import { idField, titleField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';

// Text eines Hefteintrags: Zeilenumbrüche und Tabs erlaubt, andere Steuerzeichen nicht, Windows-Zeilenenden
// werden vereinheitlicht. Anders als bei Prompts ist ein leerer Text erlaubt (ein neuer, leerer Eintrag).
const markdownField = z
  .string()
  .max(MARKDOWN_MAX_CHARACTERS)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
  .transform((value) => value.replace(/\r\n?/g, '\n'));

// Stichwörter: bis zu 10, je 1 bis 30 Zeichen ohne Steuerzeichen, doppelte (ohne Groß und Klein) fallen weg.
const tagsField = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(30)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
      .regex(/^[^\u0000-\u001f\u007f]*$/),
  )
  .max(10)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

const NoteBody = z.strictObject({
  subjectId: idField,
  groupId: idField.nullable().default(null),
  title: titleField,
  markdown: markdownField.default(''),
  pinned: z.boolean().default(false),
  tags: tagsField.default([]),
});
const NotePatch = z
  .strictObject({
    groupId: idField.nullable().optional(),
    title: titleField.optional(),
    markdown: markdownField.optional(),
    pinned: z.boolean().optional(),
    tags: tagsField.optional(),
  })
  .refine((body) => Object.keys(body).length > 0);
const NoteQuery = z.strictObject({
  subjectId: idField,
  groupId: idField.optional(),
  q: z.string().max(100).optional(),
});

function failure(c: Context, result: NoteFailure): Response {
  switch (result.error) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'invalid_subject':
      return c.json({ error: 'invalid_input', field: 'subjectId' }, 400);
    case 'invalid_group':
      return c.json({ error: 'invalid_input', field: 'groupId' }, 400);
    case 'too_many':
      return c.json({ error: 'too_many' }, 409);
    case 'not_savable':
      return c.json({ error: 'not_savable' }, 409);
  }
}

function idParam(c: Context, name = 'id'): string | null {
  const parsed = idField.safeParse(c.req.param(name));
  return parsed.success ? parsed.data : null;
}

/**
 * Hefteinträge (`/api/notes`) und „Antwort als Hefteintrag speichern“
 * (`POST /api/chats/:chatId/messages/:messageId/note`). Alles bleibt lokal. Der Text wird unverändert
 * gespeichert; bereinigt wird beim Anzeigen (siehe `@pagewise/render`).
 */
export function noteRoutes(db: Db, fallbackTitle: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Ein Eintrag fasst höchstens 100.000 Zeichen (bis 4 Byte je Zeichen) plus Titel und Stichwörter.
  app.use('/notes', limitBody(512 * 1024));
  app.use('/notes/*', limitBody(512 * 1024));

  app.get('/notes', (c) => {
    const parsed = NoteQuery.safeParse(c.req.query());
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return c.json(
        { error: 'invalid_input', field: typeof field === 'string' ? field : null },
        400,
      );
    }
    const { subjectId, groupId, q } = parsed.data;
    return c.json({ notes: listNotes(db, subjectId, groupId ?? null, q) });
  });

  app.post('/notes', async (c) => {
    const body = await readJson(c, NoteBody);
    if (!body.ok) return body.response;
    const result = createNote(db, body.data);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.get('/notes/:id', (c) => {
    const id = idParam(c);
    const note = id ? getNote(db, id) : null;
    return note ? c.json(note) : c.json({ error: 'not_found' }, 404);
  });

  app.patch('/notes/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, NotePatch);
    if (!body.ok) return body.response;
    const result = updateNote(db, id, body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/notes/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = deleteNote(db, id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  app.post('/chats/:chatId/messages/:messageId/note', (c) => {
    const chatId = idParam(c, 'chatId');
    const messageId = idParam(c, 'messageId');
    if (!chatId || !messageId) return c.json({ error: 'not_found' }, 404);
    const result = noteFromMessage(db, chatId, messageId, fallbackTitle);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  return app;
}
