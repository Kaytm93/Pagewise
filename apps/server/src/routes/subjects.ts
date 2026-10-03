import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  createGroup,
  createSubject,
  type DomainFailure,
  deleteGroup,
  deleteSubject,
  listSubjects,
  renameGroup,
  renameSubject,
} from '../domain/subjects';
import { idField, nameField } from '../http/fields';
import { readJson } from '../http/json';
import type { AppEnv } from '../http/types';

const NameBody = z.strictObject({ name: nameField });

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

/** Fächer und Untergruppen. Navigation: Fach → Untergruppe, jede Antwort enthält nur eigene Daten. */
export function subjectRoutes(db: Db): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(
    '*',
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
  );

  app.get('/subjects', (c) => c.json({ subjects: listSubjects(db) }));

  app.post('/subjects', async (c) => {
    const body = await readJson(c, NameBody);
    if (!body.ok) return body.response;
    const result = createSubject(db, body.data.name);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/subjects/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, NameBody);
    if (!body.ok) return body.response;
    const result = renameSubject(db, id, body.data.name);
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
    const body = await readJson(c, NameBody);
    if (!body.ok) return body.response;
    const result = createGroup(db, id, body.data.name);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/groups/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, NameBody);
    if (!body.ok) return body.response;
    const result = renameGroup(db, id, body.data.name);
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
