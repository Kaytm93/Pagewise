import { Hono } from 'hono';
import { z } from 'zod';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { ToolSettings } from '../tools/settings';

const Body = z
  .strictObject({ enabled: z.boolean().optional(), files: z.boolean().optional() })
  .refine((body) => body.enabled !== undefined || body.files !== undefined);

const view = (settings: ToolSettings) => ({
  enabled: settings.enabled(),
  files: settings.filesEnabled(),
});

/** Globale Schalter für den Werkzeugzugriff der KI: Stundenplan und Tests, Dateien (`/api/tool-settings`). */
export function toolSettingsRoutes(settings: ToolSettings): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/tool-settings', limitBody(1024));
  app.get('/tool-settings', (c) => c.json(view(settings)));
  app.put('/tool-settings', async (c) => {
    const body = await readJson(c, Body);
    if (!body.ok) return body.response;
    if (body.data.enabled !== undefined) settings.setEnabled(body.data.enabled);
    if (body.data.files !== undefined) settings.setFilesEnabled(body.data.files);
    return c.json(view(settings));
  });
  return app;
}
