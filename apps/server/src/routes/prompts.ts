import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  buildSystemPrompt,
  getGeneralPrompt,
  getGroupPrompt,
  getSubjectPrompt,
  type SubjectPromptView,
  setGeneralPrompt,
  setGroupPrompt,
  setSubjectPrompt,
} from '../domain/prompts';
import type { DomainResult } from '../domain/subjects';
import { idField, PROMPT_MAX_CHARACTERS, promptField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import { PLACEHOLDERS } from '../prompts/compose';
import type { DefaultPrompts } from '../prompts/defaults';

const PromptBody = z.strictObject({ text: promptField });

// Zeichen können bis zu vier Byte belegen, dazu kommt das JSON drumherum.
const PROMPT_BODY_LIMIT = PROMPT_MAX_CHARACTERS * 4 + 1024;

function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

/**
 * Prompt-Schichten 1 bis 3 lesen und schreiben. Eigene Texte gehören dem Nutzer und werden nur im
 * Datenverzeichnis gespeichert. Nur der Fach-Prompt (Schicht 2) hat einen mitgelieferten Standardtext
 * (D-034): Ohne eigenen Text gilt er, `text: null` heißt also „Standard aktiv“. Schicht 0 steckt im Code.
 */
export function promptRoutes(db: Db, defaults: DefaultPrompts): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/prompts/*', limitBody(PROMPT_BODY_LIMIT));

  app.get('/prompts/variables', (c) => c.json({ variables: PLACEHOLDERS }));

  app.get('/prompts/general', (c) => c.json({ text: getGeneralPrompt(db) }));
  app.put('/prompts/general', async (c) => {
    const body = await readJson(c, PromptBody);
    if (!body.ok) return body.response;
    return c.json({ text: setGeneralPrompt(db, body.data.text) });
  });

  const respond = (c: Context, result: DomainResult<string | null>) =>
    result.ok ? c.json({ text: result.value }) : c.json({ error: 'not_found' }, 404);

  // Antwort: `text` (eigener Text oder null), `defaultText` (Standard des Fachs oder null) und `source`.
  const respondSubject = (c: Context, result: DomainResult<SubjectPromptView>) =>
    result.ok ? c.json(result.value) : c.json({ error: 'not_found' }, 404);

  app.get('/prompts/subjects/:id', (c) => {
    const id = idParam(c);
    return id
      ? respondSubject(c, getSubjectPrompt(db, id, defaults))
      : c.json({ error: 'not_found' }, 404);
  });
  app.put('/prompts/subjects/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, PromptBody);
    if (!body.ok) return body.response;
    return respondSubject(c, setSubjectPrompt(db, id, body.data.text, defaults));
  });

  app.get('/prompts/groups/:id', (c) => {
    const id = idParam(c);
    return id ? respond(c, getGroupPrompt(db, id)) : c.json({ error: 'not_found' }, 404);
  });
  app.put('/prompts/groups/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, PromptBody);
    if (!body.ok) return body.response;
    return respond(c, setGroupPrompt(db, id, body.data.text));
  });

  // Vorschau: so sieht das Modell den System-Prompt für ein Fach (und eine Untergruppe).
  app.get('/prompts/preview', (c) => {
    const subjectId = idField.safeParse(c.req.query('subjectId'));
    if (!subjectId.success) return c.json({ error: 'invalid_input', field: 'subjectId' }, 400);
    const rawGroup = c.req.query('groupId');
    let groupId: string | null = null;
    if (rawGroup !== undefined) {
      const parsed = idField.safeParse(rawGroup);
      if (!parsed.success) return c.json({ error: 'invalid_input', field: 'groupId' }, 400);
      groupId = parsed.data;
    }
    const result = buildSystemPrompt(db, defaults, subjectId.data, groupId);
    return result.ok ? c.json(result.value) : c.json({ error: 'not_found' }, 404);
  });

  return app;
}
