import { Hono } from 'hono';
import { z } from 'zod';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { ToolSettings } from '../tools/settings';

const Body = z.strictObject({ enabled: z.boolean() });

/** Globaler Schalter für den Werkzeugzugriff der KI (`/api/tool-settings`). */
export function toolSettingsRoutes(settings: ToolSettings): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/tool-settings', limitBody(1024));
  app.get('/tool-settings', (c) => c.json({ enabled: settings.enabled() }));
  app.put('/tool-settings', async (c) => {
    const body = await readJson(c, Body);
    if (!body.ok) return body.response;
    settings.setEnabled(body.data.enabled);
    return c.json({ enabled: settings.enabled() });
  });
  return app;
}
