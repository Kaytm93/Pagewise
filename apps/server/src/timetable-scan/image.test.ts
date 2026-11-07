import { describe, expect, it } from 'vitest';
import { imageDataUrl, MAX_SCAN_IMAGE_BYTES, readScanImage, stripImageMetadata } from './image';

// Alle Bytes sind erfunden. Die Prüfsummen sind absichtlich leer: der Code liest sie nicht.
const encoder = new TextEncoder();
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  new DataView(out.buffer).setUint32(0, data.byteLength);
  out.set(encoder.encode(type), 4);
  out.set(data, 8);
  return out;
}

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.byteLength);
  out[0] = 0xff;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, data.byteLength + 2);
  out.set(data, 4);
  return out;
}

const PNG = join([
  PNG_SIGNATURE,
  pngChunk('IHDR', new Uint8Array(13)),
  pngChunk('tEXt', encoder.encode('Beispiel\0vertraulicher Hinweis')),
  pngChunk('IDAT', Uint8Array.from([1, 2, 3, 4])),
  pngChunk('IEND', new Uint8Array(0)),
]);

const JPEG = join([
  Uint8Array.from([0xff, 0xd8]),
  jpegSegment(0xe1, encoder.encode('EXIF-Beispiel')),
  jpegSegment(0xc0, new Uint8Array(15)),
  jpegSegment(0xda, new Uint8Array(6)),
  Uint8Array.from([0x12, 0x34, 0x00, 0x56]),
  Uint8Array.from([0xff, 0xd9]),
]);

function hasText(bytes: Uint8Array, needle: string): boolean {
  return new TextDecoder().decode(bytes).includes(needle);
}

describe('Bilder der Stundenplan-Erkennung', () => {
  it('erkennt PNG und JPEG an der Signatur, nicht an der behaupteten Art', () => {
    expect(readScanImage('image/png', PNG)?.mime).toBe('image/png');
    expect(readScanImage('image/jpeg', JPEG)?.mime).toBe('image/jpeg');
    expect(readScanImage('image/jpg', JPEG)?.mime).toBe('image/jpeg');
    expect(readScanImage('application/octet-stream', PNG)?.mime).toBe('image/png');
    expect(readScanImage('image/jpeg', PNG)).toBeNull();
    expect(readScanImage('image/png', JPEG)).toBeNull();
    expect(readScanImage('image/svg+xml', PNG)).toBeNull();
    expect(readScanImage('image/png', encoder.encode('einfach nur Text'))).toBeNull();
  });

  it('wehrt zu große und zu kleine Körper ab', () => {
    expect(readScanImage('image/png', new Uint8Array(8))).toBeNull();
    expect(readScanImage('image/png', new Uint8Array(MAX_SCAN_IMAGE_BYTES + 1))).toBeNull();
  });

  it('entfernt Textblöcke aus PNG und EXIF/APPn aus JPEG', () => {
    const png = stripImageMetadata({ mime: 'image/png', data: PNG });
    const jpeg = stripImageMetadata({ mime: 'image/jpeg', data: JPEG });
    expect(png).not.toBeNull();
    expect(jpeg).not.toBeNull();
    expect(hasText(png as Uint8Array, 'vertraulicher Hinweis')).toBe(false);
    expect(hasText(jpeg as Uint8Array, 'EXIF-Beispiel')).toBe(false);
    expect(hasText(png as Uint8Array, 'IDAT')).toBe(true);
    expect(hasText(jpeg as Uint8Array, String.fromCharCode(0x12, 0x34))).toBe(true);
    expect(readScanImage('image/png', PNG)).not.toBeNull();
    expect(readScanImage('image/jpeg', JPEG)).not.toBeNull();
  });

  it('verwirft kaputte Bildstrukturen', () => {
    expect(stripImageMetadata({ mime: 'image/png', data: PNG.slice(0, -9) })).toBeNull();
    expect(stripImageMetadata({ mime: 'image/jpeg', data: JPEG.slice(0, 12) })).toBeNull();
    const withoutEnd = join([
      PNG_SIGNATURE,
      pngChunk('IHDR', new Uint8Array(13)),
      pngChunk('IDAT', Uint8Array.from([1])),
    ]);
    expect(stripImageMetadata({ mime: 'image/png', data: withoutEnd })).toBeNull();
  });

  it('baut eine Daten-URL ausschließlich aus den bereinigten Bytes', () => {
    const image = readScanImage('image/jpeg', JPEG);
    expect(image).not.toBeNull();
    const url = imageDataUrl(image as NonNullable<typeof image>);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = Uint8Array.from(Buffer.from(url.split(',')[1] ?? '', 'base64'));
    expect(hasText(bytes, 'EXIF-Beispiel')).toBe(false);
  });
});
