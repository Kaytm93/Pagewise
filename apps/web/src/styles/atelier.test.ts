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
