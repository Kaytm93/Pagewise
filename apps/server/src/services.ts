import { join } from 'node:path';
import { AttemptLimiter } from './auth/attempt-limiter';
import { AuthService } from './auth/auth-service';
import type { ScryptParams } from './auth/passcode';
import { SessionService } from './auth/sessions';
import { ChatService, type ChatServiceOptions } from './chats/service';
import { type DatabaseHandle, migrateDatabase, openDatabase } from './db/client';
import { ProviderClient } from './providers/client';
import { ProviderService } from './providers/service';
import { type DataPaths, ensureDataLayout } from './storage/data-paths';
import { FileSecretStore, type SecretStore } from './storage/secret-store';
import { LocalStorage, type Storage } from './storage/storage';

/** Alles, was auf das Datenverzeichnis zugreift. Wird beim Start einmal gebaut. */
export interface Services {
  paths: DataPaths;
  database: DatabaseHandle;
  storage: Storage;
  secrets: SecretStore;
  sessions: SessionService;
  auth: AuthService;
  providers: ProviderService;
  chats: ChatService;
  close(): void;
}

export interface ServicesOptions {
  /** Nur für Tests: schwächere (schnellere) Hash-Parameter. */
  scryptParams?: ScryptParams;
  limiter?: AttemptLimiter;
  /** Nur für Tests: ersetzt `fetch` für Anfragen an Modell-Anbieter. */
  fetch?: typeof fetch;
  /** Nur für Tests: Grenzen und Takt des Chat-Dienstes. */
  chats?: ChatServiceOptions;
}

/**
 * Baut die Dienste für ein bereits geprüftes Datenverzeichnis: legt Unterordner an, öffnet
 * die Datenbank und wendet ausstehende Migrationen an.
 */
export function createServices(dataDir: string, options: ServicesOptions = {}): Services {
  const paths = ensureDataLayout(dataDir);
  const database = openDatabase(paths.database);
  try {
    migrateDatabase(database, { backupDir: paths.backups });
  } catch (error) {
    database.close();
    throw error;
  }
  const sessions = new SessionService(database.db);
  sessions.purgeExpired();
  const auth = new AuthService({
    db: database.db,
    sessions,
    limiter: options.limiter ?? new AttemptLimiter(),
    scryptParams: options.scryptParams,
  });
  const secrets = new FileSecretStore(join(paths.secrets, 'secrets.json'));
  const providers = new ProviderService(
    database.db,
    secrets,
    new ProviderClient({ fetch: options.fetch }),
  );
  return {
    paths,
    database,
    storage: new LocalStorage(paths.assets),
    secrets,
    sessions,
    auth,
    providers,
    chats: new ChatService(database.db, providers, options.chats),
    close: () => database.close(),
  };
}
