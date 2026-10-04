// Packt PNG-Dateien zu einer macOS-Symboldatei (.icns). Aufruf:
//   node scripts/make-icns.mjs <Ordner mit icon_16.png … icon_1024.png> <Ausgabe.icns>
// Das Format ist einfach: Kopf „icns“ mit Gesamtlänge, danach Blöcke aus Typ, Länge und PNG-Daten (seit macOS 10.7).
// Die PNG-Dateien entstehen aus `apps/web/public/icons/icon.svg` (Rand von 10 %, wie bei macOS-Symbolen üblich).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Typkennung, Pixelgröße (die Datei `icon_<Größe>.png` liefert die Daten). */
export const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32], // 16 @2x
  ['ic12', 64], // 32 @2x
  ['ic13', 256], // 128 @2x
  ['ic14', 512], // 256 @2x
];

export function packIcns(pngBySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = pngBySize.get(size);
    if (!png) throw new Error(`PNG mit ${size} Pixeln fehlt.`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('Aufruf: make-icns.mjs <PNG-Ordner> <Ausgabe.icns>');
    process.exit(2);
  }
  const sizes = new Set(ICNS_TYPES.map(([, size]) => size));
  const map = new Map(
    [...sizes].map((size) => [size, readFileSync(join(dir, `icon_${size}.png`))]),
  );
  writeFileSync(out, packIcns(map));
  console.log(`geschrieben: ${out}`);
}
