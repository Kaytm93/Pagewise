import { execFileSync } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';
import { type BuildInfo, COMMIT_PATTERN } from '../src/update/build-info';

/**
 * Sammelt, was `build-info.json` in der App festhält (siehe `src/update/build-info.ts`): aus welchem Commit gebaut
 * wurde und mit welchen Werkzeugen. pnpm setzt `npm_node_execpath` und `npm_execpath`, wenn es ein Skript startet:
 * Das sind die genauen Pfade von Node und pnpm, mit denen `pnpm app:mac` im Terminal gelaufen ist. Die App merkt sie
 * sich, weil sie später aus Finder startet und dort nur einen knappen `PATH` hat.
 */
export interface BuildInfoSources {
  /** Führt git im Repository aus; `null`, wenn es nicht geht (kein git, kein Repository). */
  git(args: string[]): string | null;
  env: NodeJS.ProcessEnv;
  execPath: string;
  arch: string;
  now: Date;
}

const MAX_PATH_ENTRIES = 40;

export function collectBuildInfo(sources: BuildInfoSources): BuildInfo {
  const head = sources.git(['rev-parse', 'HEAD'])?.trim() ?? '';
  const commit = COMMIT_PATTERN.test(head) ? head : null;
  const commitDate = commit
    ? (sources.git(['show', '-s', '--format=%cI', commit])?.trim() ?? null)
    : null;
  // Nur verfolgte Dateien zählen: Gebautes und Ignoriertes (node_modules, dist, out) ist kein „lokale Änderung“.
  const dirty = commit
    ? (sources.git(['status', '--porcelain', '--untracked-files=no'])?.trim() ?? '') !== ''
    : false;

  const node = sources.env.npm_node_execpath ?? sources.execPath;
  const pnpmPath = sources.env.npm_execpath;
  // pnpm wechselt laut `packageManager` auf die dort genannte Fassung und läuft dabei zuerst aus einem Ordner mit
  // `_tmp_` im Namen, der danach umbenannt wird: Dieser Pfad ist später weg. Dann findet die App pnpm über den PATH.
  const pnpm =
    pnpmPath &&
    /pnpm/i.test(basename(pnpmPath)) &&
    isAbsolute(pnpmPath) &&
    !pnpmPath.includes('_tmp_')
      ? pnpmPath
      : null;
  const path = (sources.env.PATH ?? '')
    .split(':')
    .filter((entry) => isAbsolute(entry) && !entry.includes('/node_modules/'))
    .slice(0, MAX_PATH_ENTRIES);

  return {
    commit,
    commitDate,
    builtAt: sources.now.toISOString(),
    dirty,
    arch: sources.arch === 'arm64' || sources.arch === 'x64' ? sources.arch : null,
    toolchain: isAbsolute(node) ? { node, pnpm, path } : null,
  };
}

/** Das echte git: nur Lesebefehle, ohne Shell, ohne Ausgabe von Fehlern. */
export function realGit(cwd: string): BuildInfoSources['git'] {
  return (args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
      });
    } catch {
      return null;
    }
  };
}
