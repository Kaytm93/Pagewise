import { join } from 'node:path';
import { AssetService } from './agents/assets';
import { CliDetector, type DetectOptions } from './agents/detect';
import { EngineProfileService } from './agents/profiles';
import { WorkspaceManager } from './agents/workspace';
import { AttemptLimiter } from './auth/attempt-limiter';
import { AuthService } from './auth/auth-service';
import type { ScryptParams } from './auth/passcode';
import { SessionService } from './auth/sessions';
import { ChatService, type ChatServiceOptions } from './chats/service';
import { type DatabaseHandle, migrateDatabase, openDatabase } from './db/client';
import { loadSubjectCatalog, type SubjectCatalog } from './domain/subject-templates';
import { ensureDefaultSubject } from './domain/subjects';
import { APP_ROOT } from './paths';
import { DefaultPrompts } from './prompts/defaults';
import { ProviderClient } from './providers/client';
import { ProviderService } from './providers/service';
import { type DataPaths, ensureDataLayout } from './storage/data-paths';
import { DataEraser } from './storage/eraser';
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
  /** Zugänge für den Agent-CLI-Adapter (Claude-Abo, GLM Coding Plan, Anthropic-Schlüssel). */
  engines: EngineProfileService;
  /** Erkennt das Programm „claude“ auf diesem Rechner. */
  cli: CliDetector;
  /** Arbeitsordner der Agenten (`workspaces/`). */
  workspaces: WorkspaceManager;
  /** Von Agenten erzeugte Dateien (`assets/`). */
  assets: AssetService;
  /** Vorlagen für Fächer (Katalog), aus `config/subject-catalog.json`. */
  catalog: SubjectCatalog;
  /** Mitgelieferte Standard-Prompts je Fach (D-034), aus `prompts/defaults`. */
  defaults: DefaultPrompts;
  chats: ChatService;
  eraser: DataEraser;
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
  /** Nur für Tests: andere Katalogdatei und anderer Ordner für die Standard-Prompts. */
  catalogFile?: string;
  defaultsDir?: string;
  /** Nur für Tests: wo und wie nach „claude“ gesucht wird. */
  cliDetect?: DetectOptions;
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
  const engines = new EngineProfileService(database.db, secrets);
  const storage = new LocalStorage(paths.assets);
  const assets = new AssetService(database.db, storage);
  const workspaces = new WorkspaceManager(paths.workspaces);
  const cli = new CliDetector({
    explicitPath: process.env.PAGEWISE_CLAUDE_PATH ?? null,
    ...options.cliDetect,
  });
  const catalog = loadSubjectCatalog(
    options.catalogFile ?? join(APP_ROOT, 'config', 'subject-catalog.json'),
  );
  const defaults = DefaultPrompts.load(
    options.defaultsDir ?? join(APP_ROOT, 'prompts', 'defaults'),
    catalog,
  );
  const chats = new ChatService(database.db, providers, { ...options.chats, defaults, engines });
  // Das eingebaute Fach „Standard“ (fachunabhängiger Chat) gehört immer dazu.
  ensureDefaultSubject(database.db);
  return {
    paths,
    database,
    storage,
    secrets,
    sessions,
    auth,
    providers,
    engines,
    cli,
    workspaces,
    assets,
    catalog,
    defaults,
    chats,
    eraser: new DataEraser({ database, paths, secrets, chats }),
    close: () => database.close(),
  };
}
