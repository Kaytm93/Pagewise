import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * iOS-Safari zoomt eine Seite beim Fokussieren von Eingabefeldern unter 16 px und springt
 * nicht zurück (notes#17). Dieser Quelltext-Test nagelt fest: Eingabefelder (input, textarea,
 * select) tragen nie eine feste Schriftklasse unter 16 px — `text-[0.9375rem]` (15 px) war der
 * Befund am Markdown-Textfeld des Editors. Ob das Layout im echten Browser stimmt, kann jsdom
 * nicht messen — das belegt die Browsermessung (pw/agents/m3-t012, iPhone-hoch WebKit).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Findet JSX-Elemente und liefert deren Klassenzeichenkette (grob, ohne Verschachtelung). */
function klassenVon(quelle: string, tag: 'input' | 'textarea' | 'select'): string[] {
  const ergebnis: string[] = [];
  const muster = new RegExp(`<${tag}\\b[\\s\\S]*?>`, 'g');
  for (const element of quelle.matchAll(muster)) {
    const schlange: string[] = [];
    // className="…" oder className={`…`} über die Element.definition hinweg einsammeln
    const block = element[0];
    for (const m of block.matchAll(/className=\{?`([^`]*)`|className="([^"]*)"/g)) {
      schlange.push(m[1] ?? m[2] ?? '');
    }
    ergebnis.push(schlange.join(' '));
  }
  return ergebnis;
}

/** Zerlegt eine Tailwind-Schriftklasse in px (rem = 16 px Basis), `null` wenn keine feste Größe. */
function festePixel(klassen: string): number | null {
  const m = klassen.match(/text-\[(\d+(?:\.\d+)?)(rem|px)\]/);
  if (!m) return null;
  const wert = Number.parseFloat(m[1] ?? '0');
  return m[2] === 'rem' ? wert * 16 : wert;
}

const DATEIEN = [
  'screens/notes/NotePage.tsx',
  'screens/notes/NoteList.tsx',
  'screens/chat/Composer.tsx',
  'screens/home/AskForm.tsx',
  'screens/providers/ModelListEditor.tsx',
  'screens/subjects/TemplatePicker.tsx',
  'screens/onboarding/SubjectsStep.tsx',
  'ui/Field.tsx',
];

describe('Eingabefelder haben mindestens 16 px Schrift (notes#17, iOS-Auto-Zoom)', () => {
  for (const datei of DATEIEN) {
    it(`${datei}: kein input/textarea/select mit fester Schrift unter 16 px`, () => {
      const quelle = read(datei);
      for (const tag of ['input', 'textarea', 'select'] as const) {
        for (const klassen of klassenVon(quelle, tag)) {
          const px = festePixel(klassen);
          // Unsichtbare Klickflächen (opacity-0, sr-only, peer) rufen keine Texttastatur:
          // ohne eigene Schriftklasse erben sie die des Elters; hier zählt nur die feste Angabe am Feld.
          const unsichtbar = /opacity-0|sr-only/.test(klassen);
          if (px !== null && !unsichtbar) {
            expect(px, `${datei}: ${tag} mit text-[…] unter 16 px`).toBeGreaterThanOrEqual(16);
          }
        }
      }
    });
  }

  it('das Markdown-Textfeld des Editors nutzt text-base (die frühere 15-px-Stelle)', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    const textfeld = quelle.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? '';
    expect(textfeld).toContain('text-base');
    expect(textfeld).not.toContain('0.9375rem');
  });

  it('kein 0.9375rem mehr im gesamten web-src für Eingabefelder', () => {
    for (const datei of DATEIEN) {
      expect(read(datei).includes('text-[0.9375rem]'), datei).toBe(false);
    }
  });
});
