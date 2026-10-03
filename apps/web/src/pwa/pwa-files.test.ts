import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path));
const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8')) as {
  id: string;
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
const html = read('index.html').toString('utf8');

/** Breite und Höhe aus dem Kopf einer PNG-Datei. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('Web-App-Manifest', () => {
  it('beschreibt eine installierbare App im Vollbild', () => {
    expect(manifest.name).toBe('Pagewise');
    expect(manifest.short_name).toBe('Pagewise');
    expect(manifest.lang).toBe('de');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.id).toBe('/');
  });

  it('nutzt die Farben des Designsystems', () => {
    // Eggshell Canvas: derselbe Wert wie das helle theme-color in index.html und die Fläche der App.
    expect(manifest.background_color).toBe('#fdfcfb');
    expect(manifest.theme_color).toBe('#fdfcfb');
    expect(html).toContain('content="#fdfcfb"');
  });

  it('verweist nur auf Icons, die es gibt und die so groß sind wie angegeben', () => {
    for (const icon of manifest.icons) {
      const file = read(`public${icon.src}`);
      if (icon.type === 'image/png') {
        const [width, height] = icon.sizes.split('x').map(Number);
        expect(pngSize(file), icon.src).toEqual({ width, height });
      } else {
        expect(file.toString('utf8'), icon.src).toContain('<svg');
      }
    }
  });

  it('hat die für die Installation nötigen Größen und ein Icon für runde Masken', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});

describe('index.html', () => {
  it('bindet Manifest, Icons und die Angaben für iOS ein', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Pagewise"');
    expect(html).toContain('viewport-fit=cover');
  });

  it('hat ein Apple-Icon in 180 × 180 ohne Transparenz', () => {
    const file = read('public/icons/apple-touch-icon.png');
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
    // Farbtyp 2 = RGB ohne Alpha: iOS füllt Transparenz sonst schwarz.
    expect(file[25]).toBe(2);
  });

  it('lädt keine Skripte, Stile oder Schriften von fremden Adressen', () => {
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
  });
});
