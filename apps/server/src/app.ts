import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { csrfGuard, loadSession } from './auth/http';
import type { AppEnv } from './http/types';
import { authRoutes } from './routes/auth';
import type { Services } from './services';

export interface AppOptions {
  version: string;
  /** Ordner mit der gebauten Oberfläche (apps/web/dist). Fehlt er, liefert der Server nur die API. */
  webDist?: string;
  /** Ohne Dienste antwortet nur /api/health. Der Server übergibt sie immer. */
  services?: Services;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Strenge Content-Security-Policy: alles nur von der eigenen Herkunft.
  // Wird mit den Hefteintrag-Blöcken (Phase 1b) bei Bedarf gezielt erweitert.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'no-referrer',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    }),
  );

  // API-Antworten werden nie zwischengespeichert.
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (c) => c.json({ status: 'ok', version: options.version }));

  const services = options.services;
  if (services) {
    app.use('/api/*', loadSession(services.sessions));
    app.use('/api/*', csrfGuard);
    app.route('/api', authRoutes({ auth: services.auth, sessions: services.sessions }));
  }

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  const webDist = options.webDist;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    // serveStatic erwartet einen Pfad relativ zum Arbeitsverzeichnis.
    const root = relative(process.cwd(), webDist) || '.';
    app.use('*', serveStatic({ root }));

    // Einseiten-App: unbekannte Pfade (außer /api) liefern index.html.
    app.get('*', async (c) => {
      const html = await readFile(join(webDist, 'index.html'), 'utf8');
      return c.html(html);
    });
  }

  return app;
}
