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
    for (const part of ['30%', '15%', '9%', '6%']) {
      expect(css).toContain(`calc(${part} * var(--at-k))`);
    }
    // Grund und Lichtband tragen keine festen Anteile mehr (früher 22/12 % und 8/5 % in beiden Modi).
    for (const selector of [
      ":root[data-design='atelier'] .lg-app::before",
      ":root[data-design='atelier'] .lg-app::after",
    ]) {
      expect(rule(selector)).not.toMatch(/var\(--subj\) \d+%/);
    }
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

  it('nutzt weder backdrop-filter noch Inline-Zwang', () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/!important/);
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
