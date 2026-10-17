import { dirname } from 'node:path';
import type { UpdateFs } from './fs';
import type { Runner, RunOptions, RunResult } from './runner';

/** Dateisystem im Speicher für die Tests des Updates: nichts davon berührt die Platte. */
export class MemoryFs implements UpdateFs {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly executables = new Set<string>();
  readonly unwritable = new Set<string>();
  free: number | null = 50 * 1024 ** 3;
  removed: string[] = [];

  private markParents(path: string): void {
    for (let p = dirname(path); p !== '/' && p !== '.'; p = dirname(p)) this.dirs.add(p);
  }

  addDir(path: string): this {
    this.dirs.add(path);
    this.markParents(path);
    return this;
  }
  addFile(path: string, text = ''): this {
    this.files.set(path, text);
    this.markParents(path);
    return this;
  }
  addExecutable(path: string): this {
    this.executables.add(path);
    return this.addFile(path);
  }

  exists = (path: string): boolean => this.files.has(path) || this.dirs.has(path);
  isFile = (path: string): boolean => this.files.has(path);
  isExecutable = (path: string): boolean => this.executables.has(path);
  isWritable = (path: string): boolean => !this.unwritable.has(path);
  listDir = (path: string): string[] => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const entry of [...this.files.keys(), ...this.dirs]) {
      if (entry.startsWith(prefix)) names.add(entry.slice(prefix.length).split('/')[0] ?? '');
    }
    return [...names].filter(Boolean);
  };
  readText = (path: string): string | null => this.files.get(path) ?? null;
  writeText = (path: string, text: string): void => {
    this.addFile(path, text);
  };
  appendText = (path: string, text: string): void => {
    this.addFile(path, (this.files.get(path) ?? '') + text);
  };
  mkdir = (path: string): void => {
    this.addDir(path);
  };
  remove = (path: string): void => {
    this.removed.push(path);
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
    }
  };
  freeBytes = (): number | null => this.free;
}

export interface RecordedCall {
  command: string;
  args: readonly string[];
  options: RunOptions;
}

export type Script = (call: RecordedCall) => Partial<RunResult> | undefined;

const OK: RunResult = { code: 0, spawnFailed: false, timedOut: false, aborted: false, tail: [] };

/** Runner mit Drehbuch: zeichnet jeden Aufruf auf, die Ausgabe kommt vom Drehbuch (Standard: Erfolg ohne Ausgabe). */
export function fakeRunner(script: Script = () => undefined): {
  runner: Runner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner: Runner = async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    const result = { ...OK, ...script(call) };
    for (const line of result.tail) options.onLine?.(line);
    return result;
  };
  return { runner, calls };
}

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
