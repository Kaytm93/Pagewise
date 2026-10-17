import { basename, dirname, join } from 'node:path';
import type { BuildInfo } from './build-info';
import { commonToolDirs } from './env';

/** Wo git liegt: Apples Programm zuerst, dann Homebrew. Eine App aus Finder sucht nicht im `PATH` des Terminals. */
export const GIT_CANDIDATES = [
  '/usr/bin/git',
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
] as const;

export interface ToolsFs {
  isExecutable(path: string): boolean;
  isFile(path: string): boolean;
  listDir(path: string): string[];
}

export interface Tools {
  git: string;
  node: string;
  /** So wird pnpm gestartet: `command` mit den Argumenten `prefix` davor (bei einem Skript ist `command` Node). */
  pnpm: { command: string; prefix: readonly string[] };
  /** Ordner für den `PATH` der Kindprozesse, wichtigste zuerst. */
  pathDirs: string[];
  /** Kommen die Werkzeuge aus dem gemerkten Stand des Bauens (sonst gefunden)? */
  remembered: boolean;
}

export type ToolsResult =
  | { ok: true; tools: Tools }
  | { ok: false; code: 'no-git' | 'no-tools'; detail: string };

const SCRIPT = /\.(?:c|m)?js$/;

/** Ordner `bin` der mit nvm installierten Node-Versionen, die neueste zuerst. */
export function nvmBinDirs(home: string, fs: ToolsFs): string[] {
  const root = join(home, '.nvm', 'versions', 'node');
  const versions = fs
    .listDir(root)
    .map((name) => ({ name, match: /^v(\d+)\.(\d+)\.(\d+)$/.exec(name) }))
    .flatMap(({ name, match }) =>
      match ? [{ name, parts: [Number(match[1]), Number(match[2]), Number(match[3])] }] : [],
    );
  versions.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const diff = (b.parts[i] ?? 0) - (a.parts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return versions.map((version) => join(root, version.name, 'bin'));
}

function findIn(name: string, dirs: readonly string[], fs: ToolsFs): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (fs.isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Findet git, Node und pnpm. Vorrang hat der Stand des Bauens (`build-info.json`): Damit lief `pnpm app:mac` im Terminal,
 * also läuft es auch hier. Fehlt er oder ist veraltet (Node per nvm gewechselt), sucht die App an den üblichen Orten.
 * Gefunden wird nur, was wirklich ausführbar ist; geraten wird nichts.
 */
export function resolveTools(input: { info: BuildInfo; home: string; fs: ToolsFs }): ToolsResult {
  const { info, home, fs } = input;
  const git = GIT_CANDIDATES.find((path) => fs.isExecutable(path));
  if (!git) {
    return {
      ok: false,
      code: 'no-git',
      detail: `git nicht gefunden (gesucht: ${GIT_CANDIDATES.join(', ')})`,
    };
  }

  const stored = info.toolchain;
  const searchDirs = [...(stored?.path ?? []), ...commonToolDirs(home), ...nvmBinDirs(home, fs)];

  let remembered = false;
  let node: string | null = null;
  if (stored && fs.isExecutable(stored.node)) {
    node = stored.node;
    remembered = true;
  } else {
    node = findIn('node', searchDirs, fs);
  }
  if (!node) {
    return { ok: false, code: 'no-tools', detail: 'node nicht gefunden' };
  }

  const nodeDir = dirname(node);
  let pnpm: Tools['pnpm'] | null = null;
  let pnpmDir: string | null = null;
  if (stored?.pnpm && fs.isFile(stored.pnpm)) {
    if (SCRIPT.test(stored.pnpm)) {
      pnpm = { command: node, prefix: [stored.pnpm] };
    } else if (fs.isExecutable(stored.pnpm)) {
      pnpm = { command: stored.pnpm, prefix: [] };
      pnpmDir = dirname(stored.pnpm);
    }
  }
  if (!pnpm) {
    remembered = false;
    const found = findIn('pnpm', [nodeDir, ...searchDirs], fs);
    if (found) {
      pnpm = { command: found, prefix: [] };
      pnpmDir = dirname(found);
    }
  }
  if (!pnpm) return { ok: false, code: 'no-tools', detail: 'pnpm nicht gefunden' };

  const pathDirs = [
    ...new Set([nodeDir, ...(pnpmDir ? [pnpmDir] : []), ...searchDirs, dirname(git)]),
  ];
  return { ok: true, tools: { git, node, pnpm, pathDirs, remembered } };
}

/** Für die Anzeige im Protokoll: nur der Dateiname, nie ein Pfad mit Benutzernamen. */
export const toolName = (path: string): string => basename(path);
