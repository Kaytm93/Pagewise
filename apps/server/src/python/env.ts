import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Umgebung für Python-Läufe (D-079). Es gibt eine feste Allowlist: Nichts stammt aus `process.env` des Servers,
 * weder Schlüssel noch Proxy-Einstellungen noch `PYTHON*`-Variablen. `HOME` und `TMPDIR` zeigen in den
 * Arbeitsordner (versteckte Unterordner, die nicht als Ergebnis zählen), damit nichts in echten
 * Benutzerordnern landet. Die Sandbox sperrt diese ohnehin; die Umgebung ist die zweite Schicht.
 */

export interface CodeEnvInput {
  /** Ordner mit den installierten Paketen (nur lesen). */
  sitePackages: string;
  workspace: string;
  /** Zeitzone des Servers, falls gesetzt. */
  timeZone?: string | undefined;
}

/** Versteckte Hilfsordner im Arbeitsordner. */
export const WORKSPACE_HOME = '.home';
export const WORKSPACE_TMP = '.tmp';
/** Schriftzwischenspeicher von Matplotlib je Arbeitsordner, vorbefüllt aus dem der Einrichtung. */
export const WORKSPACE_MPL = '.mpl';

/**
 * Kopiert den bei der Einrichtung gebauten Schriftzwischenspeicher von Matplotlib in den Arbeitsordner, wenn dort noch
 * keiner liegt. Matplotlib schreibt dort gern hinein, und ohne Vorlage baut es ihn bei jedem Lauf neu (gemessen:
 * Warnung auf stderr, dazu Wartezeit). Der gemeinsame Ordner bleibt so unverändert und nur lesbar für den Server.
 */
export function seedMatplotlibCache(from: string, workspace: string): void {
  const target = join(workspace, WORKSPACE_MPL);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (readdirSync(target).length > 0 || !existsSync(from)) return;
  for (const name of readdirSync(from)) {
    if (/^fontlist-.*\.json$/.test(name)) copyFileSync(join(from, name), join(target, name));
  }
}

export function buildCodeEnv(input: CodeEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    HOME: join(input.workspace, WORKSPACE_HOME),
    TMPDIR: join(input.workspace, WORKSPACE_TMP),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    PYTHONPATH: input.sitePackages,
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONUNBUFFERED: '1',
    MPLBACKEND: 'Agg',
    MPLCONFIGDIR: join(input.workspace, WORKSPACE_MPL),
  };
  if (input.timeZone) env.TZ = input.timeZone;
  return env;
}
