import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Bauweise von `atelier.css`, die der Kontrast- und der Bildschirmtest nicht sehen: das Licht hängt an
 * `--at-k`, der Wochenstreifen bricht lange Wörter um, das Zeigerlicht ist an Maus und „Voll“ gebunden,
 * und die Fachfarbe steht als Text nur über `--hue-ink`. Der Test liest den Quelltext.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'atelier.css'), 'utf8')
  .replaceAll('"', "'")
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Der Rumpf der ersten Regel, deren Auswahl genau `selector` ist. */
function rule(selector: string): string {
  const start = css.search(
    new RegExp(`(^|[}{;\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`),
  );
  if (start === -1) throw new Error(`Regel nicht gefunden: ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('Licht der Fachfarbe', () => {
  it('hängt an --at-k statt an festen Prozenten', () => {
    expect(css).toContain('calc(30% * var(--at-k))');
    expect(css).toContain('calc(20% * var(--at-k))');
    // Der Grund trägt keinen festen Anteil (früher 22/12 % und 8/5 % in beiden Modi).
    expect(rule(":root[data-design='atelier'] .lg-app::before")).not.toMatch(/var\(--subj\) \d+%/);
  });

  it('ist ein einziges Lichtfeld: kein zweites Band, keine Drift', () => {
    expect(css).not.toMatch(/\.lg-app::after/);
    expect(css).not.toMatch(/atelier-drift/);
    expect(
      rule(":root[data-design='atelier'] .lg-app::before").match(/radial-gradient\(/g),
    ).toHaveLength(1);
  });
});

describe('Wochenstreifen', () => {
  it('hat fünf Spalten, die schrumpfen dürfen, und bricht lange Wörter um', () => {
    expect(rule('.at-week')).toMatch(/repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    const item = rule('.at-week-item');
    expect(item).toMatch(/min-width:\s*0/);
    expect(item).toMatch(/overflow-wrap:\s*anywhere/);
    expect(item).toMatch(/hyphens:\s*auto/);
  });
});

describe('Zeigerlicht', () => {
  it('bewegt den Schein per transform und blendet nur seine Deckkraft ein', () => {
    const glow = rule(
      ":root[data-design='atelier'] :is(.lg-binder, .lg-slip, .lg-row, .at-glow)::after",
    );
    expect(glow).toMatch(
      /transform:\s*translate3d\(var\(--gx,\s*0px\),\s*var\(--gy,\s*0px\),\s*0\)/,
    );
    expect(glow).toMatch(/opacity:\s*0/);
    expect(glow).toMatch(/transition:\s*opacity/);
  });

  it('zeigt ihn nur mit Maus und in „Voll“ und setzt will-change nur dort', () => {
    expect(css.match(/will-change/g)).toHaveLength(1);
    const at = css.indexOf('will-change');
    const before = css.slice(Math.max(0, at - 260), at);
    expect(before).toContain('.fx-full');
    expect(before).toContain(':hover::after');
    expect(css.slice(0, at)).toContain('@media (hover: hover)');
    expect(css.slice(0, at)).toContain('@media (pointer: fine)');
  });

  it('setzt backdrop-filter nur innerhalb der Glasklassen (.at-glass), mit --glass-blur, nie mit !important', () => {
    // Deklarationen, keine @supports-Bedingung: die beginnt mit „(“ und zählt hier nicht.
    const treffer = [...css.matchAll(/(^|[;{\s])(-webkit-)?backdrop-filter\s*:/g)];
    expect(treffer.length).toBeGreaterThan(0);
    for (const match of treffer) {
      const open = css.lastIndexOf('{', (match.index ?? 0) + match[0].length);
      const start =
        Math.max(
          css.lastIndexOf('}', open),
          css.lastIndexOf(';', open),
          css.lastIndexOf('{', open - 1),
        ) + 1;
      expect(css.slice(start, open), 'backdrop-filter außerhalb der Glasklassen').toMatch(
        /\.at-glass(?![\w-])/,
      );
    }
    expect(css).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur\)\)/);
    expect(css).not.toMatch(/!important/);
  });
});

/*
 * Kopf der schmalen Breite in „Atelier“ (D-076, Befund B-18, Kay GF-03): Glas erst beim Scrollen. In Ruhe liegt der
 * Kopf ohne Fläche, ohne Filter und ohne Rand auf dem Fachlicht; mit `data-scrolled` (gesetzt von `ui/scrolled.ts`)
 * wird die Ebene `::before` zum heutigen Glas. Der Blur lässt sich nur in Chromium prüfen (Playwright-WebKit zeichnet
 * `backdrop-filter` nicht, D-077); darum sichert dieser Test die Bauweise: Das Glas hängt an der Ebene, und `opacity`
 * läuft nur dort, nie am Kopf oder an einem Vorfahren (ein Vorfahr mit opacity unter 1 nähme dem Glas den Blur).
 */
describe('Kopf der schmalen Breite: Glas erst beim Scrollen (D-076)', () => {
  const kopf = ":root[data-design='atelier'] header.sticky.md\\:hidden";
  const ebene = `${kopf}::before`;
  const gescrollt = `${kopf}[data-scrolled]::before`;

  /** Alle flachen Regeln (Auswahl und Rumpf), auch innerhalb von @layer und @supports. */
  const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] as string).trim(),
    body: match[2] as string,
  }));
  const mitKopf = regeln.filter((regel) => regel.selector.includes('header.sticky.md\\:hidden'));
  /** Die Regel, die die Ebene anlegt (nicht die Glasregel, deren Auswahl die Ebene am Ende nennt). */
  const ebeneAnlegen = regeln.find(
    (regel) => regel.selector === ebene && regel.body.includes('content:'),
  )?.body;

  it('lässt den Kopf in Ruhe ohne Fläche, ohne Rand und ohne Schatten', () => {
    const body = rule(kopf);
    expect(body).toMatch(/background-color:\s*transparent\b/);
    expect(body).toMatch(/border:\s*0\b/);
    expect(body).toMatch(/box-shadow:\s*none\b/);
  });

  it('hängt weder backdrop-filter noch opacity noch einen Übergang an den Kopf selbst', () => {
    for (const regel of mitKopf) {
      const istEbene = /::before\s*$/.test(regel.selector.replace(/\[data-scrolled\]/, ''));
      if (istEbene) continue;
      expect(regel.body, `Kopf selbst: ${regel.selector}`).not.toMatch(
        /backdrop-filter|(^|[;\s])opacity\s*:|transition|filter\s*:/,
      );
    }
  });

  it('legt das Glas als Ebene ::before hinter den Inhalt des Kopfes, in Ruhe unsichtbar', () => {
    const body = ebeneAnlegen ?? '';
    expect(body).toContain("content: ''");
    expect(body).toMatch(/position:\s*absolute\b/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/z-index:\s*-1\b/);
    expect(body).toMatch(/opacity:\s*0\b/);
    expect(body).toMatch(/pointer-events:\s*none\b/);
  });

  it('macht die Ebene mit data-scrolled sichtbar', () => {
    expect(rule(gescrollt)).toMatch(/opacity:\s*1\b/);
  });

  it('gibt der Ebene das heutige Glas: Füllung, Haarstrich, Schatten und Blur aus den Glas-Tokens', () => {
    const glas = regeln.find(
      (regel) =>
        regel.selector.includes('header.sticky.md\\:hidden::before') &&
        /backdrop-filter/.test(regel.body),
    );
    expect(glas, 'Glasregel mit der Ebene des Kopfes').toBeDefined();
    const body = glas?.body ?? '';
    expect(body).toMatch(/background-color:\s*var\(--glass-fill\)/);
    expect(body).toMatch(/inset 0 0 0 1px var\(--glass-edge-side\)/);
    expect(body).toMatch(/inset 0 1px 0 var\(--glass-edge\)/);
    expect(body).toMatch(/var\(--glass-shadow-near\)/);
    expect(body).toMatch(/var\(--glass-shadow-far\)/);
    expect(body).toMatch(
      /-webkit-backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(160%\)/,
    );
    // Die Glasregel nennt den Kopf nur als Ebene, nie als Element (sonst läge das Glas in Ruhe am Kopf).
    expect(glas?.selector).not.toMatch(/header\.sticky\.md\\:hidden\s*(,|$)/);
  });

  it('animiert nur die Ebene, nur über opacity und mit --t-color (0 ms bei „Reduziert“ und „Aus“)', () => {
    const body = ebeneAnlegen ?? '';
    const transitions = [...body.matchAll(/transition:\s*([^;]+);/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(transitions).toEqual(['opacity var(--t-color)']);
    expect(body).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
  });

  it('bietet ohne backdrop-filter die deckende Fläche (--canvas, 94 %) an der Ebene', () => {
    const regel = regeln.find(
      (eintrag) =>
        eintrag.selector === ebene && /color-mix\(in srgb, var\(--canvas\) 94%/.test(eintrag.body),
    );
    expect(regel, 'Rückfall ohne backdrop-filter').toBeDefined();
    expect(css).toMatch(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*:root\[data-design='atelier'\] header\.sticky\.md\\:hidden::before/,
    );
  });

  it('nutzt keine festen Farben für Kopf und Ebene', () => {
    for (const body of [rule(kopf), ebeneAnlegen ?? '', rule(gescrollt)]) {
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
});

describe('Radien (22 px, 12 px, Pille)', () => {
  it('kennt in Atelier nur 0, 12 px, 22 px, Pille und Kreis (atelier-fach.test.ts)', () => {
    const fach = readFileSync(join(dir, 'atelier-fach.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const erlaubt = new Set([
      '0',
      '12px',
      '12px 12px 0 0',
      '22px',
      '22px 22px 0 0',
      '50%',
      '999px',
      'inherit',
    ]);
    for (const quelle of [css, fach]) {
      for (const match of quelle.matchAll(/border-radius:\s*([^;]+);/g)) {
        expect(erlaubt.has((match[1] as string).trim()), `Radius ${match[1]}`).toBe(true);
      }
    }
  });
});

describe('Fachfarbe als Text', () => {
  it('Zahl, Marken, Symbole und die große Zeile nutzen --hue-ink, nie --subj als Farbe', () => {
    for (const selector of [
      '.at-count-num',
      '.at-who-icon',
      '.at-week-item[data-test] .at-week-day',
      '.at-day-row[data-lead] .at-meta',
    ]) {
      expect(rule(selector)).toMatch(/color:\s*var\(--hue-ink\)/);
    }
    // `--subj` darf Fläche, Rand und Verlauf färben, aber keine Zeile `color: var(--subj)` stehen haben.
    expect(css).not.toMatch(/(^|[;{\s])color:\s*var\(--subj\)/);
  });

  it('die Seitenleiste zeigt Fach-Icons als Kreis in --hue-ink', () => {
    const icon = rule(":root[data-design='atelier'] .lg-nav-item > svg:first-child");
    expect(icon).toMatch(/border-radius:\s*50%/);
    expect(icon).toMatch(/color:\s*var\(--hue-ink\)/);
  });
});
