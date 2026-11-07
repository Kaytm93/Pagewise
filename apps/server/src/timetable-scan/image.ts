/**
 * Bilder für die Stundenplan-Erkennung (D-107). Es kommen nur PNG und JPEG herein: der Browser
 * zeichnet das Bild vor dem Senden neu (Canvas), der Server prüft Signatur und Art noch einmal und
 * entfernt Metadaten. Das Bild wird nie gespeichert und nie protokolliert — es existiert nur im
 * Speicher, bis die Anfrage an das Modell gebaut ist.
 */

/** Höchstgröße des Bildes nach der Prüfung; der Körper darf etwas mehr (Formular-Overhead). */
export const MAX_SCAN_IMAGE_BYTES = 6 * 1024 * 1024;
export const SCAN_BODY_LIMIT = MAX_SCAN_IMAGE_BYTES + 64 * 1024;

export interface ScanImage {
  mime: 'image/png' | 'image/jpeg';
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG-Blöcke, die bleiben dürfen: Aufbau, Farbe und Bilddaten. Alles andere (tEXt, iTXt, eXIf,
 * tIME, pHYs …) kann Beschriftungen oder Standortdaten tragen und wird verworfen.
 */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'bKGD',
  'sBIT',
]);

function sameSignature(data: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => data[index] === byte);
}

function uint32(data: Uint8Array, at: number): number {
  return (
    (((data[at] ?? 0) << 24) |
      ((data[at + 1] ?? 0) << 16) |
      ((data[at + 2] ?? 0) << 8) |
      (data[at + 3] ?? 0)) >>>
    0
  );
}

function chunkType(data: Uint8Array, at: number): string | null {
  let name = '';
  for (let index = at; index < at + 4; index += 1) {
    const byte = data[index] ?? 0;
    if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) return null;
    name += String.fromCharCode(byte);
  }
  return name;
}

function join(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/** PNG: nur die erlaubten Blöcke kopieren. Ein kaputter Aufbau bedeutet „kein Bild“. */
function cleanPng(data: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [data.slice(0, 8)];
  let at = 8;
  let header = false;
  let pixels = false;
  let end = false;
  while (at + 12 <= data.byteLength) {
    const length = uint32(data, at);
    const type = chunkType(data, at + 4);
    if (type === null || length > data.byteLength) return null;
    const stop = at + 12 + length;
    if (stop > data.byteLength) return null;
    if (type === 'IHDR' && at === 8) header = true;
    if (type === 'IDAT') pixels = true;
    if (type === 'IEND') end = true;
    if (PNG_KEEP.has(type)) parts.push(data.slice(at, stop));
    at = stop;
    if (end) break;
  }
  if (!header || !pixels || !end || at !== data.byteLength) return null;
  return join(parts);
}

/**
 * JPEG: APPn- und Kommentar-Blöcke (dort sitzen EXIF, Thumbnails und Beschriftungen) entfernen,
 * ab dem Start des Bilddatenstroms (SOS) den Rest unverändert kopieren.
 */
function cleanJpeg(data: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [data.slice(0, 2)];
  let at = 2;
  let pixels = false;
  while (at + 1 < data.byteLength) {
    if (data[at] !== 0xff) return null;
    let markerAt = at + 1;
    while (data[markerAt] === 0xff && markerAt < data.byteLength) markerAt += 1;
    if (markerAt >= data.byteLength) return null;
    const marker = data[markerAt] ?? 0;
    // EOI oder Marker ohne Länge (RSTn, TEM): einfach übernehmen.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.slice(at, markerAt + 1));
      at = markerAt + 1;
      if (marker === 0xd9) break;
      continue;
    }
    if (markerAt + 3 >= data.byteLength) return null;
    const length = ((data[markerAt + 1] ?? 0) << 8) | (data[markerAt + 2] ?? 0);
    if (length < 2) return null;
    const stop = markerAt + 1 + length;
    if (stop > data.byteLength) return null;
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(data.slice(at, stop));
    at = stop;
    if (marker === 0xda) {
      parts.push(data.slice(stop));
      at = data.byteLength;
      pixels = true;
      break;
    }
  }
  if (!pixels) return null;
  return join(parts);
}

/** Entfernt Metadaten aus einem bereits der Signatur nach bekannten Bild. */
export function stripImageMetadata(image: ScanImage): Uint8Array | null {
  return image.mime === 'image/png' ? cleanPng(image.data) : cleanJpeg(image.data);
}

/**
 * Prüft Art, Größe und Signatur. Bewusst eng: SVG, WebP, GIF und unbekannte Arten kommen nicht
 * durch, damit kein aktiver Inhalt und kein fremdes Format an das Modell geht. Die angegebene Art
 * muss zur Signatur passen (leer oder `application/octet-stream` gilt als „nicht angegeben“).
 */
export function readScanImage(type: string, data: Uint8Array): ScanImage | null {
  if (data.byteLength < 16 || data.byteLength > MAX_SCAN_IMAGE_BYTES) return null;
  const declared = type.trim().toLocaleLowerCase('de');
  const neutral = declared === '' || declared === 'application/octet-stream';
  const isPng = sameSignature(data, PNG_SIGNATURE);
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (isPng === isJpeg) return null;

  const mime: ScanImage['mime'] = isPng ? 'image/png' : 'image/jpeg';
  const allowed =
    declared === mime || (mime === 'image/jpeg' && declared === 'image/jpg') || neutral;
  if (!allowed) return null;

  const clean = stripImageMetadata({ mime, data });
  if (clean === null || clean.byteLength > MAX_SCAN_IMAGE_BYTES || clean.byteLength < 16)
    return null;
  return { mime, data: clean };
}

/** Daten-URL im OpenAI-Format. Nur der bereinigte Rumpf geht hinein. */
export function imageDataUrl(image: ScanImage): string {
  return `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}`;
}
