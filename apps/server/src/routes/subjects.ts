import { join } from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  IMPORT_MAX_CHARACTERS,
  type ImportParse,
  parseSubjectImport,
} from '../domain/subject-import';
import { loadSubjectTemplates } from '../domain/subject-templates';
import {
  createGroup,
  createSubject,
  type DomainFailure,
  deleteGroup,
  deleteSubject,
  importSubjects,
  listSubjects,
  updateGroup,
  updateSubject,
} from '../domain/subjects';
import { hoursField, iconField, idField, nameField, optionalTextField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import { APP_ROOT } from '../paths';

const SubjectDetailsBody = {
  teacher: optionalTextField.optional(),
  hoursPerWeek: hoursField.optional(),
  icon: iconField.optional(),
};
const CreateSubjectBody = z.strictObject({ name: nameField, ...SubjectDetailsBody });
const UpdateSubjectBody = z
  .strictObject({ name: nameField.optional(), ...SubjectDetailsBody })
  .refine((body) => Object.keys(body).length > 0);

const CreateGroupBody = z.strictObject({ name: nameField, kind: optionalTextField.optional() });
const UpdateGroupBody = z
  .strictObject({ name: nameField.optional(), kind: optionalTextField.optional() })
  .refine((body) => Object.keys(body).length > 0);

const ImportBody = z.strictObject({
  format: z.enum(['json', 'csv']),
  content: z.string().max(IMPORT_MAX_CHARACTERS),
});

function failure(c: Context, result: DomainFailure): Response {
  return result.error === 'name_taken'
    ? c.json({ error: 'name_taken' }, 409)
    : c.json({ error: 'not_found' }, 404);
}

/** Gültige ID aus dem Pfad oder `null`. Ungültige IDs verhalten sich wie unbekannte (404). */
function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

function importFailure(c: Context, parsed: Extract<ImportParse, { ok: false }>): Response {
  return c.json({ error: 'invalid_input', field: 'content', reason: parsed.reason }, 400);
}

const IMPORT_PATH = /\/subjects\/import$/;

/** Fächer und Untergruppen. Navigation: Fach → Untergruppe, jede Antwort enthält nur eigene Daten. */
export function subjectRoutes(db: Db, options: { templatesFile?: string } = {}): Hono<AppEnv> {
  const templatesFile =
    options.templatesFile ?? join(APP_ROOT, 'config', 'examples', 'subjects.example.json');
  const app = new Hono<AppEnv>();

  // Nur für die eigenen Pfade; der Import darf größer sein als alles andere.
  const small = limitBody(16 * 1024);
  const unlessImport: MiddlewareHandler = (c, next) =>
    IMPORT_PATH.test(c.req.path) ? next() : small(c, next);
  app.use('/subjects', small);
  app.use('/subjects/*', unlessImport);
  app.use('/groups/*', small);
  app.use('/subjects/import', limitBody(2 * IMPORT_MAX_CHARACTERS));

  app.get('/subjects', (c) => c.json({ subjects: listSubjects(db) }));

  // Neutrale Namensvorschläge fürs Onboarding. Es wird nichts angelegt.
  app.get('/subjects/templates', (c) => c.json({ subjects: loadSubjectTemplates(templatesFile) }));

  app.post('/subjects', async (c) => {
    const body = await readJson(c, CreateSubjectBody);
    if (!body.ok) return body.response;
    const { name, ...details } = body.data;
    const result = createSubject(db, name, details);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  // Import aus einer lokalen Datei (JSON oder CSV), die der Browser als Text mitschickt.
  app.post('/subjects/import', async (c) => {
    const body = await readJson(c, ImportBody);
    if (!body.ok) return body.response;
    const parsed = parseSubjectImport(body.data.format, body.data.content);
    if (!parsed.ok) return importFailure(c, parsed);
    const summary = importSubjects(db, parsed.entries);
    return c.json({ ...summary, invalid: parsed.invalid, subjects: listSubjects(db) });
  });

  app.patch('/subjects/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, UpdateSubjectBody);
    if (!body.ok) return body.response;
    const result = updateSubject(db, id, body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/subjects/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = deleteSubject(db, id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  app.post('/subjects/:id/groups', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, CreateGroupBody);
    if (!body.ok) return body.response;
    const result = createGroup(db, id, body.data.name, body.data.kind ?? null);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/groups/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, UpdateGroupBody);
    if (!body.ok) return body.response;
    const result = updateGroup(db, id, body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/groups/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = deleteGroup(db, id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  return app;
}
