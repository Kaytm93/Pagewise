import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIREMENTS_LOCK } from './lock';
import { type PlatformKey, platformKey } from './pins';

/**
 * Das private Python der Code-Ausführung (D-079): liegt unter `<Datenverzeichnis>/python`, verändert das System
 * nie und gehört nur Pagewise. Aufbau:
 *
 * - `runtime/python`: entpackter Build von python-build-standalone
 * - `site`: installierte Pakete (`pip install --target`)
 * - `mpl`: vorbereiteter Schriftzwischenspeicher von Matplotlib
 * - `ready.json`: Marke „eingerichtet“ mit Versionen und der Prüfsumme des Locks
 * - `home`, `tmp`: nur während der Einrichtung
 */

export interface PythonLayout {
  root: string;
  runtime: string;
  python: string;
  site: string;
  mpl: string;
  home: string;
  tmp: string;
  marker: string;
}

export function pythonLayout(dataDir: string): PythonLayout {
  const root = join(dataDir, 'python');
  const runtime = join(root, 'runtime');
  return {
    root,
    runtime,
    python: join(runtime, 'python', 'bin', 'python3'),
    site: join(root, 'site'),
    mpl: join(root, 'mpl'),
    home: join(root, 'home'),
    tmp: join(root, 'tmp'),
    marker: join(root, 'ready.json'),
  };
}

export interface ReadyMarker {
  pythonVersion: string;
  release: string;
  lockSha256: string;
  installedAt: string;
}

export const lockHash = (lock: string): string => createHash('sha256').update(lock).digest('hex');

export type RuntimeState = 'missing' | 'outdated' | 'ready';

export interface PythonRuntimeInfo {
  python: string;
  /** Ordner, die ein Lauf lesen darf (aufgelöste Pfade). */
  readOnly: string[];
  sitePackages: string;
  /** Vorlage für den Schriftzwischenspeicher von Matplotlib. Der Server kopiert sie in den Arbeitsordner (nicht lesbar für Läufe). */
  matplotlibCache: string;
}

/** Erkennung wie bei `cli-path.ts`: nicht vorhanden heißt, das Werkzeug wird nicht angeboten. */
export class PythonRuntime {
  readonly layout: PythonLayout;

  constructor(
    dataDir: string,
    private readonly lockFor: (key: PlatformKey) => string | null = (key) =>
      REQUIREMENTS_LOCK[key] ?? null,
    private readonly platform: PlatformKey | null = platformKey(),
  ) {
    this.layout = pythonLayout(dataDir);
  }

  state(): RuntimeState {
    try {
      if (!this.platform || !existsSync(this.layout.python)) return 'missing';
      const marker = JSON.parse(readFileSync(this.layout.marker, 'utf8')) as Partial<ReadyMarker>;
      const lock = this.lockFor(this.platform);
      if (typeof marker.lockSha256 !== 'string' || lock === null) return 'missing';
      return marker.lockSha256 === lockHash(lock) ? 'ready' : 'outdated';
    } catch {
      return 'missing';
    }
  }

  /** Die Angaben für einen Lauf, oder `null`, wenn das Python nicht eingerichtet ist. */
  info(): PythonRuntimeInfo | null {
    if (this.state() !== 'ready') return null;
    try {
      const python = realpathSync(this.layout.python);
      const home = realpathSync(join(this.layout.runtime, 'python'));
      const site = realpathSync(this.layout.site);
      const mpl = realpathSync(this.layout.mpl);
      return { python, readOnly: [home, site], sitePackages: site, matplotlibCache: mpl };
    } catch {
      return null;
    }
  }
}
