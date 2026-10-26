import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Atelier, Teil 2 (Fachseite und Chat): `atelier-fach.css` ist eingebunden und hält die Regeln des Projekts
 * ein — keine festen Farben, kein `backdrop-filter`, kein dauerhaftes `will-change`; Motive zeichnen sich mit
 * `draw`, bei „Reduziert“ und „Aus“ nicht; Bedienflächen mindestens 44 px; der Composer glüht im Fokus.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(dir, 'atelier-fach.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Deklarationen der ersten Regel mit genau diesem Selektor. */
function body(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Regel fehlt: ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start + selector.length + 2, css.indexOf('}', start));
}

const A = ':root[data-design="atelier"]';

describe('atelier-fach.css ist eingebunden', () => {
  it('app.css importiert sie hinter atelier.css', () => {
    const app = readFileSync(join(dir, 'app.css'), 'utf8');
    expect(app.indexOf('@import "./atelier-fach.css"')).toBeGreaterThan(
      app.indexOf('@import "./atelier.css"'),
    );
  });
});

describe('Regeln des Projekts', () => {
  it('kennt kein backdrop-filter, kein will-change und keine festen Farben', () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/will-change/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(\s*\d/);
  });

  it('stellt Hover hinter @media (hover: hover)', () => {
    for (const treffer of css.matchAll(/([^{}]+):hover[^{]*\{/g)) {
      const davor = css.slice(0, treffer.index);
      const letzteMedia = davor.lastIndexOf('@media (hover: hover)');
      expect(letzteMedia, `Hover ohne Medienabfrage: ${treffer[0]}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('hängt neue Keyframes an --m', () => {
    const frames = body('@keyframes at-breathe');
    expect(frames).toContain('var(--m)');
  });
});

describe('Fachmotiv', () => {
  it('zeichnet die Linien mit `draw` in Vielfachen von --t-slow', () => {
    const rule = body(`${A} .lg-motif-stroke`);
    expect(rule).toContain('stroke-dasharray: 1');
    expect(rule).toContain('animation: draw calc(var(--t-slow) * 2.4)');
    expect(rule).toContain('var(--stagger)');
  });

  it('blendet bei „Reduziert“ nur ein und lässt bei „Aus“ alles sofort stehen', () => {
    const reduziert = body(`${A}.fx-reduced .lg-motif-stroke,\n${A}.fx-reduced .lg-motif-fill`);
    expect(reduziert).toContain('stroke-dasharray: none');
    expect(reduziert).toContain('animation: fade var(--t-med) both');
    const aus = body(`${A}.fx-off .lg-motif-stroke`);
    expect(aus).toContain('stroke-dasharray: none');
    expect(aus).toContain('animation: none');
  });

  it('wird im Kopf der Fachseite groß, im Chat zeichnet es sich nicht neu', () => {
    expect(css).toContain('--at-motif: 280px');
    const chat = body(`${A} .at-chat-motif .lg-motif-stroke`);
    expect(chat).toContain('animation: none');
  });

  it('bleibt im Chat in den Rändern neben der 700-px-Lesespalte', () => {
    expect(css).toContain('@media (min-width: 1280px)');
    expect(css).toContain('calc((100% - 700px) / 2 - 24px)');
    expect(css).toMatch(/\.at-chat-edge \{[^}]*pointer-events: none/);
  });
});

describe('Bedienflächen', () => {
  it.each([
    ['.at-tile-main', 'min-height: 56px'],
    ['.at-tile-open', 'min-height: 44px'],
    ['.at-tile-edit', 'width: 44px'],
    ['.at-ledger-link', 'min-height: 44px'],
    ['.at-filter-clear', 'min-height: 44px'],
    ['.at-chat-status', 'min-height: 44px'],
  ])('%s ist mindestens 44 px', (selector, deklaration) => {
    expect(body(`${A} ${selector}`)).toContain(deklaration);
  });

  it('kennzeichnet die gewählte Zeile mit einem Balken in der Fachfarbe, ohne Text zu färben', () => {
    const rule = body(`${A} .at-tile[data-pressed]`);
    expect(rule).toContain('inset 3px 0 0 var(--subj)');
    expect(rule).not.toMatch(/(^|[;\s])color:/);
  });

  it('zeigt in der Liste der Untergruppen keinen Schatten pro Zeile', () => {
    expect(body(`${A} .at-tile`)).not.toMatch(/box-shadow/);
    expect(body(`${A} .at-tiles`)).toContain('background-color: var(--surface)');
  });
});

describe('Composer', () => {
  it('hat Radius 20 px und wechselt Rand und Schatten mit --t-color', () => {
    const rule = body(`${A} .lg-composer`);
    expect(rule).toContain('border-radius: 22px');
    expect(rule).toContain('border-color var(--t-color)');
    expect(rule).toContain('box-shadow var(--t-color)');
  });

  it('glüht im Fokus in der Fachfarbe und zeigt einen Ring in der Bedienfarbe', () => {
    const rule = body(`${A} .lg-composer:focus-within`);
    expect(rule).toContain('var(--subj) 18%');
    expect(rule).toContain('outline: 2px solid var(--accent)');
  });
});
