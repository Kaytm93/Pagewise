import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, TEMPLATES } from '../screens/notes/templates';
import { SUBJECT_ICONS } from '../ui/SubjectIcon';
import { de } from './de';

/*
 * B-15 (D-095): Texte der Oberfläche stehen nur in `i18n/de.ts` (CLAUDE.md). Betroffen waren die
 * 15 Namen der Fachsymbole (für Bildschirmleser), die vier Platzhaltersätze der Hinweisvorlagen
 * im Editor und ein Selektor auf den übersetzten Namen „Hefteinträge“ in der Fachseite.
 * Der Wortlaut bleibt unverändert; dieser Test nagelt ihn fest und sucht die Literale in den
 * Quelltexten, aus denen sie entfernt wurden.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Quelltext ohne Kommentare und ohne Importpfade; andere Zeichenketten bleiben stehen. */
function code(relativePath: string): string {
  const text = readFileSync(join(src, relativePath), 'utf8');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bfrom\s+'[^'\n]*'/g, 'from IMPORT')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

/** Alle Zeichenketten (einfache, doppelte, Schablonen) eines Quelltexts. */
function literals(text: string): string[] {
  return [...text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(
    (match) => match[0],
  );
}

const ICON_NAMES = {
  book: 'Buch',
  pen: 'Stift',
  languages: 'Sprachen',
  calculator: 'Rechner',
  atom: 'Atom',
  flask: 'Kolben',
  microscope: 'Mikroskop',
  leaf: 'Blatt',
  globe: 'Globus',
  landmark: 'Gebäude',
  scale: 'Waage',
  music: 'Musik',
  palette: 'Palette',
  sport: 'Hantel',
  code: 'Code',
};

const TEMPLATE_TEXTS = {
  merksatz: 'Hier steht der Merksatz.',
  beispiel: 'Hier steht ein Beispiel.',
  aufgabe: 'Hier steht die Aufgabe.',
  definition: 'Hier steht die Definition.',
};

const DATEIEN = [
  'ui/SubjectIcon.tsx',
  'ui/IconPicker.tsx',
  'screens/notes/templates.ts',
  'screens/SubjectPage.tsx',
];

describe('Symbolnamen und Vorlagentexte stehen in i18n/de.ts (B-15)', () => {
  it('de.ts trägt die 15 Symbolnamen im bisherigen Wortlaut', () => {
    expect(de.subjectDialog.iconNames).toEqual(ICON_NAMES);
  });

  it('de.ts trägt die vier Platzhaltersätze im bisherigen Wortlaut', () => {
    expect(de.notes.templateText).toEqual(TEMPLATE_TEXTS);
  });

  it('SUBJECT_ICONS liest jeden Namen aus de.ts, in der bisherigen Reihenfolge', () => {
    expect(SUBJECT_ICONS.map((entry) => entry.id)).toEqual(Object.keys(ICON_NAMES));
    for (const { id, label } of SUBJECT_ICONS) {
      expect(label, id).toBe(de.subjectDialog.iconNames[id as keyof typeof ICON_NAMES]);
    }
  });

  it('die Vorlagen enthalten die Sätze aus de.ts und ändern sonst nichts', () => {
    expect(TEMPLATE_KEYS).toEqual([
      'formula',
      'graph',
      'mol',
      'abc',
      'merksatz',
      'beispiel',
      'aufgabe',
      'definition',
    ]);
    for (const [key, satz] of Object.entries(TEMPLATE_TEXTS)) {
      expect(TEMPLATES[key as keyof typeof TEMPLATE_TEXTS], key).toBe(`> [!${key}]\n> ${satz}`);
    }
  });

  it('in den vier Quelltexten steht kein Symbolname und kein Vorlagensatz mehr', () => {
    for (const datei of DATEIEN) {
      const zeichenketten = literals(code(datei));
      for (const wert of [...Object.values(ICON_NAMES), ...Object.values(TEMPLATE_TEXTS)]) {
        for (const literal of zeichenketten) {
          expect(literal, `${datei}: „${wert}“`).not.toContain(wert);
        }
      }
    }
  });

  it('die vier Quelltexte haben keine deutsche Zeichenkette (Umlaut oder groß geschriebenes Wort)', () => {
    for (const datei of DATEIEN) {
      for (const literal of literals(code(datei))) {
        expect(literal, `${datei}: ${literal}`).not.toMatch(/[äöüÄÖÜß]/);
        expect(literal, `${datei}: ${literal}`).not.toMatch(/\b[A-ZÄÖÜ][a-zäöüß]{2,}\b/);
      }
    }
  });

  it('die Fachseite sucht ihr Panel nicht mehr über den übersetzten aria-label', () => {
    const text = code('screens/SubjectPage.tsx');
    expect(text).not.toMatch(/querySelector(All)?\(\s*['"`][^'"`]*aria-label/);
    expect(text).not.toContain(de.notes.notes);
    expect(text).toContain('hefte-eintraege-panel');
    expect(code('screens/notes/NoteList.tsx')).toContain('id="hefte-eintraege-panel"');
  });
});
