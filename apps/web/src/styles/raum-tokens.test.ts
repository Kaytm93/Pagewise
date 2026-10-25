import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Raum: Tokens und Hüllenfehler (S-02). Die Wirkung im Browser (Maße bei 320/375/390 px, WebKit-Blattwechsel)
 * misst ein Echtbrowser-Lauf; hier stehen die Ursachen im CSS fest, damit sie nicht zurückkehren.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  readFileSync(join(dir, name), 'utf8')
    .replaceAll('"', "'")
    .replace(/\/\*[\s\S]*?\*\//g, '');
const raum = read('raum.css');
const tokens = read('tokens.css');

type Tokens = Record<string, string>;

function declarations(source: string, opener: string): Tokens {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`Block nicht gefunden: ${opener}`);
  const end = source.indexOf('}', start);
  const out: Tokens = {};
  for (const match of source
    .slice(start + opener.length, end)
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1] as string] = (match[2] as string).trim();
  }
  return out;
}

const palette = declarations(tokens, '@theme {');
const light = declarations(tokens, ':root {');
const dark = declarations(tokens, ":root[data-theme='dark'] {");

function toHex(value: string, scope: Tokens): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference)
    return toHex(
      (scope[reference[1] as string] ?? palette[reference[1] as string]) as string,
      scope,
    );
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

function contrast(a: string, b: string): number {
  const [bright, dim] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((bright as number) + 0.05) / ((dim as number) + 0.05);
}

/** Rumpf der ersten Regel, die genau mit `selector {` beginnt. */
function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `Regel fehlt: ${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start));
}

describe('Raum: hellere Fläche der „Jetzt“-Karte (--page-hi)', () => {
  const lightRaum = declarations(raum, ":root[data-design='raum'] {");
  const darkRaum = declarations(raum, ":root[data-design='raum'][data-theme='dark'] {");
  const darkAutoRaum = declarations(raum, ":root[data-design='raum']:not([data-theme='light']) {");

  it('ist im Dunkeln heller als --surface, wie im Mockup (#2a2a28)', () => {
    expect(darkRaum['--page-hi']).toBe('#2a2a28');
    expect(darkAutoRaum['--page-hi']).toBe('#2a2a28');
    const surface = toHex(dark['--surface'] as string, { ...light, ...dark });
    expect(luminance(darkRaum['--page-hi'] as string)).toBeGreaterThan(luminance(surface));
  });

  for (const [name, page, scope] of [
    ['hell', lightRaum['--page-hi'], light],
    ['dunkel', darkRaum['--page-hi'], { ...light, ...dark }],
  ] as const) {
    for (const text of ['--ink', '--ink-secondary', '--ink-muted', '--link']) {
      it(`${text} auf --page-hi erreicht im ${name}en Modus 4,5 : 1`, () => {
        expect(
          contrast(toHex(scope[text] as string, scope), page as string),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('Raum: Schatten wie im Mockup, nur in Raum', () => {
  it('überschreibt Tönung und Stärke im hellen Modus, nicht in tokens.css', () => {
    const lightRaum = declarations(raum, ":root[data-design='raum'] {");
    expect(lightRaum['--shadow']).toBe('60, 40, 15');
    expect(lightRaum['--shadow-a']).toBe('0.22');
    expect(light['--shadow']).toBe('70, 50, 20');
    expect(light['--shadow-a']).toBe('0.14');
  });

  it('stellt im Dunkeln (Auswahl und System) die Werte aus tokens.css wieder her', () => {
    for (const opener of [
      ":root[data-design='raum'][data-theme='dark'] {",
      ":root[data-design='raum']:not([data-theme='light']) {",
    ]) {
      const block = declarations(raum, opener);
      expect(block['--shadow']).toBe('0, 0, 0');
      expect(block['--shadow-a']).toBe('0.5');
    }
  });
});

describe('Raum: Fensterlicht', () => {
  it('zeichnet vier Scheiben in einem Zug (clip-path), die Stege bleiben frei', () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-app::after");
    const polygon = /clip-path:\s*polygon\(([^)]*)\)/.exec(body);
    expect(polygon).not.toBeNull();
    const points = (polygon?.[1] ?? '').split(',').map((point) => point.trim());
    // 4 Scheiben je 4 Ecken + Rückkehr zur ersten + 2 Brückenpunkte zurück
    expect(points).toHaveLength(22);
  });

  it('läuft nur bei „Voll“ und sichtbarem Tab und steht im Chat still', () => {
    expect(raum).toMatch(
      /\.fx-full:not\(\.tab-hidden\)\[data-design='raum'\] \.lg-app::after\s*\{[^}]*animation: raum-breathe/,
    );
    expect(raum).toMatch(
      /\[data-view='chat'\], \[data-view='default-chat'\]\)::after\s*\{[^}]*animation-play-state: paused/,
    );
    expect(raum).not.toMatch(/\.tab-hidden\[data-design='raum'\] \.lg-app::after/);
  });

  it('atmet über translate und opacity, nie über eine Variable der Parallaxe', () => {
    const keyframes = /@keyframes raum-breathe\s*\{([\s\S]*?)\n\}/.exec(raum)?.[1] ?? '';
    expect(keyframes).toContain('translate:');
    expect(keyframes).not.toContain('--px');
    expect(keyframes).not.toContain('--py');
  });

  it('gibt den Ebenen will-change nur, solange die Parallaxe läuft', () => {
    const uses = raum.match(/will-change/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(raum).toMatch(
      /\.lg-app\[data-parallax\]::before,\s*:root\[data-design='raum'\] \.lg-app\[data-parallax\]::after\s*\{\s*will-change: transform/,
    );
  });
});

describe('Raum: Ordnerrücken', () => {
  it('trägt die Körnung mit .7 und Innenkanten auf einer eigenen Ebene', () => {
    expect(declarations(raum, ":root[data-design='raum'] {")['--cover-grain']).toBe('0.7');
    const body = rule(raum, ":root[data-design='raum'] .lg-stack .lg-p1::after");
    expect(body).toContain('opacity: var(--cover-grain)');
    expect(body).toContain('inset 0 1px 0 var(--cover-rim)');
    expect(body).toContain('inset 0 -2px 0 var(--cover-shade)');
    expect(body).toContain('inset 2px 0 0 var(--cover-lit)');
  });

  it('bekommt links genug Platz im Innenabstand von #main (S-02 b)', () => {
    // Rücken: Handy 14 px, ab md 22 px links vom Stapel; Platz: 20 px beziehungsweise 26 px.
    expect(rule(raum, ":root[data-design='raum'] .lg-stack .lg-p1")).toContain(
      'inset: -6px -6px -8px -14px',
    );
    expect(raum).toContain('inset: -9px -9px -11px -22px');
    expect(rule(raum, ":root[data-design='raum'] #main")).toContain(
      'padding-left: max(20px, env(safe-area-inset-left))',
    );
    expect(raum).toMatch(/:root\[data-design='raum'\] #main\s*\{[^}]*padding-left: 26px/);
    // Der waagerechte Rand am Stapel wird nicht mehr gesetzt: mx-auto (utilities) überstimmt ihn doch.
    expect(rule(raum, ":root[data-design='raum'] .lg-stack")).not.toMatch(
      /margin(-inline|-left|-right)?:/,
    );
  });
});

describe('Raum: Blatt im Ordner (S-02 a, c)', () => {
  const sheet = rule(raum, ":root[data-design='raum'] .lg-stack .lg-sheet");

  it('ist `overflow: clip`, damit position: sticky am Fenster klebt', () => {
    expect(sheet).toContain('overflow: clip');
    // Keine Regel für ein Blatt darf `overflow: hidden` setzen (Karten wie .rm-plan-card dürfen es).
    for (const match of raum.matchAll(/([^{}]*\.lg-sheet[^{}]*)\{([^}]*)\}/g)) {
      expect(match[2], `overflow: hidden in ${match[1]?.trim()}`).not.toMatch(/overflow:\s*hidden/);
    }
  });

  it('zeichnet Heftschatten und Randlinie als Hintergrundebenen, nicht über dem Inhalt', () => {
    expect(raum).not.toMatch(/\.lg-sheet::(before|after)/);
    expect(sheet).toContain('var(--rule-x) 0');
    expect(sheet).toContain('1px 100%');
  });

  it('hält die Randlinie links vom Innenabstand des Blatts', () => {
    // Innenabstand (ui/Sheet.tsx): px-[22px], sm:px-8 (32 px), md: --sheet-edge (52 px).
    const ruleX = (media: string | null) => {
      const source = media ? raum.slice(raum.indexOf(media)) : raum;
      const body = rule(source, ":root[data-design='raum'] .lg-stack .lg-sheet");
      return Number(/--rule-x:\s*(\d+)px/.exec(body)?.[1]);
    };
    expect(ruleX(null)).toBeLessThan(22);
    expect(ruleX('@media (min-width: 640px)')).toBeLessThan(32);
    expect(ruleX('@media (min-width: 768px)')).toBeLessThan(52);
    // Chat: Kopf, Verlauf und Eingabe haben mindestens 16 px
    const chat = /\.lg-stack \.lg-sheet\s*\{\s*--rule-x:\s*(\d+)px/.exec(
      raum.slice(raum.indexOf('[data-view=')),
    );
    expect(Number(chat?.[1])).toBeLessThan(16);
  });

  it('gibt der Anmeldung die Karte ohne Randlinie und Heftschatten (S-02 d)', () => {
    expect(rule(raum, ":root[data-design='raum'] .lg-sheet.lg-sheet-auth")).toContain(
      'background-image: var(--grain)',
    );
    // Eine Karte für sich mit Rand und Schatten, nicht der Ordnerrand
    const card = rule(raum, ":root[data-design='raum'] .lg-sheet");
    expect(card).toContain('border: 1px solid var(--line-warm)');
  });
});

describe('Raum: Blattwechsel ohne Überstand und ohne unsichtbaren Inhalt (S-02 e)', () => {
  const unlayered = raum.slice(raum.indexOf('Regeln ohne @layer') === -1 ? 0 : 0);

  it('überstimmt die Schlüsselbilder aus motion.css für alle Richtungen des Wechsels', () => {
    for (const dir of ['fwd', 'back', 'same']) {
      expect(unlayered).toMatch(
        new RegExp(
          `\\.lg-app \\.lg-arrive\\[data-dir='${dir}'\\]\\s*\\{[^}]*animation: raum-leaf-${dir}`,
        ),
      );
    }
    expect(unlayered).toMatch(
      /:root\[data-design='raum'\] \.lg-arrive\s*\{[^}]*animation: raum-leaf-same/,
    );
  });

  for (const name of ['fwd', 'back', 'same']) {
    it(`raum-leaf-${name}: beginnt sichtbar (Deckkraft ≥ .5), ohne Vergrößerung, Drehung oder Tiefe`, () => {
      const body =
        new RegExp(`@keyframes raum-leaf-${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(raum)?.[1] ?? '';
      const opacity = Number(/opacity:\s*([\d.]+)/.exec(body)?.[1]);
      expect(opacity).toBeGreaterThanOrEqual(0.5);
      expect(opacity).toBeLessThan(1);
      expect(body).not.toMatch(/perspective|translateZ|rotate|translateX/);
      for (const scale of body.matchAll(/scale\(calc\(1 - var\(--m\) \* ([\d.]+)\)\)/g)) {
        expect(Number(scale[1])).toBeGreaterThan(0);
      }
      expect(body).not.toMatch(/scale\(calc\(1 \+/);
    });
  }

  it('nimmt das Easing ohne Überschwingen statt der Feder', () => {
    const rules = raum.match(/animation: raum-leaf-[a-z]+ [^;]+;/g) ?? [];
    expect(rules).toHaveLength(4);
    for (const declaration of rules) {
      expect(declaration).toContain('var(--ease)');
      expect(declaration).not.toContain('--spring');
    }
  });
});

describe('Raum: Startseite und Chat', () => {
  it('klebt die Eingabe der Startseite unten am Fenster', () => {
    const dock = rule(raum, '.rm-start-dock');
    expect(dock).toContain('position: sticky');
    expect(dock).toContain('bottom: var(--kb, 0px)');
  });

  it('teilt die Startseite nach Blattbreite in zwei Spalten', () => {
    expect(raum).toMatch(
      /@container blatt \(min-width: 760px\)\s*\{\s*\.rm-start-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1\.02fr\) minmax\(0, 0\.98fr\)/,
    );
  });

  it('zieht die Tintenlinie unter den Fachtitel nur per ::after', () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-sheet h1[lang='de']::after");
    expect(body).toContain("content: ''");
    expect(body).toContain('var(--subj)');
  });
});
