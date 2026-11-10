import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { de } from './de';

/*
 * D-107: Auch die neue Bilderkennung bleibt bei der Regel aus B-15 — alle deutschen Texte
 * stehen in `i18n/de.ts`, die Bauteile enthalten nur Verweise darauf.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Quelltext ohne Kommentare; alle Zeichenketten bleiben stehen. */
function code(relativePath: string): string {
  return readFileSync(join(src, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bfrom\s+'[^'\n]*'/g, 'from IMPORT')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

function literals(text: string): string[] {
  return [...text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(
    (match) => match[0],
  );
}

describe('Texte der Stundenplan-Erkennung', () => {
  it('de.ts trägt die neuen Oberflächentexte', () => {
    const t = de.planning.timetableScan;
    expect(t.open).toBe('Aus Bild erkennen');
    expect(t.title).toBe('Stundenplan aus Bild erkennen');
    expect(t.emptyTitle).toBe('Keine Stunden erkannt');
    expect(t.errors.fileType).toBe('Bitte wähle ein PNG- oder JPEG-Bild.');
    expect(Object.keys(t.errors)).toHaveLength(13);
  });

  it('die Bauteile enthalten keine deutschen Zeichenketten', () => {
    for (const datei of ['planning/TimetableScanDialog.tsx', 'planning/TimetablePage.tsx']) {
      const text = code(datei);
      expect(text).toContain('m.planning.timetableScan');
      for (const literal of literals(text)) {
        expect(literal, `${datei}: ${literal}`).not.toMatch(/[äöüÄÖÜß]/);
        expect(literal, `${datei}: ${literal}`).not.toMatch(/\b[A-ZÄÖÜ][a-zäöüß]{2,}\b/);
      }
    }
  });
});
