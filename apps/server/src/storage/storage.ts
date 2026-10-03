import { randomBytes } from 'node:crypto';
import { type Dirent, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isInside, realpathLoose } from '../data-dir';

/** Fehler im Storage, die Meldung ist für Menschen gedacht und enthält nie Dateiinhalte. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Ablage für Dateien (später Bilder, Exporte). Die Schnittstelle ist asynchron und kennt nur
 * Schlüssel, keine Pfade, damit ein anderer Speicherort (Phase 2) ohne Umbau möglich bleibt.
 */
export interface Storage {
  put(key: string, data: Uint8Array | string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** Entfernt die Datei wirklich. Gibt `false` zurück, wenn es sie nicht gab. */
  delete(key: string): Promise<boolean>;
  /** Alle Schlüssel unterhalb von `prefix` (oder alle), sortiert. */
  list(prefix?: string): Promise<string[]>;
}

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MAX_KEY_LENGTH = 255;
const TEMP_PREFIX = '.tmp-';

/** Prüft einen Schlüssel wie `bilder/2026/abc.png`. Keine Punkt-Segmente, keine absoluten Pfade. */
export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new StorageError('Ungültiger Speicherschlüssel.');
  }
  for (const segment of key.split('/')) {
    if (!SEGMENT.test(segment)) throw new StorageError('Ungültiger Speicherschlüssel.');
  }
}

/** Dateiablage im Datenverzeichnis: Dateien mit Rechten 600, Ordner mit 700, atomares Schreiben. */
export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
  }

  /** Löst einen Schlüssel auf und verweigert alles, was über Symlinks aus dem Ordner führt. */
  private resolveKey(key: string): string {
    assertValidKey(key);
    const target = resolve(this.root, ...key.split('/'));
    if (!isInside(realpathLoose(dirname(target)), this.root) || !isInside(target, this.root)) {
      throw new StorageError('Der Speicherschlüssel führt aus dem Speicherordner heraus.');
    }
    try {
      if (lstatSync(target).isSymbolicLink()) {
        throw new StorageError('Symbolische Verknüpfungen werden nicht verwendet.');
      }
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // Datei gibt es noch nicht, das ist beim Schreiben der Normalfall.
    }
    return target;
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    const target = this.resolveKey(key);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    // Erst in eine Temp-Datei im selben Ordner, dann umbenennen: nie halb geschriebene Dateien.
    const temp = join(dirname(target), `${TEMP_PREFIX}${randomBytes(8).toString('hex')}`);
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(temp, { force: true });
      throw error;
    }
    await handle.close();
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const target = this.resolveKey(key);
    try {
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async delete(key: string): Promise<boolean> {
    const target = this.resolveKey(key);
    try {
      await rm(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    if (prefix !== undefined) assertValidKey(prefix);
    const base = prefix ? resolve(this.root, ...prefix.split('/')) : this.root;
    if (!isInside(realpathLoose(base), this.root)) {
      throw new StorageError('Der Speicherschlüssel führt aus dem Speicherordner heraus.');
    }
    const keys: string[] = [];
    const walk = async (dir: string, parts: string[]): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(TEMP_PREFIX)) continue;
        const next = [...parts, entry.name];
        if (entry.isDirectory()) await walk(join(dir, entry.name), next);
        else if (entry.isFile()) keys.push(next.join('/'));
      }
    };
    await walk(base, prefix ? prefix.split('/') : []);
    return keys.sort();
  }
}
