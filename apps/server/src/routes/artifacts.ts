import type { Context } from 'hono';
import { Hono } from 'hono';
import type { ArtifactService } from '../artifacts/service';
import { idField } from '../http/fields';
import type { AppEnv } from '../http/types';

/**
 * Eine vom Modell angelegte Datei lesen (`GET /api/artifacts/:id`): Art, Titel und geprüfte Spezifikation. Die
 * Oberfläche baut daraus Vorschau und Download. Die Antwort ist JSON und wird nie als Seite dargestellt.
 */
export function artifactRoutes(artifacts: ArtifactService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/artifacts/:id', (c: Context) => {
    const parsed = idField.safeParse(c.req.param('id'));
    if (!parsed.success) return c.json({ error: 'not_found' }, 404);
    const artifact = artifacts.get(parsed.data);
    if (!artifact) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      version: artifact.version,
      spec: artifact.spec,
    });
  });

  return app;
}
