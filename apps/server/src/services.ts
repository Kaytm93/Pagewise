import { join } from 'node:path';
import { type DatabaseHandle, migrateDatabase, openDatabase } from './db/client';
import { type DataPaths, ensureDataLayout } from './storage/data-paths';
import { FileSecretStore, type SecretStore } from './storage/secret-store';
import { LocalStorage, type Storage } from './storage/storage';

/** Alles, was auf das Datenverzeichnis zugreift. Wird beim Start einmal gebaut. */
export interface Services {
  paths: DataPaths;
  database: DatabaseHandle;
  storage: Storage;
  secrets: SecretStore;
  close(): void;
}

/**
 * Baut die Dienste für ein bereits geprüftes Datenverzeichnis: legt Unterordner an, öffnet
 * die Datenbank und wendet ausstehende Migrationen an.
 */
export function createServices(dataDir: string): Services {
  const paths = ensureDataLayout(dataDir);
  const database = openDatabase(paths.database);
  try {
    migrateDatabase(database, { backupDir: paths.backups });
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    paths,
    database,
    storage: new LocalStorage(paths.assets),
    secrets: new FileSecretStore(join(paths.secrets, 'secrets.json')),
    close: () => database.close(),
  };
}
