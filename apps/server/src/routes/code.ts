import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CodeExecutor } from '../code/executor';
import { idField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import type { PreviewService } from '../preview/render';
import { platformKey } from '../python/pins';
import type { PythonRuntime } from '../python/runtime';
import type { PythonSetup } from '../python/setup';
import { sandboxSupported } from '../sandbox/runner';
import type { ToolSettings } from '../tools/settings';

const SetupBody = z.strictObject({ confirm: z.literal(true) });

export interface CodeRouteDeps {
  settings: ToolSettings;
  runtime: PythonRuntime;
  setup: PythonSetup;
  executor: CodeExecutor;
  preview: PreviewService;
  /** Ob Plattform und Lock die Einrichtung erlauben. Nur in Tests anders. */
  supported?: () => boolean;
}

/**
 * Code-Ausführung (D-079): Zustand, Einrichtung des privaten Python (nur auf Klick, mit ausdrücklicher Bestätigung)
 * und das Skript eines Laufs zum Ansehen. Das Skript wird nur als Text geliefert, nie ausgeführt oder dargestellt.
 */
export function codeRoutes(deps: CodeRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const supported = deps.supported ?? (() => platformKey() !== null && sandboxSupported());

  const status = async () => {
    const runtime = deps.runtime.state();
    return {
      supported: supported(),
      enabled: deps.settings.codeEnabled(),
      runtime,
      setup: deps.setup.status(),
      // Der Selbsttest läuft nur, wenn es etwas zu prüfen gibt.
      ready: runtime === 'ready' ? await deps.executor.ready() : false,
      // Sichtprüfung (D-080): optional, braucht LibreOffice und poppler.
      preview: { ...deps.preview.capabilities(), sandbox: sandboxSupported() },
    };
  };

  app.use('/code/*', limitBody(1024));
  app.get('/code/status', async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await status());
  });

  app.post('/code/setup', async (c) => {
    if (!supported()) return c.json({ error: 'unsupported' }, 409);
    const body = await readJson(c, SetupBody);
    if (!body.ok) return body.response;
    void deps.setup.start();
    return c.json(await status(), 202);
  });

  app.post('/code/setup/cancel', async (c) => {
    deps.setup.cancel();
    return c.json(await status());
  });

  app.delete('/code/runtime', async (c) => {
    await deps.setup.remove();
    return c.json(await status());
  });

  app.get('/code-runs/:id', (c: Context) => {
    const parsed = idField.safeParse(c.req.param('id'));
    if (!parsed.success) return c.json({ error: 'not_found' }, 404);
    const run = deps.executor.get(parsed.data);
    if (!run) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({
      id: run.id,
      purpose: run.purpose,
      outcome: run.outcome,
      durationMs: run.durationMs,
      files: run.files,
      script: run.script,
    });
  });

  return app;
}
