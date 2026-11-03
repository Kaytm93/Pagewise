import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Findet Programme für die Sichtprüfung (D-080): LibreOffice (`soffice`) wandelt Office-Dateien in PDF,
 * `pdftoppm` und `pdfinfo` (poppler) machen daraus Bilder. Wie bei `cli-path.ts`: Nicht vorhanden heißt, das
 * Werkzeug `preview_file` wird nicht angeboten. Gesucht wird nur an festen Orten und im `PATH`, nie per
 * Eingabe aus einer Seite oder von einem Modell.
 */

export interface ProgramLocation {
  /** Aufgelöster Pfad der ausführbaren Datei. */
  path: string;
}

export interface LocateOptions {
  platform?: NodeJS.Platform;
  home?: string;
  /** Wert von `PATH`. Ohne Angabe der des Servers. */
  searchPath?: string;
  /** Von Hand gesetzter Pfad (Umgebungsvariable des Besitzers). Hat Vorrang. */
  explicit?: string | null;
  /** Weitere feste Orte, nur in Tests. */
  extraPaths?: readonly string[];
  /** `false`: nur `explicit`, `extraPaths` und `PATH` durchsuchen, nicht die üblichen Orte des Systems (Tests). */
  system?: boolean;
}

function usable(path: string): string | null {
  try {
    if (!isAbsolute(path)) return null;
    const real = realpathSync(path);
    if (!statSync(real).isFile()) return null;
    accessSync(real, constants.X_OK);
    return real;
  } catch {
    return null;
  }
}

function search(
  name: string,
  options: LocateOptions,
  fixed: readonly string[],
): ProgramLocation | null {
  const candidates: string[] = [];
  if (options.explicit) candidates.push(options.explicit);
  candidates.push(...(options.extraPaths ?? []));
  for (const dir of (options.searchPath ?? process.env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, name));
  }
  if (options.system !== false) candidates.push(...fixed);
  for (const candidate of candidates) {
    const real = usable(candidate);
    if (real) return { path: real };
  }
  return null;
}

export function locateSoffice(options: LocateOptions = {}): ProgramLocation | null {
  const home = options.home ?? homedir();
  const app = 'LibreOffice.app/Contents/MacOS/soffice';
  return search('soffice', options, [join('/Applications', app), join(home, 'Applications', app)]);
}

/** `pdftoppm` und `pdfinfo` aus poppler (zum Beispiel Homebrew). */
export function locatePoppler(
  options: LocateOptions = {},
): { pdftoppm: string; pdfinfo: string | null } | null {
  const fixed = (name: string) => [join('/opt/homebrew/bin', name), join('/usr/local/bin', name)];
  const pdftoppm = search('pdftoppm', options, fixed('pdftoppm'));
  if (!pdftoppm) return null;
  const pdfinfo = search('pdfinfo', options, fixed('pdfinfo'));
  return { pdftoppm: pdftoppm.path, pdfinfo: pdfinfo?.path ?? null };
}
