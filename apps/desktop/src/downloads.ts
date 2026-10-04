import { join, parse } from 'node:path';

/** Macht aus dem Namen einer heruntergeladenen Datei einen sicheren Dateinamen (ohne Pfad, Steuerzeichen, Punktdateien). */
export function safeDownloadName(name: string): string {
  const base = name
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind genau das, was ersetzt wird
    ?.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const cut = (base ?? '').slice(0, 120);
  return cut === '' ? 'Download' : cut;
}

/** Ein freier Pfad im Ordner: gibt es den Namen schon, hängt die App „ (1)“, „ (2)“ … vor die Endung. */
export function uniqueDownloadPath(
  dir: string,
  filename: string,
  exists: (path: string) => boolean,
): string {
  const safe = safeDownloadName(filename);
  const { name, ext } = parse(safe);
  let candidate = join(dir, safe);
  for (let n = 1; exists(candidate) && n < 1_000; n += 1) {
    candidate = join(dir, `${name} (${n})${ext}`);
  }
  return candidate;
}
