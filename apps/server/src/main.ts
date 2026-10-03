import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { DataDirError, prepareDataDir } from './data-dir';
import { DatabaseError } from './db/client';
import { APP_ROOT } from './paths';
import { createServices, type Services } from './services';
import { SecretStoreError } from './storage/secret-store';
import { StorageError } from './storage/storage';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = APP_ROOT;

function readVersion(): string {
  const raw = readFileSync(resolve(here, '..', 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
}

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  let dataDir: string;
  let services: Services;
  try {
    config = loadConfig(process.env);
    dataDir = prepareDataDir(process.env, { appRoot });
    services = createServices(dataDir);
  } catch (error) {
    if (
      error instanceof ConfigError ||
      error instanceof DataDirError ||
      error instanceof DatabaseError ||
      error instanceof SecretStoreError ||
      error instanceof StorageError
    ) {
      console.error(`Pagewise startet nicht.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const app = createApp({
    version: readVersion(),
    webDist: resolve(appRoot, 'apps', 'web', 'dist'),
    services,
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    const host = info.family === 'IPv6' ? `[${info.address}]` : info.address;
    console.log(`Pagewise läuft auf http://${host}:${info.port}`);
    console.log(`Datenverzeichnis: ${dataDir}`);

    // Solange noch kein Passcode gesetzt ist, braucht die Einrichtung diesen Code. Er gilt nur bis
    // zur Einrichtung (D-021) und steht deshalb nur hier in der Konsole.
    const setupCode = services.auth.pendingSetupCode();
    if (setupCode) {
      console.log('');
      console.log('Pagewise ist noch nicht eingerichtet.');
      console.log(`Einrichtungscode: ${setupCode}`);
      console.log(`Öffne http://${host}:${info.port} und lege deinen Passcode fest.`);
    }
  });

  const shutdown = (): void => {
    server.close(() => {
      services.close();
      process.exit(0);
    });
    setTimeout(() => {
      services.close();
      process.exit(0);
    }, 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
