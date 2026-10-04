import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error reines JavaScript ohne Typen
import { ICNS_TYPES, packIcns } from '../scripts/make-icns.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

function pngSize(buffer: Buffer): number {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = buffer.readUInt32BE(16);
  expect(buffer.readUInt32BE(20)).toBe(width);
  return width;
}

describe('App-Symbol (icns)', () => {
  const file = readFileSync(join(assets, 'icon.icns'));

  it('hat einen gültigen Kopf mit passender Gesamtlänge', () => {
    expect(file.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(file.readUInt32BE(4)).toBe(file.length);
  });

  it('enthält alle üblichen Größen als PNG, bis 1024 Pixel', () => {
    const found = new Map<string, number>();
    let offset = 8;
    while (offset < file.length) {
      const type = file.subarray(offset, offset + 4).toString('ascii');
      const length = file.readUInt32BE(offset + 4);
      found.set(type, pngSize(file.subarray(offset + 8, offset + length)));
      offset += length;
    }
    expect(offset).toBe(file.length);
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(ICNS_TYPES as [string, number][]));
    expect(found.get('ic10')).toBe(1024);
  });

  it('packt aus den Größen wieder dieselbe Struktur und meldet fehlende Größen', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const sizes = new Map<number, Buffer>(
      [...new Set((ICNS_TYPES as [string, number][]).map(([, s]) => s))].map((s) => [s, png]),
    );
    const packed = packIcns(sizes) as Buffer;
    expect(packed.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(packed.readUInt32BE(4)).toBe(packed.length);
    sizes.delete(512);
    expect(() => packIcns(sizes)).toThrow('512');
  });

  it('bringt das Symbol der Menüleiste als Schablone in 1× und 2× mit', () => {
    expect(pngSize(readFileSync(join(assets, 'trayTemplate.png')))).toBe(16);
    expect(pngSize(readFileSync(join(assets, 'trayTemplate@2x.png')))).toBe(32);
  });
});
