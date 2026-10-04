import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateCliPath } from '../agents/cli-path';
import type { CliStatus } from '../agents/detect';
import {
  ENGINE_KINDS,
  type EngineProfileService,
  GLM_BASE_URL,
  GLM_DEFAULT_MODEL,
  MAX_TIMEOUT_MINUTES,
  MODEL_PATTERN,
  type ProfileFailure,
} from '../agents/profiles';
import { idField, nameField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { Services } from '../services';

const modelField = z.string().trim().regex(MODEL_PATTERN).nullable();
const timeoutField = z.number().int().min(1).max(MAX_TIMEOUT_MINUTES);
const tokenField = z.string().min(1).max(4096);

const CreateBody = z.strictObject({
  kind: z.enum(ENGINE_KINDS),
  name: nameField,
  model: modelField.optional(),
  timeoutMinutes: timeoutField.optional(),
  token: tokenField.optional(),
});
const UpdateBody = z
  .strictObject({
    name: nameField.optional(),
    model: modelField.optional(),
    timeoutMinutes: timeoutField.optional(),
    token: tokenField.optional(),
    clearToken: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);

function failure(c: Context, result: ProfileFailure): Response {
  switch (result.error) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'name_taken':
    case 'too_many':
      return c.json({ error: result.error }, 409);
    case 'token_required':
    case 'token_not_allowed':
    case 'secret_failed':
      return c.json({ error: 'invalid_input', field: 'token', reason: result.error }, 400);
  }
}

function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

/** Was die Oberfläche über das gefundene Programm erfährt. Pfade sind die auf diesem Rechner. */
function cliView(status: CliStatus, configuredPath: string | null) {
  return status.state === 'ready'
    ? {
        state: status.state,
        path: status.path,
        version: status.version,
        skipped: status.skipped,
        configuredPath,
      }
    : { state: status.state, path: null, version: null, skipped: status.skipped, configuredPath };
}

const CliPathBody = z.strictObject({ path: z.string().max(1024).nullable() });

/** Beschreibung der Arten, damit die Oberfläche nichts fest einbauen muss. */
const KINDS = [
  { kind: 'claude-subscription', needsToken: false, defaultModel: null, endpoint: null },
  {
    kind: 'glm-coding-plan',
    needsToken: true,
    defaultModel: GLM_DEFAULT_MODEL,
    endpoint: GLM_BASE_URL,
  },
  { kind: 'anthropic-api', needsToken: true, defaultModel: null, endpoint: null },
] as const;

/**
 * Agent-CLI (Phase 1e): die Zugänge für das Programm „claude“ und dessen Erkennung. Schlüssel gehen nur hinein
 * (`token`), nie heraus: Antworten enthalten `hasToken` und bei langen Schlüsseln die letzten vier Zeichen.
 */
export function engineRoutes(
  services: Pick<Services, 'engines' | 'cli' | 'cliPath'>,
): Hono<AppEnv> {
  const engines: EngineProfileService = services.engines;
  const app = new Hono<AppEnv>();
  app.use('/engines', limitBody(16 * 1024));
  app.use('/engines/*', limitBody(16 * 1024));

  // Schnell: nur Datenbank und Secret-Speicher, kein Programmstart. Die Oberfläche lädt das immer mit.
  app.get('/engines', async (c) => c.json({ kinds: KINDS, profiles: await engines.list() }));

  // Das gefundene Programm. Die Suche startet Programme und kann etwas dauern, deshalb getrennt und zwischengespeichert.
  app.get('/engines/cli', async (c) =>
    c.json({ cli: cliView(await services.cli.status(), services.cliPath.get()) }),
  );

  // Erneut nach dem Programm suchen (z. B. nach der Installation).
  app.post('/engines/detect', async (c) =>
    c.json({ cli: cliView(await services.cli.status(true), services.cliPath.get()) }),
  );

  // Pfad zu „claude“ von Hand eintragen (eine aus Finder oder Anmeldung gestartete App hat nur einen knappen PATH).
  // `null` entfernt ihn. Der Pfad muss absolut sein und die Datei „claude“ heißen (siehe `validateCliPath`).
  app.put('/engines/cli-path', async (c) => {
    const body = await readJson(c, CliPathBody);
    if (!body.ok) return body.response;
    let path: string | null = null;
    if (body.data.path !== null) {
      path = validateCliPath(body.data.path);
      if (path === null) return c.json({ error: 'invalid_input', field: 'path' }, 400);
    }
    services.cliPath.set(path);
    return c.json({ cli: cliView(await services.cli.status(true), services.cliPath.get()) });
  });

  app.post('/engines', async (c) => {
    const body = await readJson(c, CreateBody);
    if (!body.ok) return body.response;
    const input = {
      ...body.data,
      // Das GLM-Profil bekommt die Voreinstellung für alle Stufen, solange nichts anderes gewählt ist.
      model: body.data.model ?? null,
    };
    const result = await engines.create(input);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/engines/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, UpdateBody);
    if (!body.ok) return body.response;
    const result = await engines.update(id, body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/engines/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = await engines.remove(id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  return app;
}
