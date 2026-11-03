import { isAbsolute } from 'node:path';

/**
 * Profil für `sandbox-exec` (Seatbelt, macOS) für Code, den ein Modell geschrieben hat (D-079). Es gilt
 * „alles verboten, nur das Genannte erlaubt“:
 *
 * - Lesen: Systembibliotheken, das Python samt Paketen (nur lesen) und der Arbeitsordner. Das Benutzer- und das
 *   Datenverzeichnis sind nicht lesbar (auf macOS 26.6 gemessen).
 * - Schreiben: nur der Arbeitsordner (und `/dev/null`).
 * - Kein Netz, auch kein DNS. Kein `fork`: Das Skript kann keine Kindprozesse starten, die der Prozessgruppe beim
 *   Beenden entkommen (gemessen: `subprocess` und `os.fork` scheitern, Threads laufen).
 *
 * Pfade müssen aufgelöst sein (Seatbelt vergleicht echte Pfade, Symlinks greifen nicht). Anführungszeichen,
 * Rückstriche und Steuerzeichen in Pfaden werden abgelehnt, statt sie zu maskieren: Dann gibt es kein Profil und
 * damit keinen Lauf (fail closed).
 */

export interface SeatbeltSpec {
  /** Arbeitsordner: hier darf gelesen und geschrieben werden. */
  workspace: string;
  /** Ordner, die nur gelesen werden dürfen (Python, Pakete, ein Programm samt Bibliotheken). */
  readOnly: readonly string[];
}

/** Systempfade, die jedes Programm zum Starten braucht (dyld, Zeitzonen, Zufall). */
const SYSTEM_READ = [
  '(literal "/")',
  '(subpath "/usr/lib")',
  '(subpath "/System/Library")',
  '(subpath "/Library/Apple")',
  '(subpath "/private/var/db/dyld")',
  '(subpath "/private/var/db/timezone")',
  '(subpath "/usr/share")',
  '(literal "/private/etc/localtime")',
  // Python liest beim Import von `mimetypes` (python-pptx, reportlab, …) diese Dateien und scheitert bei einem Fehler.
  '(literal "/private/etc/apache2/mime.types")',
  '(literal "/private/etc/mime.types")',
  '(literal "/private/etc/ssl/openssl.cnf")',
  '(literal "/private/etc/passwd")',
  '(literal "/dev/null")',
  '(literal "/dev/urandom")',
  '(literal "/dev/random")',
  '(literal "/dev/zero")',
];

/** Ein Pfad als Zeichenfolge im Profil. Wirft bei Pfaden, die sich nicht sicher darstellen lassen. */
export function seatbeltPath(path: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f"\\]/.test(path)) {
    throw new Error('Pfad lässt sich nicht sicher in ein Sandbox-Profil schreiben.');
  }
  return `"${path}"`;
}

export function buildSeatbeltProfile(spec: SeatbeltSpec): string {
  const readOnly = spec.readOnly.map((path) => `(subpath ${seatbeltPath(path)})`);
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow mach-lookup (global-name "com.apple.system.notification_center"))',
    `(allow file-read* ${[...SYSTEM_READ, ...readOnly].join(' ')})`,
    '(allow file-write* (literal "/dev/null"))',
    `(allow file-read* file-write* (subpath ${seatbeltPath(spec.workspace)}))`,
    '',
  ].join('\n');
}

export interface OfficeProfileSpec {
  /** Arbeitsordner: hier darf gelesen und geschrieben werden. */
  workspace: string;
  /** Orte, die nie lesbar sein sollen (Benutzerverzeichnis, Datenverzeichnis, Datenträger). */
  denyRead: readonly string[];
  /** Ausnahmen davon, die das Programm zum Starten braucht (Einstellungen, Schriften) und das Programm selbst. */
  allowRead: readonly string[];
  /** Verzeichnisse, die nur aufgelistet werden dürfen (Vorfahren von Ausnahmen unter einem gesperrten Ort). */
  allowList: readonly string[];
}

/**
 * Profil für LibreOffice (`soffice`) beim Umwandeln einer Datei in PDF (D-080). LibreOffice ist ein Programm mit
 * Fenstersystem, Grafik, Zwischenablage und Startdiensten; ein Profil „alles verboten“ lässt es nicht starten
 * (gemessen auf macOS 26.6: Absturz, es fehlen unter anderem Fenstersystem, GPU, Launch Services). Darum gilt hier
 * die umgekehrte Richtung, enger gefasst als bei Skripten:
 *
 * - Netz gesperrt, außer Unix-Sockets (LibreOffice braucht eine lokale Leitung zu sich selbst).
 * - Schreiben nur im Arbeitsordner, dazu die Leitung `OSL_PIPE_*` in `/tmp` (und das Verzeichnis selbst).
 * - Lesen: das Benutzerverzeichnis, das Datenverzeichnis und Datenträger sind gesperrt (Einstellungen und
 *   Schriften des Benutzers ausgenommen). Alles andere im System bleibt lesbar: **das ist die Grenze dieses
 *   Profils.** Ein Fehler in LibreOffice könnte Systemdateien außerhalb des Benutzerverzeichnisses lesen und
 *   ihren Inhalt in die erzeugte Datei schreiben; senden oder verändern kann er nichts.
 *
 * Anders als beim Skript-Profil ist `fork` erlaubt, weil LibreOffice sich in mehrere Prozesse aufteilt.
 */
export function buildOfficeProfile(spec: OfficeProfileSpec): string {
  const subpaths = (paths: readonly string[]) =>
    paths.map((path) => `(subpath ${seatbeltPath(path)})`).join(' ');
  const workspace = seatbeltPath(spec.workspace);
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network* (local unix-socket) (remote unix-socket))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${workspace}) (literal "/dev/null") (regex #"^/private/tmp/OSL_PIPE_") (regex #"^/tmp/OSL_PIPE_") (literal "/private/tmp") (literal "/tmp"))`,
  ];
  if (spec.denyRead.length > 0) lines.push(`(deny file-read* ${subpaths(spec.denyRead)})`);
  lines.push(
    `(allow file-read* (subpath ${workspace})${spec.allowRead.length > 0 ? ` ${subpaths(spec.allowRead)}` : ''})`,
  );
  if (spec.allowList.length > 0) {
    lines.push(
      `(allow file-read-data ${spec.allowList.map((path) => `(literal ${seatbeltPath(path)})`).join(' ')})`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
