import { chmodSync, closeSync, existsSync, openSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import * as schema from './schema';

/** Fehler an der Datenbank, die Meldung ist für Menschen gedacht. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Sqlite.Database;
  close(): void;
}

const here = dirname(fileURLToPath(import.meta.url));
/** SQL-Dateien der Migrationen, liegen neben dem Quelltext im Repo (apps/server/drizzle). */
export const DEFAULT_MIGRATIONS_FOLDER = resolve(here, '..', '..', 'drizzle');

const BACKUP_PREFIX = 'pagewise-vor-migration-';
const BACKUPS_TO_KEEP = 5;

/**
 * Öffnet die SQLite-Datei. Neue Dateien entstehen mit Rechten 600. Fremdschlüssel sind an,
 * WAL ist an, gelöschte Inhalte werden überschrieben (`secure_delete`), damit Löschen auch
 * wirklich löscht.
 */
export function openDatabase(file: string): DatabaseHandle {
  if (file !== ':memory:') {
    closeSync(openSync(file, 'a', 0o600));
    chmodSync(file, 0o600);
  }
  const sqlite = new Sqlite(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('secure_delete = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export interface MigrateOptions {
  migrationsFolder?: string;
  /** Hierhin kommt vor einer Migration einer bestehenden Datenbank eine Sicherung. */
  backupDir?: string;
  now?: () => Date;
}

/** Zeitstempel der zuletzt angewendeten Migration, `null` bei einer frischen Datenbank. */
function lastAppliedMigration(sqlite: Sqlite.Database): number | null {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!table) return null;
  const row = sqlite
    .prepare('select max(created_at) as latest from __drizzle_migrations')
    .get() as {
    latest: number | null;
  };
  return row.latest ?? null;
}

function backupBeforeMigration(sqlite: Sqlite.Database, backupDir: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = join(backupDir, `${BACKUP_PREFIX}${stamp}.db`);
  // VACUUM INTO schreibt eine konsistente Kopie, auch im WAL-Betrieb.
  sqlite.prepare('VACUUM INTO ?').run(target);
  chmodSync(target, 0o600);

  const old = readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db'))
    .sort();
  for (const name of old.slice(0, Math.max(0, old.length - BACKUPS_TO_KEEP))) {
    rmSync(join(backupDir, name), { force: true });
  }
  return target;
}

/**
 * Wendet ausstehende Migrationen an. Gibt es welche und die Datenbank enthält schon Daten,
 * entsteht vorher eine Sicherung (die letzten fünf bleiben). Eine Datenbank, die von einer
 * neueren Version stammt, wird nicht angefasst.
 */
export function migrateDatabase(handle: DatabaseHandle, options: MigrateOptions = {}): void {
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const migrations = readMigrationFiles({ migrationsFolder });
  const latestKnown = migrations.reduce((max, m) => Math.max(max, m.folderMillis), 0);
  const lastApplied = lastAppliedMigration(handle.sqlite);

  if (lastApplied !== null && lastApplied > latestKnown) {
    throw new DatabaseError(
      'Die Datenbank stammt von einer neueren Pagewise-Version und wird nicht verändert. Aktualisiere Pagewise.',
    );
  }

  const pending = lastApplied === null ? migrations.length > 0 : latestKnown > lastApplied;
  if (pending && lastApplied !== null && options.backupDir && existsSync(options.backupDir)) {
    backupBeforeMigration(handle.sqlite, options.backupDir, (options.now ?? (() => new Date()))());
  }

  migrate(handle.db, { migrationsFolder });
}
