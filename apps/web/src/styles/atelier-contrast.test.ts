import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Kontrast in der Richtung „Atelier“ (WCAG AA): der Fachtext-Ton `--hue-ink`, die Stärke des Fachlichts
 * (`--at-k`) und der Text in Dialogen (S-01). Die Hilfsfunktionen stehen hier noch einmal in klein, damit
 * `tokens.test.ts` unberührt bleibt; gerechnet wird mit den Tokens aus `tokens.css` und `atelier.css`.
 */

const dir = dirname(fileURLToPath(import.meta.url));
// Der Formatter darf Anführungszeichen im CSS ändern, daher vereinheitlichen.
const read = (file: string) => readFileSync(join(dir, file), 'utf8').replaceAll('"', "'");
const tokensCss = read('tokens.css');
const atelierCss = read('atelier.css');
const lagenCss = read('lagen.css');

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

const palette = block(tokensCss, '@theme {');
const light = block(tokensCss, ':root {');
const dark = { ...light, ...block(tokensCss, ":root[data-theme='dark'] {") };

function toHex(value: string, tokens: Tokens = {}): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) {
    const name = reference[1] as string;
    return toHex((tokens[name] ?? palette[name]) as string, tokens);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Kein Hex-Wert: ${value}`);
  return value;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [bright, dim] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((bright as number) + 0.05) / ((dim as number) + 0.05);
}

/** `share` (0 bis 1) von `top` über `base` gelegt, wie `color-mix(in srgb, top share, base)`. */
function over(base: string, top: string, share: number): string {
  const a = channels(base);
  const b = channels(top);
  const mixed = a.map((value, index) =>
    Math.round(value * (1 - share) + (b[index] as number) * share),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Zahlen aus `atelier.css`: Stärke des Lichts je Modus. */
function strength(opener: string): number {
  return Number.parseFloat(block(atelierCss, opener)['--at-k'] as string);
}
const kLight = strength(":root[data-design='atelier'] {");
const kDark = strength(":root[data-design='atelier'][data-theme='dark'] {");
const kDarkAuto = strength(":root[data-design='atelier']:not([data-theme='light']) {");

/**
 * Mitte des Lichtfelds: Fachfarbe × 30 % × --at-k (atelier.css, `calc(30% * var(--at-k))`). Die Mitte ist die
 * stärkste Stelle des Feldes, darum rechnen alle Feldtests mit ihr.
 */
const CENTER = 0.3;

/**
 * Tokens je Modus mit den Atelier-Werten: die Atelier-Blöcke des Modus überschreiben die Basis aus tokens.css.
 * `--ink-muted` und `--link` stehen im Hellen dunkler (Atelier-Root) und in beiden Dunkelblöcken auf dem dunklen Wert.
 */
const lightAtelier = block(atelierCss, ":root[data-design='atelier'] {");
const darkAtelier = block(atelierCss, ":root[data-design='atelier'][data-theme='dark'] {");
const darkAutoAtelier = block(
  atelierCss,
  ":root[data-design='atelier']:not([data-theme='light']) {",
);
const lightA: Tokens = { ...light, ...lightAtelier };
const darkA: Tokens = { ...dark, ...darkAtelier };

/** Fachfarben 0 bis 7 plus das warme Licht ohne Fach (Start, Einstellungen), pro Modus. */
function subjectHex(opener: (n: number) => string, source: string, fallback: string): string[] {
  const colors = Array.from({ length: 8 }, (_, n) =>
    toHex(block(source, opener(n))['--subj'] as string),
  );
  return [...colors, toHex(block(atelierCss, fallback)['--subj'] as string)];
}
const subjectsLight = subjectHex(
  (n) => `[data-subj='${n}'] {`,
  tokensCss,
  ":root[data-design='atelier'] .lg-app:not([data-subj]) {",
);
const subjectsDark = subjectHex(
  (n) => `:root[data-theme='dark'] [data-subj='${n}'] {`,
  tokensCss,
  ":root[data-design='atelier'][data-theme='dark'] .lg-app:not([data-subj]) {",
);

/** Fachtext-Töne `--hue-ink` je Fach, hell, dunkel und im automatischen Dunkelmodus. */
function hueInk(opener: (n: number) => string): string[] {
  return Array.from({ length: 8 }, (_, n) =>
    toHex(block(atelierCss, opener(n))['--hue-ink'] as string),
  );
}
const inkLight = hueInk((n) => `:root[data-design='atelier'] [data-subj='${n}'] {`);
const inkDark = hueInk(
  (n) => `:root[data-design='atelier'][data-theme='dark'] [data-subj='${n}'] {`,
);
const inkDarkAuto = hueInk(
  (n) => `:root[data-design='atelier']:not([data-theme='light']) [data-subj='${n}'] {`,
);

/**
 * Flächen, auf denen Fachtext steht: die vier Grundflächen, das Fachlicht über dem Blatt (Verlauf und Lichtband
 * übereinander, an der stärksten Stelle gerechnet), die getönte Zeile und der Kreis der Seitenleiste.
 */
function grounds(tokens: Tokens, k: number, subjects: string[], cover = 1) {
  const [canvas, surface, paper, workspace] = [
    '--canvas',
    '--surface',
    '--paper',
    '--workspace',
  ].map((name) => toHex(tokens[name] as string, tokens)) as [string, string, string, string];
  const page = [canvas, surface, paper, workspace];
  const glow: string[] = [];
  const tint: string[] = [];
  const icon: string[] = [];
  for (const subject of subjects) {
    // Das Lichtfeld mischt 30 % × k Fachfarbe auf den Grund (atelier.css). Das frühere zweite Lichtband (0,09 k)
    // bleibt als Zuschlag in der Rechnung: CSS malt es nicht mehr, die Rechnung bleibt streng.
    glow.push(over(over(canvas, subject, CENTER * k * cover), subject, 0.09 * k));
    tint.push(
      over(canvas, subject, 0.07),
      over(canvas, subject, 0.11),
      over(surface, subject, 0.14),
    );
    icon.push(over(paper, subject, 0.2), over(workspace, subject, 0.2));
  }
  // `text`: alles, worauf Fachtext (Name, Zahl, Marke) stehen kann; `body`: Fließtext liegt nur auf Seite und Licht.
  return { text: [...page, ...glow, ...tint], body: [...page, ...glow], icon };
}

const worst = (color: string, surfaces: string[]) =>
  Math.min(...surfaces.map((surface) => contrast(color, surface)));

describe('Fachtext-Ton --hue-ink (D-045, Atelier)', () => {
  it('es gibt acht, und im automatischen Dunkelmodus dieselben wie im festen', () => {
    expect(inkLight).toHaveLength(8);
    expect(new Set(inkLight).size).toBe(8);
    expect(new Set(inkDark).size).toBe(8);
    expect(inkDarkAuto).toEqual(inkDark);
  });

  it.each([
    ['hell', inkLight, { ...light }, subjectsLight, kLight],
    ['dunkel', inkDark, dark, subjectsDark, kDark],
  ])(
    'erreicht im %s Modus als Text auf allen Flächen mindestens 5 : 1 und als Symbol auf dem Kreis 4,5 : 1',
    (_name, colors, tokens, subjects, k) => {
      const { text, icon } = grounds(tokens, k, subjects);
      for (const color of colors) {
        expect(worst(color, text)).toBeGreaterThanOrEqual(5);
        expect(worst(color, icon)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('ist die Fachfarbe selbst abgewandelt (gleicher Farbton, nicht die Flächenfarbe)', () => {
    // Die Fachfarbe `--subj` erreicht als Text keine 4,5 : 1: darum gibt es den eigenen Ton.
    const canvas = toHex(light['--canvas'] as string);
    expect(
      Math.min(...subjectsLight.slice(0, 8).map((color) => contrast(color, canvas))),
    ).toBeLessThan(4.5);
    inkLight.forEach((color, n) => {
      expect(color).not.toBe(subjectsLight[n]);
    });
  });

  it('ohne Fach gilt die ruhige Tinte', () => {
    expect(block(atelierCss, ":root[data-design='atelier'] {")['--hue-ink']).toBe(
      'var(--ink-secondary)',
    );
  });
});

describe('Stärke des Fachlichts (--at-k)', () => {
  it('dunkel ist schwächer als hell, der automatische Dunkelmodus gleich dem festen', () => {
    expect(kLight).toBeGreaterThan(0);
    expect(kDark).toBeLessThan(kLight);
    expect(kDarkAuto).toBe(kDark);
  });

  // Die Spitze des Verlaufs liegt über dem sichtbaren Rand (Mittelpunkt bei −6 % Höhe); an Text, der unterhalb
  // der Seitenkante steht, kommt höchstens etwa 70 % davon an. Das Lichtband wird voll gerechnet.
  it('dunkel: Text bleibt auch unter dem Licht (Verlauf zu 70 %, Band voll) über 4,5 : 1', () => {
    const { body } = grounds(darkA, kDark, subjectsDark, 0.7);
    for (const name of ['--ink', '--ink-secondary', '--ink-muted', '--link', '--danger']) {
      expect(worst(toHex(darkA[name] as string, darkA), body)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // M4-T033 hat die dunkelste reale Fläche unter grauem Text im Browser gemessen: bei 22 % Fachlicht
  // rgb(235, 226, 212). Hell wächst die Fläche mit 30 % × --at-k; die gemessene Fläche wird im selben
  // Verhältnis zum Blatt hin verschoben (die Spitze des Lichts liegt über dem sichtbaren Rand).
  it('hell: Sekundär- und Fehlertext bleiben auf der skalierten Messfläche über 4,5 : 1', () => {
    const canvas = toHex(light['--canvas'] as string);
    const scale = (CENTER * kLight) / 0.22;
    const measured = channels('#ebe2d4');
    const base = channels(canvas);
    const ground = `#${measured
      .map((value, index) =>
        Math.round((base[index] as number) + (value - (base[index] as number)) * scale)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    for (const name of ['--ink', '--ink-secondary', '--ink-muted', '--danger']) {
      expect(contrast(toHex(lightA[name] as string, lightA), ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('Dialoge in Atelier (S-01)', () => {
  const dialogCss = (source: string) =>
    [
      ...source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/([^{}]*\.lg-dialog\b[^{}]*)\{([^}]*)\}/g),
    ].map((match) => ({
      selector: (match[1] as string).trim(),
      body: match[2] as string,
    }));

  it('lagen.css malt den Dialog deckend auf --sheet', () => {
    const rule = dialogCss(lagenCss).find((entry) => entry.selector === '.lg-dialog');
    expect(rule?.body).toMatch(/background-color:\s*var\(--sheet\)/);
  });

  it('atelier.css legt das Dialogblatt auf Glas (--glass-fill); ohne Glas bleiben 94 % --canvas', () => {
    expect(atelierCss).toMatch(/\.lg-dialog[^{]*\{[^}]*background-color:\s*var\(--glass-fill\)/);
    expect(atelierCss).toMatch(/color-mix\(in srgb, var\(--canvas\) 94%, transparent\)/);
  });

  it('der Dialog benutzt lg-dialog, nicht das (in Atelier durchsichtige) lg-sheet', () => {
    const modal = readFileSync(join(dir, '..', 'ui', 'modal.tsx'), 'utf8');
    expect(modal).toMatch(/lg-dialog/);
    expect(modal).not.toMatch(/lg-sheet/);
    expect(atelierCss).toMatch(/\.lg-sheet\s*\{[^}]*background-color:\s*transparent/);
  });

  it.each([
    ['hell', light],
    ['dunkel', dark],
  ])(
    'Text im Dialog (Warnhinweis „Überschneidung“, „optional“, Fehler) hat im %s Modus mindestens 4,5 : 1 auf --sheet',
    (_name, tokens) => {
      const sheet = toHex(tokens['--sheet'] as string, tokens);
      // Warnhinweis im Stunden-Dialog: text-ink-secondary; „optional“ und Hilfstexte: text-ink-muted.
      for (const name of ['--ink', '--ink-secondary', '--ink-muted', '--danger', '--link']) {
        expect(contrast(toHex(tokens[name] as string, tokens), sheet)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

/** Glas-Token `rgb(…)` oder `rgba(…)`: Kanäle 0 bis 255, Deckung als Zahl oder Prozent. */
function glassToken(value: string): { rgb: number[]; alpha: number } {
  const match = /^rgba?\((.+)\)$/.exec(value.trim());
  if (!match) throw new Error(`Kein rgb-Wert: ${value}`);
  const [r, g, b, a = '1'] = (match[1] as string).split(/[\s,/]+/).filter(Boolean) as string[];
  const alpha = a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
  return { rgb: [Number(r), Number(g), Number(b)], alpha };
}

/** Die Glasfläche mit ihrer Deckung über `base` gelegt, als Hex. */
function onGlass(glass: { rgb: number[]; alpha: number }, base: string): string {
  const under = channels(base);
  const mixed = glass.rgb.map((value, index) =>
    Math.round(value * glass.alpha + (under[index] as number) * (1 - glass.alpha)),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

describe('Glas (D1): Text auf Glas über dem Lichtfeld', () => {
  // Unter dem Glas liegt das Lichtfeld an seiner Spitze: Fachfarbe × 30 % × k auf dem Grund, für jede Fachfarbe und
  // den warmen Ton ohne Fach. Geprüft wird jede Fläche, nicht nur die hellste: Dunkle Schrift leidet auf der
  // dunkelsten, helle Schrift auf der hellsten Stelle, und im Hellen wie im Dunklen liegt die Schwäche je nach
  // Fachfarbe auf einer anderen Seite. Die Glasdeckung steht fest (46 % hell, 52 % dunkel).
  it.each([
    ['hell', lightA, subjectsLight, 0.46, kLight],
    ['dunkel', darkA, subjectsDark, 0.52, kDark],
  ])(
    'Text auf Glas im %s Modus erreicht auf jeder Fläche mindestens 4,5 : 1 (--ink, --ink-secondary, --ink-muted, --link, --danger)',
    (_name, tokens, subjects, deckung, k) => {
      const glass = glassToken(tokens['--glass-fill'] as string);
      expect(glass.alpha).toBeCloseTo(deckung, 2);
      const canvas = toHex(tokens['--canvas'] as string, tokens);
      const surfaces = subjects.map((subject) => onGlass(glass, over(canvas, subject, CENTER * k)));
      for (const name of ['--ink', '--ink-secondary', '--ink-muted', '--link', '--danger']) {
        const color = toHex(tokens[name] as string, tokens);
        for (const surface of surfaces) {
          expect(contrast(color, surface), `${name} auf Glas`).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});

// Text auf dem Lichtfeld selbst (kein Glas): die stärkste Stelle ist die Mitte des Feldes, 30 % × --at-k. Gemessen
// wird im Browser das 20-Prozent-Perzentil der Pixel unter jeder Textzeile. Die Formel hier rechnet ohne Körnung
// und liegt darum auf der sicheren Seite; sie fängt auf, wenn jemand das Feld wieder stärker macht oder einen
// Atelier-Textton wieder heller stellt. Im Hellen steht --ink-muted auf 4,66 : 1, --link auf 4,62 : 1 (gerundet abwärts).
describe('Text auf dem Feld (ohne Glas)', () => {
  it.each([
    ['hell', lightA, subjectsLight, kLight],
    ['dunkel', darkA, subjectsDark, kDark],
  ])(
    '--ink, --ink-secondary, --ink-muted und --link erreichen im %s Modus auf der Mitte des Feldes 4,5 : 1',
    (_name, tokens, subjects, k) => {
      const canvas = toHex(tokens['--canvas'] as string, tokens);
      for (const name of ['--ink', '--ink-secondary', '--ink-muted', '--link']) {
        const color = toHex(tokens[name] as string, tokens);
        for (const subject of subjects) {
          expect(
            contrast(color, over(canvas, subject, CENTER * k)),
            `${name} auf dem Feld`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  // Ohne diese Zeilen käme im Dunkelmodus der helle Atelier-Wert an (gleiche Spezifität wie tokens.css,
  // die Reihenfolge entschiede). Jeder Dunkelblock muss die beiden Töne selbst setzen.
  it.each([
    ['[data-theme=dark]', darkAtelier],
    ['prefers-color-scheme: dark', darkAutoAtelier],
  ])('der Dunkelblock (%s) setzt --ink-muted und --link selbst', (_name, block) => {
    expect(block['--ink-muted']).toBeDefined();
    expect(block['--link']).toBeDefined();
  });

  it('die Atelier-Werte im Hellen liegen dunkler als die Basis, und nur dort', () => {
    expect(toHex(lightA['--ink-muted'] as string, lightA)).not.toBe(
      toHex(light['--ink-muted'] as string, light),
    );
    expect(toHex(lightA['--link'] as string, lightA)).not.toBe(
      toHex(light['--link'] as string, light),
    );
    expect(toHex(darkA['--ink-muted'] as string, darkA)).toBe(
      toHex(dark['--ink-muted'] as string, dark),
    );
    expect(toHex(darkA['--link'] as string, darkA)).toBe(toHex(dark['--link'] as string, dark));
  });
});
