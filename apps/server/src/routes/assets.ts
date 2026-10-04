import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AssetService } from '../agents/assets';
import { idField } from '../http/fields';
import type { AppEnv } from '../http/types';

/** Dateiname für den Kopf `Content-Disposition`: ASCII-Rückfall plus UTF-8-Fassung (RFC 5987). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Von Agenten erzeugte Dateien herunterladen. Sie werden nie im Browser dargestellt, immer als Download
 * ausgeliefert (`Content-Disposition: attachment`), mit dem von Pagewise festgelegten Typ und ohne Typ-Erraten
 * des Browsers (`nosniff`). Die strenge CSP der App gilt auch hier (globale Kopfzeilen).
 */
export function assetRoutes(assets: AssetService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/assets/:id/download', async (c: Context) => {
    const parsed = idField.safeParse(c.req.param('id'));
    if (!parsed.success) return c.json({ error: 'not_found' }, 404);
    const row = assets.get(parsed.data);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const data = await assets.read(row.id);
    if (!data) return c.json({ error: 'not_found' }, 404);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': row.mime,
        'Content-Length': String(data.length),
        'Content-Disposition': contentDisposition(row.name),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });

  return app;
}
