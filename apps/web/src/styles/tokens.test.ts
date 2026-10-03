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

function toHex(value: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) return toHex(palette[reference[1] as string] as string);
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

const surfaces = ['--canvas', '--surface', '--paper', '--workspace'];
const texts = ['--ink', '--ink-secondary', '--ink-muted', '--link'];

describe.each([
  ['hell', light],
  ['dunkel', { ...light, ...dark }],
])('Kontrast im %s Modus (WCAG AA)', (_name, tokens) => {
  const color = (token: string) => toHex(tokens[token] as string);

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

  it('Akzent und primäre Fläche heben sich als Bedienelemente mit mindestens 3 : 1 ab', () => {
    for (const surface of ['--canvas', '--workspace']) {
      expect(contrast(color('--accent'), color(surface))).toBeGreaterThanOrEqual(3);
      expect(contrast(color('--primary'), color(surface))).toBeGreaterThanOrEqual(3);
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
