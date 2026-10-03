import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { DataDirError, prepareDataDir } from './data-dir';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..', '..');

function readVersion(): string {
  const raw = readFileSync(resolve(here, '..', 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
}

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  let dataDir: string;
  try {
    config = loadConfig(process.env);
    dataDir = prepareDataDir(process.env, { appRoot });
  } catch (error) {
    if (error instanceof ConfigError || error instanceof DataDirError) {
      console.error(`Schulheft startet nicht.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const app = createApp({
    version: readVersion(),
    webDist: resolve(appRoot, 'apps', 'web', 'dist'),
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    const host = info.family === 'IPv6' ? `[${info.address}]` : info.address;
    console.log(`Schulheft läuft auf http://${host}:${info.port}`);
    console.log(`Datenverzeichnis: ${dataDir}`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
