/**
 * Festgenagelte Quellen für das Python der Code-Ausführung (D-079). Quelle: python-build-standalone,
 * Release 20261026 (GitHub `astral-sh/python-build-standalone`, abgefragt am 1. November 2026). Die Prüfsummen
 * stammen aus den Metadaten des Releases; der Download wird vor dem Entpacken gegen sie geprüft.
 *
 * Aktualisieren: neues Release wählen, Dateinamen und Prüfsummen aus den Release-Metadaten übernehmen,
 * `lock.ts` neu erzeugen (siehe dort) und `docs/tools.md` nachziehen.
 */

export type PlatformKey = 'darwin-arm64' | 'darwin-x64';

export interface PythonBuild {
  file: string;
  url: string;
  sha256: string;
  size: number;
}

export const PBS_RELEASE = '20261026';
export const PYTHON_VERSION = '3.13.18';

const BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}`;

function build(file: string, sha256: string, size: number): PythonBuild {
  return { file, url: `${BASE}/${encodeURIComponent(file)}`, sha256, size };
}

export const PYTHON_BUILDS: Readonly<Record<PlatformKey, PythonBuild>> = {
  'darwin-arm64': build(
    `cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`,
    'e5af2fde6a937a0e0c795a0c595c4efb70578d57463a2657c819992b9b9acbac',
    25_394_044,
  ),
  'darwin-x64': build(
    `cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-apple-darwin-install_only.tar.gz`,
    '708be9e7df297f68bdae589ea9e62a621db5abe7708f79e851c41410347452d1',
    25_155_145,
  ),
};

/** Hosts, zu denen der Download weitergeleitet werden darf (GitHub liefert Release-Dateien über sein CDN). */
export const DOWNLOAD_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformKey | null {
  if (platform !== 'darwin') return null;
  if (arch === 'arm64') return 'darwin-arm64';
  if (arch === 'x64') return 'darwin-x64';
  return null;
}
