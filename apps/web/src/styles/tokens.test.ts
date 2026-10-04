import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Der Formatter darf Anführungszeichen im CSS ändern, daher vereinheitlichen.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
).replaceAll('"', "'");

type Tokens = Record<string, string>;

/** Liest die Deklarationen des ersten Blocks, der mit `opener` beginnt. */
function block(source: string, opener: string): Tokens {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`Block nicht gefunden: ${opener}`);
  const end = source.indexOf('}', start);
  const body = source.slice(start + opener.length, end);
  const tokens: Tokens = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1] as string] = (match[2] as string).trim();
  }
  return tokens;
}

const palette = block(css, '@theme {');
const light = block(css, ':root {');
const dark = block(css, ":root[data-theme='dark'] {");
const darkAuto = block(css, ":root:not([data-theme='light']) {");

/** Löst `var(--…)` auf: erst in den übergebenen semantischen Tokens, dann in der Palette. */
function toHex(value: string, tokens: Tokens = {}): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) {
    const name = reference[1] as string;
    return toHex((tokens[name] ?? palette[name]) as string, tokens);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Kein Hex-Wert: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const channel = (shift: number) => {
    const value = ((Number.parseInt(hex.slice(1), 16) >> shift) & 255) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function contrast(foreground: string, background: string): number {
  const [bright, dim] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((bright as number) + 0.05) / ((dim as number) + 0.05);
}

// Flächen, auf denen Text steht. `--sheet` (Blatt) und `--slip` (Zettel) gehören zur Gestaltung „Lagen“ (D-043).
const surfaces = ['--canvas', '--surface', '--paper', '--workspace', '--sheet', '--slip'];
const texts = ['--ink', '--ink-secondary', '--ink-muted', '--link', '--danger'];

describe.each([
  ['hell', light],
  ['dunkel', { ...light, ...dark }],
])('Kontrast im %s Modus (WCAG AA)', (_name, tokens) => {
  const color = (token: string) => toHex(tokens[token] as string, tokens);

  for (const text of texts) {
    for (const surface of surfaces) {
      it(`${text} auf ${surface} erreicht mindestens 4,5 : 1`, () => {
        expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('Text auf der primären Fläche erreicht mindestens 4,5 : 1', () => {
    expect(contrast(color('--on-primary'), color('--primary'))).toBeGreaterThanOrEqual(4.5);
  });

  it('Eingabefeld-Rand hebt sich von allen Flächen mit mindestens 3 : 1 ab', () => {
    for (const surface of surfaces) {
      expect(contrast(color('--control-edge'), color(surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it('Akzent und primäre Fläche heben sich als Bedienelemente mit mindestens 3 : 1 ab', () => {
    for (const surface of ['--canvas', '--workspace']) {
      expect(contrast(color('--accent'), color(surface))).toBeGreaterThanOrEqual(3);
      expect(contrast(color('--primary'), color(surface))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Token-Namen', () => {
  it('kein Utility-Token in `@theme inline` heißt wie ein Palettenwert in `@theme`', () => {
    // Doppelte Namen ergeben einen Zirkelbezug (--control-edge → --color-… → --control-edge),
    // der Wert fällt dann still weg. Die Tests oben lösen var() über die Palette auf und sähen das nicht.
    const utilities = block(css, '@theme inline {');
    const clashes = Object.keys(utilities).filter((name) => name in palette);
    expect(clashes).toEqual([]);
  });

  it('jedes Utility-Token zeigt auf ein semantisches Token, das es gibt', () => {
    const utilities = block(css, '@theme inline {');
    for (const value of Object.values(utilities)) {
      const reference = /^var\((--[\w-]+)\)$/.exec(value);
      expect(reference, value).not.toBeNull();
      expect((reference?.[1] as string) in light, value).toBe(true);
    }
  });
});

describe('Dunkler Modus', () => {
  it('schaltet automatisch und per data-theme dieselben Tokens um', () => {
    expect(darkAuto).toEqual(dark);
  });

  it('überschreibt alle semantischen Tokens des hellen Modus', () => {
    const missing = Object.keys(light).filter(
      (token) => token !== 'color-scheme' && !(token in dark),
    );
    expect(missing).toEqual([]);
  });
});

describe('Research Blue (siehe docs/decisions.md, D-008)', () => {
  const blue = toHex(palette['--color-research-blue'] as string);
  const canvas = toHex(palette['--color-eggshell-canvas'] as string);
  const workspace = toHex(palette['--color-whiteboard-gray'] as string);

  it('reicht als Text nicht aus, daher gibt es ein dunkleres Token für Links', () => {
    // Gemessen: 3,77 : 1 auf Eggshell Canvas und 3,30 : 1 auf Whiteboard Gray.
    expect(contrast(blue, canvas)).toBeLessThan(4.5);
    expect(contrast(blue, workspace)).toBeLessThan(4.5);
    expect(contrast(blue, workspace)).toBeGreaterThanOrEqual(3);
  });

  it('das Link-Token erreicht im ungünstigsten Fall mindestens 5 : 1', () => {
    const link = toHex(palette['--color-link-text'] as string);
    expect(contrast(link, workspace)).toBeGreaterThanOrEqual(5);
  });
});

/** Fachfarben: Wert je Nummer, hell und dunkel. */
function subjectColors(opener: (n: number) => string): string[] {
  return Array.from({ length: 8 }, (_, n) => toHex(block(css, opener(n))['--subj'] as string));
}
const subjectsLight = subjectColors((n) => `[data-subj='${n}'] {`);
const subjectsDark = subjectColors((n) => `:root[data-theme='dark'] [data-subj='${n}'] {`);
const subjectsDarkAuto = subjectColors(
  (n) => `:root:not([data-theme='light']) [data-subj='${n}'] {`,
);

describe('Fachfarben (D-043)', () => {
  it('es gibt acht, und im automatischen Dunkelmodus dieselben wie im festen', () => {
    expect(subjectsLight).toHaveLength(8);
    expect(new Set(subjectsLight).size).toBe(8);
    expect(subjectsDarkAuto).toEqual(subjectsDark);
  });

  it.each([
    ['hell', subjectsLight, '--sheet', light],
    ['dunkel', subjectsDark, '--sheet', { ...light, ...dark }],
  ])(
    'heben sich im %s Modus als Linie oder Fläche mit mindestens 3 : 1 vom Blatt ab',
    (_n, colors, surface, tokens) => {
      for (const color of colors) {
        expect(contrast(color, toHex(tokens[surface] as string, tokens))).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
