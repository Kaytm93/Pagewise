import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { idField, nameField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import { ModelListSchema, SelectionSchema } from '../providers/models';
import { PRESETS } from '../providers/presets';
import { MAX_FALLBACKS, type ProviderService, type ServiceFailure } from '../providers/service';

const ApiKey = z.string().min(1).max(4096);

const CreateBody = z.strictObject({
  name: nameField,
  preset: z.enum(['openrouter', 'zai', 'ollama', 'lmstudio', 'custom']).default('custom'),
  baseUrl: z.string().max(200).optional(),
  apiKey: ApiKey.optional(),
  models: ModelListSchema.optional(),
  sendImages: z.boolean().optional(),
});

const UpdateBody = z
  .strictObject({
    name: nameField.optional(),
    baseUrl: z.string().max(200).optional(),
    models: ModelListSchema.optional(),
    sendImages: z.boolean().optional(),
    apiKey: ApiKey.optional(),
    clearKey: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine((body) => !(body.apiKey !== undefined && body.clearKey));

const ModelSettingsBody = z.strictObject({
  default: SelectionSchema.nullable(),
  fallback: z.array(SelectionSchema).max(MAX_FALLBACKS),
});

function failure(c: Context, result: ServiceFailure): Response {
  switch (result.error) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'name_taken':
      return c.json({ error: 'name_taken' }, 409);
    case 'invalid_url':
      return c.json({ error: 'invalid_input', field: 'baseUrl', reason: 'invalid' }, 400);
    case 'insecure_url':
      return c.json({ error: 'invalid_input', field: 'baseUrl', reason: 'insecure' }, 400);
    case 'invalid_key':
      return c.json({ error: 'invalid_input', field: 'apiKey' }, 400);
    case 'unknown_model':
      return c.json({ error: 'invalid_input', field: 'model' }, 400);
    case 'provider_failed':
      return c.json({ error: 'provider_failed', code: result.code }, 502);
  }
}

function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

/**
 * Anbieter, Schlüssel und Modellwahl. Keine Antwort enthält einen Schlüssel: die Oberfläche
 * erfährt nur, ob einer gesetzt ist, und bei langen Schlüsseln die letzten vier Zeichen.
 */
export function providerRoutes(service: ProviderService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/providers', limitBody(64 * 1024));
  app.use('/providers/*', limitBody(64 * 1024));
  app.use('/model-settings', limitBody(16 * 1024));

  app.get('/provider-presets', (c) =>
    c.json({
      presets: PRESETS.map((preset) => ({
        id: preset.id,
        baseUrl: preset.baseUrl,
        requiresKey: preset.requiresKey,
        models: preset.models,
      })),
    }),
  );

  app.get('/providers', async (c) => c.json({ providers: await service.list() }));

  app.post('/providers', async (c) => {
    const body = await readJson(c, CreateBody);
    if (!body.ok) return body.response;
    const result = await service.create(body.data);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/providers/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, UpdateBody);
    if (!body.ok) return body.response;
    const result = await service.update(id, body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/providers/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = await service.remove(id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  app.post('/providers/:id/test', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = await service.test(id, c.req.raw.signal);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.get('/providers/:id/available-models', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = await service.discover(id, c.req.raw.signal);
    return result.ok ? c.json({ models: result.value }) : failure(c, result);
  });

  app.get('/model-settings', (c) => c.json(service.modelSettings()));

  app.put('/model-settings', async (c) => {
    const body = await readJson(c, ModelSettingsBody);
    if (!body.ok) return body.response;
    const result = service.setModelSettings(body.data);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  return app;
}
