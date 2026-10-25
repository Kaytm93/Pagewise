import { Hono } from 'hono';
import { z } from 'zod';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { WebSearchService } from '../search/service';
import { SecretStoreError } from '../storage/secret-store';

const ApiKey = z.string().min(1).max(4096);

const Body = z
  .strictObject({
    enabled: z.boolean().optional(),
    apiKey: ApiKey.optional(),
    clearKey: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine((body) => !(body.apiKey !== undefined && body.clearKey));

/** Websuche (`/api/web-search`): Schalter, Schlüssel und Verbindungstest. Der Schlüssel kommt nie zurück. */
export function webSearchRoutes(search: WebSearchService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/web-search', limitBody(8192));
  app.use('/web-search/*', limitBody(8192));
  app.get('/web-search', async (c) => c.json(await search.status()));
  app.put('/web-search', async (c) => {
    const body = await readJson(c, Body);
    if (!body.ok) return body.response;
    if (body.data.enabled !== undefined) search.setEnabled(body.data.enabled);
    if (body.data.apiKey !== undefined) {
      try {
        await search.setKey(body.data.apiKey);
      } catch (error) {
        if (error instanceof SecretStoreError) {
          return c.json({ error: 'invalid_input', field: 'apiKey' }, 400);
        }
        throw error;
      }
    }
    if (body.data.clearKey) await search.clearKey();
    return c.json(await search.status());
  });
  app.post('/web-search/test', async (c) => c.json(await search.test()));
  return app;
}
