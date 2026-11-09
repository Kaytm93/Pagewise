import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { iconButton, listRowAction } from './styles';

/*
 * D-109: Jede Bedienfläche hat dieselben Zustände. Hover (nur mit Maus, siehe styles/hover-media.test.ts),
 * sichtbarer Fokus (allgemeine Regel in app.css), gedrückt (`mo-press` für gehobene, `mo-tap` für flache
 * Elemente, `lg-row` für Zeilen oder eine `active:`-Klasse) und mindestens 44 px Zielgröße.
 * Der Test liest den Quelltext: jsdom kennt weder :hover noch :active.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = (file: string) => readFileSync(join(src, 'styles', file), 'utf8');

function quelltexte(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return quelltexte(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return [{ file: path.slice(src.length + 1), text: readFileSync(path, 'utf8') }];
  });
}

/** Zeichenketten einer Zeile (einfach, doppelt, Backtick), also auch Klassenlisten in Konstanten. */
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const literale = quelltexte(src).flatMap(({ file, text }) =>
  text.split('\n').flatMap((line, index) =>
    [...line.matchAll(LITERAL)].map((match) => ({
      ort: `${file}:${index + 1}`,
      file,
      klassen: match[2] as string,
    })),
  ),
);

const HOVER = /(^|\s)hover:/;
const GEDRUECKT = /(^|\s)(mo-press|mo-tap|lg-row|lg-agent-head|active:\S+)(\s|$)/;

/*
 * Klassenlisten, die erst zusammengesetzt einen gedrückten Zustand haben: Die Datei muss `mo-press` enthalten
 * (Grundklasse von Knopf, Reiter und Sendeknopf). Eingabefelder (Titel des Eintrags, Dateiwahl) haben keinen.
 */
const ZUSAMMENGESETZT = ['ui/Button.tsx', 'ui/Tabs.tsx', 'screens/chat/Composer.tsx'];
const FELDER = /(^|\s)(resize-none|file:\S+)(\s|$)/;

describe('Zustände der Bedienflächen (D-109)', () => {
  it('gibt jedem Element mit Hover auch einen gedrückten Zustand', () => {
    const ohne = literale.filter(
      ({ klassen, file }) =>
        HOVER.test(klassen) &&
        !GEDRUECKT.test(klassen) &&
        !FELDER.test(klassen) &&
        !ZUSAMMENGESETZT.includes(file),
    );
    expect(ohne.map(({ ort, klassen }) => `${ort}: ${klassen}`)).toEqual([]);
  });

  it.each(ZUSAMMENGESETZT)(
    '%s setzt den gedrückten Zustand über die Grundklasse mo-press',
    (file) => {
      expect(readFileSync(join(src, file), 'utf8')).toMatch(/\bmo-press\b/);
    },
  );

  it('hält jedes Ziel mit Hover oder gedrücktem Zustand bei mindestens 44 px', () => {
    const zuKlein = literale.filter(({ klassen }) => {
      if (!HOVER.test(klassen) && !GEDRUECKT.test(klassen)) return false;
      const groesse = /(^|\s)(size|h|min-h)-(\d+(?:\.\d+)?)(\s|$)/.exec(klassen);
      if (!groesse || Number(groesse[3]) >= 11) return false;
      return !/(^|\s)(mo-hit|min-h-11)(\s|$)/.test(klassen);
    });
    expect(zuKlein.map(({ ort, klassen }) => `${ort}: ${klassen}`)).toEqual([]);
  });

  it('haben die gemeinsamen Symbol-Knöpfe 44 px, Hover, gedrückt und deaktiviert', () => {
    for (const klassen of [iconButton, listRowAction]) {
      expect(klassen.split(' ')).toEqual(
        expect.arrayContaining(['size-11', 'hover:bg-paper', 'disabled:opacity-50']),
      );
      expect(klassen).toMatch(GEDRUECKT);
    }
  });
});

describe('mo-tap und mo-hit (motion.css, D-109)', () => {
  const motion = css('motion.css');
  const regel = (selector: string) => {
    const start = motion.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return motion.slice(start, motion.indexOf('}', start));
  };

  it('bewegt nur transform und opacity, Farben wechseln mit --t-color', () => {
    const uebergang = regel('.mo-tap');
    expect(uebergang).toContain('transform var(--t-fast) var(--ease)');
    for (const eigenschaft of ['opacity', 'background-color', 'border-color', 'color']) {
      expect(uebergang).toContain(`${eigenschaft} var(--t-color) ease`);
    }
  });

  it('gibt beim Drücken über --m nach: bei „Reduziert“ und „Aus“ bewegt sich nichts, es wird nur blasser', () => {
    const gedrueckt = regel('.mo-tap:active');
    expect(gedrueckt).toContain('transform: scale(calc(1 - var(--m) * 0.04))');
    expect(gedrueckt).toContain('opacity: 0.78');
    expect(motion).toMatch(/:root\.fx-reduced \{\s*--m: 0;/);
    expect(motion).toMatch(/:root\.fx-off \{\s*--m: 0;/);
  });

  it('vergrößert kleine Symbole unsichtbar auf 44 px Trefferfläche', () => {
    const flaeche = regel('.mo-hit::after');
    expect(flaeche).toContain('width: max(100%, 44px)');
    expect(flaeche).toContain('height: max(100%, 44px)');
  });

  it('gibt Textlinks, Aufklappern und Auswahl-Labels einen gedrückten Grundzustand ohne Spezifität', () => {
    const app = css('app.css');
    expect(app).toMatch(/:where\(a\[href\], summary, label:has\(/);
    expect(app).toMatch(/\):active \{\s*opacity: 0\.78;/);
  });
});
