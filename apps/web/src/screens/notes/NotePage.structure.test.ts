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
    // Das Markdown-Feld (nicht das neue Titel-Textarea): das Element, das id="note-text" trägt.
    const pos = quelle.indexOf('id="note-text"');
    const start = quelle.lastIndexOf('<textarea', pos);
    const textfeld = quelle.slice(start, start + 1600);
    expect(textfeld).toContain('text-base');
    expect(textfeld).not.toContain('0.9375rem');
  });

  it('kein 0.9375rem mehr im gesamten web-src für Eingabefelder', () => {
    for (const datei of DATEIEN) {
      expect(read(datei).includes('text-[0.9375rem]'), datei).toBe(false);
    }
  });
});

/*
 * Fokus einheitlich wie in ui/Field.tsx (notes#08): Eingabefelder tragen nicht nur den Randwechsel,
 * sondern den 3-px-Hof (Akzentfarbe, 22 % Mischung) — jsdom kann Schatten nicht zeichnen, das
 * nagelt die Klassen fest; die Sichtbarkeit in allen Richtungen und Helligkeiten misst der
 * Echtbrowser (pw/agents/m3-t018).
 */
describe('Eingabefelder haben den gemeinsamen Fokus-Hof (notes#08)', () => {
  const FOKUS = 'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]';

  it('Editor: Titel, Stichwörter und Text tragen den Hof wie Field.tsx', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    for (const id of ['note-title', 'note-tags', 'note-text']) {
      const feld = quelle.split(`id="${id}"`)[1] ?? '';
      expect(feld.slice(0, 1200), id).toContain(FOKUS);
    }
  });

  it('Suche in der Liste trägt den Hof wie Field.tsx', () => {
    const quelle = read('screens/notes/NoteList.tsx');
    const suche = quelle.match(/<input\b[\s\S]*?\/>/)?.[0] ?? '';
    expect(suche).toContain('type="search"');
    expect(suche).toContain(FOKUS);
  });

  it('Titel markiert Fehler sichtbar in Rahmenfarbe (aria-invalid → danger)', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    const titel = quelle.split('id="note-title"')[1] ?? '';
    expect(titel.slice(0, 1100)).toContain('aria-invalid:border-danger');
  });
});

/*
 * Titelfeld des Editors (notes#03): eine einzeilige Textarea mit Auto-Höhe statt eines input, damit
 * lange Titel (bis 120 Zeichen) umbrechen statt mittendrin abgeschnitten zu werden. Die Höhe läuft
 * über eine CSSOM-Variable (setProperty('--note-title-lines', …)) — die strenge CSP verbietet
 * Inline-Stil-Attribute; jsdom kann Höhe nicht messen, den echten Umbrauch misst der Echtbrowser
 * (pw/agents/m4-t006).
 */
describe('Editor-Titel: mehrzeilig statt abgeschnitten (notes#03)', () => {
  /** Das Titelfeld (Textarea) aus dem Quelltext schneiden, nicht das Markdown-Textfeld. */
  function titelfeld() {
    const quelle = read('screens/notes/NotePage.tsx');
    const pos = quelle.indexOf('id="note-title"');
    const start = quelle.lastIndexOf('<textarea', pos);
    return quelle.slice(start, start + 2200);
  }

  it('das Titelfeld ist eine einzeilige Textarea mit Auto-Höhe, Enter ohne Zeilenumbruch', () => {
    const element = titelfeld();
    expect(element).toContain('id="note-title"');
    expect(element).toContain('rows={1}');
    // Auto-Höhe über die CSSOM-Variable, gesetzt per setProperty (kein Inline-Stil-Attribut, CSP)
    expect(element).toContain('--note-title-lines');
    expect(element).toContain('resize-none');
    expect(element).toContain('overflow-hidden');
    // Enter verhindert den Zeilenumbruch im Titel
    expect(element).toContain("event.key === 'Enter'");
    expect(element).toContain('event.preventDefault()');
    // maxLength 120 bleibt
    expect(element).toContain('maxLength={120}');
    // Kein hartes Clippen mehr (M3-T028): kein truncate/ellipsis am Titel
    expect(element).not.toMatch(/truncate|text-ellipsis/);
  });

  it('die Höhe wird per CSSOM-Variable gesetzt, nie über ein Inline-Stil-Attribut (CSP)', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    expect(quelle).toContain("setProperty('--note-title-lines'");
    expect(quelle).not.toMatch(/style=\{/);
  });
});

/*
 * Werkzeug-Kopf des Editors (M4-T007, notes#13): Stichwörter und Einfügen-Leiste stehen als ein
 * <details> zusammen und sind ab Werk zu, damit das Textfeld auf niedrigen Bildschirmen (iPhone quer
 * 844×390, mac-min 800×560) sofort im ersten Bildschirm beginnt. Ob die Oberkante wirklich oberhalb
 * der halben Höhe liegt, kann jsdom nicht messen — das belegt die Browsermessung (pw/agents/m4-t007).
 */
describe('Editor-Kopf: Werkzeuge einklappbar, ab Werk zu (M4-T007)', () => {
  function kopf() {
    const quelle = read('screens/notes/NotePage.tsx');
    const start = quelle.indexOf('<details');
    return quelle.slice(start, quelle.indexOf('</details>', start));
  }

  it('Stichwörter und Einfügen liegen in einem details mit summary als Bedienfläche', () => {
    const block = kopf();
    expect(block).toContain('id="note-kopf"');
    expect(block).toContain('<summary');
    expect(block).toContain('id="note-tags"');
    expect(block).toContain('role="toolbar"');
    // Zusammenfassung nennt beide Teile (i18n-Text, Stichwortzahl)
    expect(block).toContain('m.notes.editor.toolsShow');
    expect(block).toContain('m.notes.editor.toolsHide');
    // Bedienfläche mindestens 44 px
    expect(block).toContain('min-h-11');
  });

  it('der Zustand hängt nativ am details: kein aria-expanded, kein style-Attribut (CSP)', () => {
    const block = kopf();
    expect(block).not.toContain('aria-expanded');
    expect(block).not.toMatch(/style=\{/);
    expect(block).toContain('onToggle=');
  });

  it('das Textfeld liegt außerhalb des Aufklappers (bleibt beim Zuklappen sichtbar)', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    const kopfEnde = quelle.indexOf('</details>');
    const textfeld = quelle.indexOf('id="note-text"');
    expect(kopfEnde).toBeGreaterThan(-1);
    expect(textfeld).toBeGreaterThan(kopfEnde);
  });

  it('der Ansichts-Umschalter sitzt in der Aktionszeile, direkt nach dem Aufklapper folgt das Raster', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    const aktionen = quelle.indexOf('ml-auto');
    const umschalter = quelle.indexOf('e.editorView');
    expect(aktionen).toBeGreaterThan(-1);
    expect(umschalter).toBeGreaterThan(aktionen);
    // Keine eigene Umschalter-Zeile mehr zwischen Aufklapper und Textfeld-Raster (notes#13).
    const nachKopf = quelle.slice(
      quelle.indexOf('</details>') + '</details>'.length,
      quelle.indexOf('<div className="mt-3 grid'),
    );
    expect(nachKopf.trim()).toBe('');
  });
});

/*
 * Stichwörter zeigen ihre Grenzen (M4-T016, notes#09): Der Dauertext nennt beide Grenzen (10 ×
 * 30 Zeichen, wie der Server in routes/notes.ts per Zod verlangt), Übermaß wird über aria-invalid
 * + Grenz-Meldung sichtbar gemacht und beim Verlassen des Feldes sichtbar abgeglichen. Feld und
 * Meldung tragen mindestens 16 px Schrift (iOS-Safari zoomt kleinere Felder beim Fokussieren,
 * notes#17) und hängen zusammen (aria-describedby).
 */
describe('Stichwörter: Grenzen sichtbar, Abgleich beim Verlassen (M4-T016, notes#09)', () => {
  function stichwortbereich() {
    const quelle = read('screens/notes/NotePage.tsx');
    const start = quelle.indexOf('id="note-tags"');
    return quelle.slice(quelle.lastIndexOf('<input', start), quelle.indexOf('</div>', start));
  }

  it('der Dauertext nennt beide Grenzen wie die Server-Validierung (10 × 30 Zeichen)', () => {
    const hinweis = read('i18n/de.ts');
    expect(hinweis).toContain(
      "tagsHint: 'Mit Komma getrennt. Bis zu 10 Stichwörter, je höchstens 30 Zeichen.',",
    );
    expect(hinweis).toContain("tagsLimit: 'Überzähliges fällt beim Verlassen des Feldes weg.',");
    // Feld und Meldung sind verbunden (Screenreader hört die Meldung mit).
    const bereich = stichwortbereich();
    expect(bereich).toContain('note-tags-hint');
    expect(bereich).toContain('note-tags-limit');
  });

  it('das Feld trägt 16-px-Schrift und der Abgleich hängt am Verlassen des Feldes', () => {
    const bereich = stichwortbereich();
    // Die 16-px-Regel für Eingabefelder (notes#17) nagelt die DATEIEN-Schleife oben schon fest;
    // hier steht der Abgleich selbst: blur + Grenz-Meldung über aria-invalid.
    expect(bereich).toContain('text-base');
    expect(bereich).toContain('onBlur={stichwoerterAnpassen}');
    expect(bereich).toContain('aria-invalid={stichwoerterZuViel');
  });

  it('kein style-Attribut im Stichwortbereich (CSP), Grenz-Rahmen über aria-invalid-Klassen', () => {
    const bereich = stichwortbereich();
    expect(bereich).not.toMatch(/style=\{/);
    expect(bereich).toContain('aria-invalid:border-danger');
  });

  it('die Zahl in der Zusammenfassung zählt die gespeicherten Stichwörter (nach dem Abgleich)', () => {
    const quelle = read('screens/notes/NotePage.tsx');
    expect(quelle).toContain('format(m.notes.editor.toolsShow, { count: stichwoerter.length })');
    expect(quelle).toContain('format(m.notes.editor.toolsHide, { count: stichwoerter.length })');
  });
});
