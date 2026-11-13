import { join } from 'node:path';
import { AssetService } from './agents/assets';
import { AgentCleanup } from './agents/cleanup';
import { CliPathSetting } from './agents/cli-path';
import { CodexEngine } from './agents/codex';
import { CliDetector, type DetectOptions } from './agents/detect';
import { ClaudeCodeEngine, type EngineOptions } from './agents/engine';
import { OpenCodeEngine } from './agents/opencode';
import { EngineProfileService } from './agents/profiles';
import { AgentRunner } from './agents/runner';
import { WorkspaceManager } from './agents/workspace';
import { ArtifactService } from './artifacts/service';
import { AttemptLimiter } from './auth/attempt-limiter';
import { AuthService } from './auth/auth-service';
import type { ScryptParams } from './auth/passcode';
import { SessionService } from './auth/sessions';
import { ChatService, type ChatServiceOptions } from './chats/service';
import { CodeExecutor } from './code/executor';
import { type DatabaseHandle, migrateDatabase, openDatabase } from './db/client';
import { dedupeChatNotesOnce } from './domain/notes-dedupe';
import { loadSubjectCatalog, type SubjectCatalog } from './domain/subject-templates';
import { ensureDefaultSubject } from './domain/subjects';
import { type ResourcePaths, resolveResources } from './paths';
import { PreviewService } from './preview/render';
import { DefaultPrompts } from './prompts/defaults';
import { ProviderClient } from './providers/client';
import { ProviderService } from './providers/service';
import { REQUIREMENTS_LOCK } from './python/lock';
import { platformKey } from './python/pins';
import { PythonRuntime } from './python/runtime';
import { PythonSetup } from './python/setup';
import { SandboxGuard } from './sandbox/probe';
import type { runSandboxed } from './sandbox/runner';
import { WebSearchService } from './search/service';
import { type DataPaths, ensureDataLayout } from './storage/data-paths';
import { DataEraser } from './storage/eraser';
import { FileSecretStore, type SecretStore } from './storage/secret-store';
import { LocalStorage, type Storage } from './storage/storage';
import { PeriodTimes } from './timetable-scan/periods';
import { TimetableScanService } from './timetable-scan/service';
import { createToolRegistry, type ToolRegistry } from './tools';
import { ToolSettings } from './tools/settings';

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
  /** Von Hand eingetragener Pfad zu „claude“ (Vorrang vor Umgebungsvariable und Suche). */
  cliPath: CliPathSetting;
  /** Arbeitsordner der Agenten (`workspaces/`). */
  workspaces: WorkspaceManager;
  /** Von Agenten erzeugte Dateien (`assets/`). */
  assets: AssetService;
  /** Vom Modell über Werkzeuge angelegte Dateien (Spezifikationen, D-074). */
  artifacts: ArtifactService;
  /** Räumt beim Löschen von Fächern und Untergruppen Dateien und Arbeitsordner der Agenten auf. */
  cleanup: AgentCleanup;
  /** Vorlagen für Fächer (Katalog), aus `config/subject-catalog.json`. */
  catalog: SubjectCatalog;
  /** Mitgelieferte Standard-Prompts je Fach (D-034), aus `prompts/defaults`. */
  defaults: DefaultPrompts;
  /** Werkzeuge, die Chat-Modelle aufrufen dürfen (nur lesend: Stundenplan und Tests). */
  tools: ToolRegistry;
  /** Globaler Schalter für den Werkzeugzugriff der KI. */
  toolSettings: ToolSettings;
  /** Websuche für das Werkzeug `web_search`: Schalter und Schlüssel (standardmäßig aus). */
  webSearch: WebSearchService;
  /** Das private Python der Code-Ausführung: Erkennung, Einrichtung (nur auf Klick), Läufe (D-079). */
  pythonRuntime: PythonRuntime;
  pythonSetup: PythonSetup;
  sandboxGuard: SandboxGuard;
  code: CodeExecutor;
  /** Sichtprüfung von Dateien mit LibreOffice und poppler in der Sandbox (D-080). */
  preview: PreviewService;
  chats: ChatService;
  /** Stundenplan aus einem Bild erkennen (D-107): Vision-Modelle, Vorschau, Übernahme. */
  timetableScan: TimetableScanService;
  /** Stundentafel des Bild-Scans: Nummern von Unterrichtsstunden und ihre Uhrzeiten. */
  timetableScanPeriods: PeriodTimes;
  eraser: DataEraser;
  close(): void;
}

export interface ServicesOptions {
  /** Nur für Tests: schwächere (schnellere) Hash-Parameter. */
  scryptParams?: ScryptParams;
  limiter?: AttemptLimiter;
  /** Nur für Tests: ersetzt `fetch` für Anfragen an Modell-Anbieter. */
  fetch?: typeof fetch;
  /** Nur für Tests: ersetzt `fetch` für Anfragen an den Suchdienst. */
  searchFetch?: typeof fetch;
  /** Nur für Tests: Grenzen und Takt des Chat-Dienstes. */
  chats?: ChatServiceOptions;
  /** Mitgelieferte Dateien (Migrationen, Katalog, Standard-Prompts). Ohne Angabe: `PAGEWISE_RESOURCES_DIR` oder das Repo. */
  resources?: ResourcePaths;
  /** Pfad zur `better_sqlite3.node` des gebündelten Servers. Ohne Angabe: `PAGEWISE_SQLITE_BINDING`, sonst sucht better-sqlite3 selbst. */
  sqliteBinding?: string;
  /** Nur für Tests: andere Katalogdatei und anderer Ordner für die Standard-Prompts. */
  catalogFile?: string;
  defaultsDir?: string;
  /** Nur für Tests: wo und wie nach „claude“ gesucht wird. */
  cliDetect?: DetectOptions;
  /** Nur für Tests: Umgebung, Benutzerverzeichnis und Zusatzvariablen des Agent-Prozesses. */
  agent?: Omit<EngineOptions, 'dataRoot'>;
  /** Nur für Tests: ersetzt Plattform, Lock, Sandbox-Lauf und Selbsttest der Code-Ausführung. */
  code?: {
    runtime?: PythonRuntime;
    guard?: SandboxGuard;
    run?: typeof runSandboxed;
    setup?: Partial<ConstructorParameters<typeof PythonSetup>[0]>;
  };
  /** Nur für Tests: ersetzt die Sichtprüfung (Suche der Programme, Sandbox-Lauf). */
  preview?: Partial<ConstructorParameters<typeof PreviewService>[0]>;
}

/**
 * Baut die Dienste für ein bereits geprüftes Datenverzeichnis: legt Unterordner an, öffnet
 * die Datenbank und wendet ausstehende Migrationen an.
 */
export function createServices(dataDir: string, options: ServicesOptions = {}): Services {
  const resources = options.resources ?? resolveResources(process.env);
  const paths = ensureDataLayout(dataDir);
  const database = openDatabase(paths.database, {
    nativeBinding:
      options.sqliteBinding ?? (process.env.PAGEWISE_SQLITE_BINDING?.trim() || undefined),
  });
  try {
    migrateDatabase(database, {
      backupDir: paths.backups,
      migrationsFolder: resources.migrations,
    });
  } catch (error) {
    database.close();
    throw error;
  }
  // Einmalig nach dem Update auf D-121: wortgleiche doppelte Hefteinträge aus dem Chat entfernen, vorher
  // sichern; scheitert die Sicherung, bleibt alles, der Start geht weiter (wirft nie).
  dedupeChatNotesOnce(database, { backupDir: paths.backups });
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
  const artifacts = new ArtifactService(database.db);
  const workspaces = new WorkspaceManager(paths.workspaces);
  const cliPath = new CliPathSetting(database.db);
  const cli = new CliDetector({
    explicitPath: () => cliPath.get() ?? process.env.PAGEWISE_CLAUDE_PATH ?? null,
    ...options.cliDetect,
  });
  const catalog = loadSubjectCatalog(options.catalogFile ?? resources.catalogFile);
  const defaults = DefaultPrompts.load(options.defaultsDir ?? resources.defaultsDir, catalog);
  const runner = new AgentRunner({
    db: database.db,
    engines,
    cli,
    workspaces,
    assets,
    engine: new ClaudeCodeEngine({ ...options.agent, dataRoot: paths.root }),
    opencode: new OpenCodeEngine({ ...options.agent, dataRoot: paths.root }),
    codex: new CodexEngine({ ...options.agent, dataRoot: paths.root }),
  });
  const tools = createToolRegistry();
  const toolSettings = new ToolSettings(database.db);
  const webSearch = new WebSearchService(database.db, secrets, { fetch: options.searchFetch });
  const pythonRuntime = options.code?.runtime ?? new PythonRuntime(paths.root);
  const sandboxGuard = options.code?.guard ?? new SandboxGuard();
  const key = platformKey();
  const pythonSetup = new PythonSetup({
    runtime: pythonRuntime,
    guard: sandboxGuard,
    platform: key,
    lock: key ? (REQUIREMENTS_LOCK[key] ?? null) : null,
    timeZone: process.env.TZ,
    ...options.code?.setup,
  });
  const code = new CodeExecutor({
    db: database.db,
    runtime: pythonRuntime,
    guard: sandboxGuard,
    workspaces,
    assets,
    timeZone: process.env.TZ,
    ...(options.code?.run ? { run: options.code.run } : {}),
  });
  const preview = new PreviewService({
    workspaces,
    // LibreOffice darf das Datenverzeichnis nie lesen, auch wenn es außerhalb des Benutzerverzeichnisses liegt.
    denyRead: [paths.root],
    ...options.preview,
  });
  const chats = new ChatService(database.db, providers, {
    ...options.chats,
    defaults,
    engines,
    agents: runner,
    assets,
    artifacts,
    code,
    preview,
    tools,
    toolSettings,
    web: webSearch,
    workspaces,
  });
  const cleanup = new AgentCleanup(database.db, chats, assets, workspaces);
  const timetableScanPeriods = new PeriodTimes(database.db);
  const timetableScan = new TimetableScanService(
    database.db,
    providers,
    catalog,
    timetableScanPeriods,
  );
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
    cliPath,
    workspaces,
    assets,
    artifacts,
    cleanup,
    catalog,
    defaults,
    tools,
    toolSettings,
    webSearch,
    pythonRuntime,
    pythonSetup,
    sandboxGuard,
    code,
    preview,
    chats,
    timetableScan,
    timetableScanPeriods,
    eraser: new DataEraser({ database, paths, secrets, chats }),
    close: () => database.close(),
  };
}
