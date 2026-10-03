import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Alle Orte im Datenverzeichnis. Nutzerdaten liegen ausschließlich hier, nie im Repo. */
export interface DataPaths {
  root: string;
  /** SQLite-Datei (WAL legt daneben `-wal` und `-shm` an). */
  database: string;
  assets: string;
  workspaces: string;
  logs: string;
  /** Ordner für die Secrets-Datei. */
  secrets: string;
  backups: string;
}

const SUBDIRECTORIES = ['assets', 'workspaces', 'logs', 'secrets', 'backups'] as const;

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Gehört der Ordner jemand anderem, lassen wir die Rechte unverändert.
  }
}

/**
 * Legt die Unterordner des (bereits geprüften) Datenverzeichnisses mit Rechten 700 an.
 * Die Prüfung gegen Git-Arbeitsverzeichnisse macht `prepareDataDir`, nicht diese Funktion.
 */
export function ensureDataLayout(root: string): DataPaths {
  ensureDirectory(root);
  for (const name of SUBDIRECTORIES) ensureDirectory(join(root, name));
  return {
    root,
    database: join(root, 'pagewise.db'),
    assets: join(root, 'assets'),
    workspaces: join(root, 'workspaces'),
    logs: join(root, 'logs'),
    secrets: join(root, 'secrets'),
    backups: join(root, 'backups'),
  };
}
