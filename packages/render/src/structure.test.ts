import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die CSP der App erlaubt keine Inline-Styles (D-023). Dieses Paket erzeugt SVG und HTML: Quelltext, der
 * Stilangaben als Attribut oder Element schreibt, würde das stillschweigend unterlaufen. Wie
 * `apps/web/src/inline-styles.test.ts`, nur für dieses Paket. Die Muster stehen hier zusammengesetzt, damit der
 * Test sich nicht selbst findet.
 */
const root = dirname(fileURLToPath(import.meta.url));
const PATTERNS: [string, RegExp][] = [
  ['style-Attribut', new RegExp(`\\sstyle${'='}["']`)],
  ['style-Element', new RegExp(`<${'style'}[\\s>]`)],
  ['cssText', new RegExp(`\\.css${'Text'}\\b`)],
  ['setAttribute style', new RegExp(`setAttribute\\(\\s*['"]${'style'}['"]`)],
  ['eval', /\beval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['innerHTML-Zuweisung', /\.innerHTML\s*=/],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('packages/render', () => {
  it.each(PATTERNS)('Quelltext enthält kein %s', (_name, pattern) => {
    const hits = files(root).filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(hits.map((file) => file.slice(root.length))).toEqual([]);
  });
});
