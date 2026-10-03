import { chmodSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Fehler, bei dem die App nicht starten darf. Die Meldung ist für Menschen gedacht. */
export class DataDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirError';
  }
}

export interface DataDirOptions {
  /** Ordner dieser Anwendung (Repo-Wurzel). Das Datenverzeichnis darf nicht darin liegen. */
  appRoot: string;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Standardpfad je Betriebssystem. */
export function defaultDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Schulheft');
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, '.local', 'share');
  return join(base, 'schulheft');
}

/** Löst das konfigurierte Datenverzeichnis auf (SCHULHEFT_DATA_DIR oder Standard). */
export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  options: Pick<DataDirOptions, 'platform' | 'home'> = {},
): string {
  const home = options.home ?? homedir();
  const configured = env.SCHULHEFT_DATA_DIR?.trim();
  if (!configured) return defaultDataDir(env, options.platform, home);

  const expanded =
    configured === '~' || configured.startsWith('~/')
      ? join(home, configured.slice(1))
      : configured;
  if (!isAbsolute(expanded)) {
    throw new DataDirError(
      `SCHULHEFT_DATA_DIR muss ein absoluter Pfad sein (aktuell: "${configured}").`,
    );
  }
  return resolve(expanded);
}

/**
 * Löst Symlinks auf, auch für Pfade, die es noch nicht gibt: Der nächste vorhandene
 * Elternordner wird per realpath aufgelöst, der Rest wird angehängt.
 */
export function realpathLoose(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(current.slice(parent.length).replace(/^[\\/]+/, ''));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** Sucht von `start` aufwärts nach einem Git-Arbeitsverzeichnis (.git als Ordner oder Datei). */
export function findGitWorkTree(start: string): string | null {
  let current = start;
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Verweigert Datenverzeichnisse innerhalb eines Git-Arbeitsverzeichnisses oder der App selbst. */
export function assertDataDirOutsideRepo(dataDir: string, options: DataDirOptions): string {
  const real = realpathLoose(dataDir);

  const gitRoot = findGitWorkTree(real);
  if (gitRoot) {
    throw new DataDirError(
      [
        'Das Datenverzeichnis liegt innerhalb eines Git-Arbeitsverzeichnisses.',
        `  Datenverzeichnis: ${real}`,
        `  Git-Verzeichnis:  ${gitRoot}`,
        'Aus Datenschutzgründen startet Schulheft so nicht, damit Schuldaten nie versehentlich',
        'in ein Repository gelangen. Setze SCHULHEFT_DATA_DIR auf einen Ort außerhalb, zum Beispiel',
        '"~/Library/Application Support/Schulheft" (macOS) oder "~/.local/share/schulheft" (Linux).',
        'Ist dein Home-Ordner selbst ein Git-Repository, ist das genau der Fall, der hier greift.',
      ].join('\n'),
    );
  }

  const appRoot = realpathLoose(options.appRoot);
  if (isInside(real, appRoot)) {
    throw new DataDirError(
      [
        'Das Datenverzeichnis liegt innerhalb des Anwendungsordners.',
        `  Datenverzeichnis: ${real}`,
        `  Anwendungsordner: ${appRoot}`,
        'Setze SCHULHEFT_DATA_DIR auf einen Ort außerhalb.',
      ].join('\n'),
    );
  }

  return real;
}

/**
 * Löst das Datenverzeichnis auf, prüft es und legt es bei Bedarf mit Rechten 700 an.
 * Die Prüfung läuft VOR dem Anlegen, ein abgelehnter Start erzeugt nichts im Repo.
 */
export function prepareDataDir(env: NodeJS.ProcessEnv, options: DataDirOptions): string {
  const configured = resolveDataDir(env, options);
  const dataDir = assertDataDirOutsideRepo(configured, options);

  if (existsSync(dataDir)) {
    if (!statSync(dataDir).isDirectory()) {
      throw new DataDirError(`Das Datenverzeichnis ist kein Ordner: ${dataDir}`);
    }
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    // Gehört der Ordner jemand anderem, lassen wir die Rechte unverändert.
  }
  return dataDir;
}
