import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { ToolsFs } from './tools';

/** Dateizugriff des Updates, schmal und austauschbar (Tests arbeiten in einem Wegwerf-Ordner oder mit Attrappen). */
export interface UpdateFs extends ToolsFs {
  exists(path: string): boolean;
  isWritable(path: string): boolean;
  readText(path: string): string | null;
  /** Schreibt atomar (Temp-Datei, dann umbenennen) mit Rechten 600. */
  writeText(path: string, text: string): void;
  appendText(path: string, text: string): void;
  mkdir(path: string): void;
  remove(path: string): void;
  /** Freier Platz (Byte) auf dem Datenträger des Pfads oder des nächsten vorhandenen Elternordners. */
  freeBytes(path: string): number | null;
}

export function realUpdateFs(): UpdateFs {
  const isFile = (path: string): boolean => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  return {
    exists: (path) => existsSync(path),
    isFile,
    isExecutable: (path) => {
      try {
        if (!statSync(path).isFile()) return false;
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    isWritable: (path) => {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.tmp`;
      writeFileSync(temp, text, { mode: 0o600 });
      renameSync(temp, path);
    },
    appendText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, text, { mode: 0o600 });
    },
    mkdir: (path) => {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    },
    remove: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    freeBytes: (path) => {
      let current = path;
      for (let i = 0; i < 12; i++) {
        try {
          const stats = statfsSync(current);
          return Number(stats.bavail) * Number(stats.bsize);
        } catch {
          const parent = dirname(current);
          if (parent === current) return null;
          current = parent;
        }
      }
      return null;
    },
  };
}
