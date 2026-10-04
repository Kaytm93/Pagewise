import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die CSP erlaubt keine Inline-Styles (`style-src 'self'`, D-023). Dieser Test sucht im Quelltext der
 * Oberfläche nach allem, was ein `style`-Attribut erzeugen würde: React `style={…}`, `setAttribute('style')`,
 * `cssText` und `<style>`-Elemente. Werte setzt das Skript stattdessen über das CSSOM
 * (`element.style.setProperty(…)`), das die CSP nicht betrifft.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(tsx?|html|js)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = [
  ...sources(join(root, 'src')),
  join(root, 'index.html'),
  join(root, 'public', 'boot.js'),
];

const FORBIDDEN: [string, RegExp][] = [
  ['React-Attribut style={…}', /\bstyle=\{/],
  ["setAttribute('style')", /setAttribute\(\s*['"]style['"]/],
  ['cssText', /\.cssText\b/],
  ['<style>-Element', /<style[\s>]/],
  ['style-Attribut im HTML', /\sstyle="/],
];

describe('keine Inline-Styles (CSP)', () => {
  it('prüft die Quelltexte der Oberfläche', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`kein ${label}`, () => {
      const found = files
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map((file) => relative(root, file));
      expect(found).toEqual([]);
    });
  }
});
