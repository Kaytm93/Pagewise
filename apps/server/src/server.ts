import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { DataDirError, prepareDataDir } from './data-dir';
import { DatabaseError } from './db/client';
import {
  acquireInstanceLock,
  type InstanceLock,
  InstanceLockError,
  type LockOptions,
} from './instance-lock';
import { type ResourcePaths, resolveResources } from './paths';
import { createServices, type Services, type ServicesOptions } from './services';
import { SecretStoreError } from './storage/secret-store';
import { StorageError } from './storage/storage';

/** Der Port ist belegt (läuft schon Pagewise oder ein anderes Programm?). Die Meldung ist für Menschen gedacht. */
export class PortInUseError extends Error {
  constructor(
    readonly host: string,
    readonly port: number,
  ) {
    super(
      [
        `Der Port ${port} auf ${host} ist belegt.`,
        'Läuft Pagewise schon, oder nutzt ein anderes Programm diesen Port?',
        'Pagewise wechselt nicht stillschweigend auf einen anderen Port, weil Anmeldung, Einstellungen',
        'und die Freigabe über Tailscale Serve an Adresse und Port hängen.',
        'Beende das andere Programm oder setze PAGEWISE_PORT.',
      ].join('\n'),
    );
    this.name = 'PortInUseError';
  }
}

/** Fehler beim Start, die eine Erklärung für Menschen tragen (statt eines Stacktraces). */
export function isStartupError(error: unknown): error is Error {
  return (
    error instanceof ConfigError ||
    error instanceof DataDirError ||
    error instanceof DatabaseError ||
    error instanceof SecretStoreError ||
    error instanceof StorageError ||
    error instanceof InstanceLockError ||
    error instanceof PortInUseError
  );
}

export interface StartServerOptions {
  /** Quelle für `PAGEWISE_*`. Standard: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Überschreibt `PAGEWISE_PORT` (0 wählt einen freien Port, nur für Tests). */
  port?: number;
  /** Überschreibt `PAGEWISE_DATA_DIR`. Geprüft wird es trotzdem (nie im Repo oder in der Anwendung). */
  dataDir?: string;
  /** Überschreibt `PAGEWISE_RESOURCES_DIR` (flacher Aufbau des gebündelten Servers). */
  resourcesDir?: string;
  /** Pfad zur `better_sqlite3.node` neben dem Bundle. */
  sqliteBinding?: string;
  /** Nur für Tests: Dienste anders aufbauen (schnellere Hash-Parameter, Ersatz für `fetch`). */
  services?: ServicesOptions;
  /** Nur für Tests: Sperre mit anderer Prozessnummer. */
  lock?: LockOptions;
}

export interface ServerStatus {
  port: number;
  /** Antworten, die gerade laufen. */
  activeChats: number;
  /** Gültige Anmeldungen (nicht „Geräte“: Browser und installierte App haben je eigene). */
  sessions: number;
  setupPending: boolean;
}

export interface RunningServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly dataDir: string;
  readonly resources: ResourcePaths;
  readonly services: Services;
  /**
   * Einrichtungscode, solange noch kein Passcode gesetzt ist, sonst `null`. Er wird nirgends protokolliert und
   * über keinen HTTP-Endpunkt ausgeliefert (hinter Tailscale Serve wäre er für das ganze Tailnet lesbar, D-021).
   */
  setupCode(): string | null;
  status(): ServerStatus;
  /** Beendet geordnet: nimmt nichts Neues an, markiert laufende Antworten als unterbrochen, schließt Datenbank und Sperre. */
  stop(options?: { timeoutMs?: number }): Promise<void>;
}

function readVersion(file: string): string {
  try {
    const raw = readFileSync(file, 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function listen(host: string, port: number, app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }) as Server;
    const onError = (error: NodeJS.ErrnoException): void => {
      server.close();
      reject(error.code === 'EADDRINUSE' ? new PortInUseError(host, port) : error);
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

/**
 * Startet Pagewise als Bibliothek: Konfiguration prüfen, Datenverzeichnis prüfen, Sperre nehmen, Dienste
 * bauen, lauschen. Wirft bei Problemen einen Fehler aus {@link isStartupError} mit einer Erklärung.
 * `main.ts` (Befehlszeile, `pnpm start`) und die Mac-App benutzen dieselbe Funktion.
 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const host = config.host;
  const port = options.port ?? config.port;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`Ungültiger Port: ${port}.`);
  }
  const resources = resolveResources(env, options.resourcesDir);
  const dataDir = prepareDataDir(
    options.dataDir ? { ...env, PAGEWISE_DATA_DIR: options.dataDir } : env,
    { appRoot: resources.root },
  );

  const lock: InstanceLock = acquireInstanceLock(dataDir, options.lock);
  const releaseOnExit = (): void => lock.release();
  process.once('exit', releaseOnExit);

  let services: Services;
  let server: Server;
  try {
    services = createServices(dataDir, {
      resources,
      sqliteBinding: options.sqliteBinding ?? (env.PAGEWISE_SQLITE_BINDING?.trim() || undefined),
      ...options.services,
    });
    try {
      const app = createApp({
        version: readVersion(resources.versionFile),
        webDist: resources.webDist,
        services,
      });
      server = await listen(host, port, app);
    } catch (error) {
      services.close();
      throw error;
    }
  } catch (error) {
    process.off('exit', releaseOnExit);
    lock.release();
    throw error;
  }

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  lock.setPort(boundPort);
  const urlHost = host.includes(':') ? `[${host}]` : host;

  let stopping: Promise<void> | null = null;
  const running: RunningServer = {
    host,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
    dataDir,
    resources,
    services,
    setupCode: () => services.auth.pendingSetupCode(),
    status: () => ({
      port: boundPort,
      activeChats: services.chats.activeCount(),
      sessions: services.sessions.countActive(),
      setupPending: services.auth.pendingSetupCode() !== null,
    }),
    stop(stopOptions = {}) {
      stopping ??= (async () => {
        const timeoutMs = stopOptions.timeoutMs ?? 5_000;
        // Zuerst nichts Neues mehr annehmen, dann laufende Antworten beenden (sie werden als unterbrochen
        // gespeichert, der Teiltext bleibt), dann die übrigen Verbindungen (Ströme) schließen.
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeIdleConnections();
        try {
          await services.chats.shutdown(Math.max(500, timeoutMs - 1_000));
        } finally {
          const force = setTimeout(() => server.closeAllConnections(), 500);
          force.unref();
          const giveUp = setTimeout(() => server.closeAllConnections(), timeoutMs);
          giveUp.unref();
          await closed;
          clearTimeout(force);
          clearTimeout(giveUp);
          services.close();
          process.off('exit', releaseOnExit);
          lock.release();
        }
      })();
      return stopping;
    },
  };
  return running;
}
