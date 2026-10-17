import { isAbsolute } from 'node:path';

/**
 * Was beim Bauen in `Contents/Resources/build-info.json` der App landet (geschrieben von `scripts/package.ts`): aus
 * welcher Fassung die App gebaut wurde und mit welchen Werkzeugen. Beides braucht das Update: Die Fassung, um zu
 * sehen, ob es etwas Neueres gibt; die Werkzeuge (Node, pnpm), weil eine App aus Finder oder Anmeldung nur einen
 * knappen `PATH` hat und nvm, Volta und Co. dort nicht stehen.
 *
 * Die Datei liegt nur in der App auf dem eigenen Mac, nie im Repository.
 */
export interface Toolchain {
  /** Absoluter Pfad von `node`. */
  node: string;
  /** Absoluter Pfad von pnpm (Skript `.cjs`/`.js` oder Programm), `null`, wenn unbekannt. */
  pnpm: string | null;
  /** Ordner aus dem `PATH` des Bauens (nur absolute, ohne `node_modules`). */
  path: string[];
}

export interface BuildInfo {
  /** Vollständiger Hash des Commits, aus dem gebaut wurde, `null` ohne Git (z. B. Quelltext als Archiv). */
  commit: string | null;
  /** Zeitpunkt dieses Commits (ISO 8601). */
  commitDate: string | null;
  /** Zeitpunkt des Bauens (ISO 8601). */
  builtAt: string | null;
  /** Beim Bauen gab es nicht eingecheckte Änderungen an verfolgten Dateien. */
  dirty: boolean;
  arch: string | null;
  toolchain: Toolchain | null;
}

export const EMPTY_BUILD_INFO: BuildInfo = Object.freeze({
  commit: null,
  commitDate: null,
  builtAt: null,
  dirty: false,
  arch: null,
  toolchain: null,
});

export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_PATH_LENGTH = 1024;
const MAX_PATH_ENTRIES = 60;

const isoDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 40) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};

const absolutePath = (value: unknown): string | null =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_PATH_LENGTH &&
  isAbsolute(value) &&
  !/[\0\n\r]/.test(value)
    ? value
    : null;

function parseToolchain(raw: unknown): Toolchain | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const node = absolutePath(value.node);
  if (!node) return null;
  const path = Array.isArray(value.path)
    ? value.path
        .slice(0, MAX_PATH_ENTRIES)
        .map(absolutePath)
        .filter((entry): entry is string => entry !== null)
    : [];
  return { node, pnpm: absolutePath(value.pnpm), path };
}

/** Prüft von Hand, nie vertrauensvoll: Die Datei könnte kaputt oder von Hand geändert sein. Ungültiges wird `null`. */
export function parseBuildInfo(raw: unknown): BuildInfo {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_BUILD_INFO };
  const value = raw as Record<string, unknown>;
  return {
    commit:
      typeof value.commit === 'string' && COMMIT_PATTERN.test(value.commit) ? value.commit : null,
    commitDate: isoDate(value.commitDate),
    builtAt: isoDate(value.builtAt),
    dirty: value.dirty === true,
    arch: value.arch === 'arm64' || value.arch === 'x64' ? value.arch : null,
    toolchain: parseToolchain(value.toolchain),
  };
}

export function parseBuildInfoText(text: string | null): BuildInfo {
  if (text === null) return { ...EMPTY_BUILD_INFO };
  try {
    return parseBuildInfo(JSON.parse(text));
  } catch {
    return { ...EMPTY_BUILD_INFO };
  }
}

export const shortCommit = (commit: string | null): string | null =>
  commit === null ? null : commit.slice(0, 7);
