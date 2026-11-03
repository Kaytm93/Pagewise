import { Hono } from 'hono';
import { z } from 'zod';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { ToolSettings } from '../tools/settings';

const Body = z
  .strictObject({
    enabled: z.boolean().optional(),
    files: z.boolean().optional(),
    code: z.boolean().optional(),
    /** Wer Code-Ausführung einschaltet, bestätigt die Erklärung ausdrücklich (D-079). */
    confirm: z.boolean().optional(),
  })
  .refine(
    (body) => body.enabled !== undefined || body.files !== undefined || body.code !== undefined,
  );

const view = (settings: ToolSettings) => ({
  enabled: settings.enabled(),
  files: settings.filesEnabled(),
  code: settings.codeEnabled(),
});

/** Globale Schalter für den Werkzeugzugriff der KI: Stundenplan und Tests, Dateien (`/api/tool-settings`). */
export function toolSettingsRoutes(settings: ToolSettings): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/tool-settings', limitBody(1024));
  app.get('/tool-settings', (c) => c.json(view(settings)));
  app.put('/tool-settings', async (c) => {
    const body = await readJson(c, Body);
    if (!body.ok) return body.response;
    if (body.data.code === true && body.data.confirm !== true) {
      return c.json({ error: 'confirmation_required' }, 400);
    }
    if (body.data.enabled !== undefined) settings.setEnabled(body.data.enabled);
    if (body.data.files !== undefined) settings.setFilesEnabled(body.data.files);
    if (body.data.code !== undefined) settings.setCodeEnabled(body.data.code);
    return c.json(view(settings));
  });
  return app;
}
