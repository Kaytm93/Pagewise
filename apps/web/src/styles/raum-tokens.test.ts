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

describe('Raum: Blatt (--raum-raised) und Text darauf', () => {
  // Das Blatt ist --raum-raised (tokens.css). --page-hi entfällt: die Karte der Jetzt-Zeit liegt auf dem Blatt.
  it('ist im Dunkeln heller als der Raumton (--raum-canvas)', () => {
    const scope = { ...light, ...dark };
    expect(luminance(toHex(dark['--raum-raised'] as string, scope))).toBeGreaterThan(
      luminance(toHex(dark['--raum-canvas'] as string, scope)),
    );
  });

  it('gibt es in raum.css keinen --page-hi-Ersatz mehr', () => {
    expect(raum).not.toMatch(/--page-hi/);
  });

  for (const [name, surface, scope] of [
    ['hellen', light['--raum-raised'], light],
    ['dunklen', dark['--raum-raised'], { ...light, ...dark }],
  ] as const) {
    for (const text of ['--ink', '--ink-secondary', '--ink-muted', '--link']) {
      it(`${text} auf --raum-raised erreicht im ${name}en Modus 4,5 : 1`, () => {
        expect(
          contrast(toHex(scope[text] as string, scope), toHex(surface as string, scope)),
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
  // Der Stock der Demo (22 Punkte, Anteile in %), vor der Spiegelung an der senkrechten Achse.
  const demo = [
    [46.9, -1.9],
    [73.8, -1.9],
    [65.7, 45],
    [34.9, 45],
    [46.9, -1.9],
    [76.2, -1.9],
    [103.1, -1.9],
    [99.4, 45],
    [68.6, 45],
    [76.2, -1.9],
    [67.9, 49.3],
    [99, 49.3],
    [95.3, 96.2],
    [60.2, 96.2],
    [67.9, 49.3],
    [33.8, 49.3],
    [65, 49.3],
    [57, 96.2],
    [21.9, 96.2],
    [33.8, 49.3],
    [67.9, 49.3],
    [76.2, -1.9],
  ] as const;

  const points = () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-app::after");
    const polygon = /clip-path:\s*polygon\(([^)]*)\)/.exec(body);
    expect(polygon).not.toBeNull();
    return (polygon?.[1] ?? '').split(',').map((point) =>
      point
        .trim()
        .split(/\s+/)
        .map((part) => Number.parseFloat(part)),
    );
  };

  it('zeichnet vier Scheiben in einem Zug (clip-path), die Stege bleiben frei', () => {
    // 4 Scheiben je 4 Ecken + Rückkehr zur ersten + 2 Brückenpunkte zurück
    expect(points()).toHaveLength(22);
  });

  it('ist die Demo an der senkrechten Achse gespiegelt (jedes x wird 100 % − x)', () => {
    const mirrored = points();
    demo.forEach(([x, y], index) => {
      expect(mirrored[index]?.[0]).toBeCloseTo(100 - (x as number), 5);
      expect(mirrored[index]?.[1]).toBeCloseTo(y as number, 5);
    });
  });

  it('sitzt oben links: left 0, right auto, top 0 (Lichtrichtung wie die Schatten)', () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-app::after");
    expect(body).toMatch(/\btop:\s*0;/);
    expect(body).toMatch(/\bleft:\s*0;/);
    expect(body).toMatch(/\bright:\s*auto;/);
  });

  it('nimmt das Licht mit einer Maske weich auf (mask-image, linear und radial verschnitten)', () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-app::after");
    expect(body).toContain('mask-image:');
    expect(body).toMatch(/radial-gradient\(/);
    expect(body).toMatch(/mask-composite: intersect/);
  });

  it('nutzt keinen filter (im Dunkeln wirkt ein Weichzeichner grau, die Maske reicht)', () => {
    expect(rule(raum, ":root[data-design='raum'] .lg-app::after")).not.toMatch(/\bfilter:/);
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

describe('Raum: Ordnerrücken entfallen', () => {
  it('hat keine Tokens mehr für Rücken, Heftung und Dunkelmischung', () => {
    expect(raum).not.toMatch(/--cover-|--heft-shadow|--desk-[ab]\b|--edge-[123]\b/);
  });

  it('blendet die Ebenen des Stapels (Rücken, Papierkanten) aus', () => {
    expect(rule(raum, ":root[data-design='raum'] .lg-ply")).toContain('display: none');
  });
});

describe('Raum: Innenabstand von #main (S-02 b)', () => {
  it('hält links und rechts Luft und setzt am Stapel keinen waagerechten Rand', () => {
    expect(rule(raum, ":root[data-design='raum'] #main")).toContain(
      'padding-left: max(20px, env(safe-area-inset-left))',
    );
    expect(raum).toMatch(/:root\[data-design='raum'\] #main\s*\{[^}]*padding-left: 26px/);
    // Der waagerechte Rand am Stapel wird nicht gesetzt: mx-auto (utilities) überstimmt ihn doch.
    expect(rule(raum, ":root[data-design='raum'] .lg-stack")).not.toMatch(
      /margin(-inline|-left|-right)?:/,
    );
  });
});

describe('Raum: Blatt im Stapel (S-02 a, c)', () => {
  const sheet = rule(raum, ":root[data-design='raum'] .lg-stack .lg-sheet");

  it('ist `overflow: clip`, damit position: sticky am Fenster klebt', () => {
    expect(sheet).toContain('overflow: clip');
    // Keine Regel für ein Blatt darf `overflow: hidden` setzen (Karten wie .rm-plan-card dürfen es).
    for (const match of raum.matchAll(/([^{}]*\.lg-sheet[^{}]*)\{([^}]*)\}/g)) {
      expect(match[2], `overflow: hidden in ${match[1]?.trim()}`).not.toMatch(/overflow:\s*hidden/);
    }
  });

  it('legt auf das Blatt keine Pseudo-Elemente, die über dem Inhalt liegen', () => {
    expect(raum).not.toMatch(/\.lg-sheet::(before|after)/);
  });

  it('gibt der Anmeldung eine gehobene Karte ohne Körnung und ohne Randlinie (S-02 d, Freigabe 1)', () => {
    // Körnung liegt nur auf dem Raumton (.lg-app::before). Die Karte ist eine Fläche mit Licht und Schatten.
    const card = rule(raum, ":root[data-design='raum'] .lg-sheet");
    expect(card).toContain('border: 0');
    expect(card).toContain('border-radius: var(--raum-r-big)');
    expect(card).toContain('box-shadow: var(--raum-up-l)');
    expect(card).not.toContain('--grain');
    expect(raum).toMatch(/--raum-r-big:\s*20px/);
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
    // Das Blatt ist der Container „blatt“. Ohne diese Regel fragt die Spalten-Abfrage nichts ab, und die Startseite bleibt einspaltig.
    expect(raum).toMatch(
      /:root\[data-design='raum'\] \.lg-sheet:has\(\.rm-start\)\s*\{[^}]*container-type: inline-size[^}]*container-name: blatt/,
    );
    expect(raum).toMatch(
      /@container blatt \(min-width: 760px\)\s*\{\s*\.rm-start-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1\.02fr\) minmax\(0, 0\.98fr\)/,
    );
  });

  it('hat keine Tintenlinie unter dem Fachtitel mehr (Freigabe 3)', () => {
    expect(raum).not.toMatch(/h1\[lang='de'\]/);
  });
});

describe('Raum: Fachmotiv (Medaille)', () => {
  it('hat keinen Innenabstand in Prozent (der bezieht sich auf die Breite des Containers)', () => {
    expect(rule(raum, ":root[data-design='raum'] .lg-motif")).not.toMatch(/padding:[^;]*%/);
  });

  it('misst 104 px mit 21 px Innenabstand am Blatt und 84 px mit 17 px auf dem Telefon', () => {
    expect(raum).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*:root\[data-design='raum'\] \.lg-motif\s*\{\s*width: 104px;\s*height: 104px;\s*padding: 21px;/,
    );
    expect(raum).toMatch(
      /@media \(max-width: 767\.98px\)\s*\{\s*:root\[data-design='raum'\] \.lg-motif\s*\{\s*width: 84px;\s*height: 84px;\s*padding: 17px;/,
    );
  });
});

describe('Raum: Strichstärke des Fachsymbols und Kopfzeile auf dem Telefon', () => {
  it('setzt die Strichstärke des Fachsymbols auf 0,8 (schlägt das Attribut strokeWidth 0,4)', () => {
    expect(rule(raum, ":root[data-design='raum'] .lg-motif")).toContain('stroke-width: 0.8');
  });

  it('gibt der Telefon-Kopfzeile den Raumton, ohne Rand und ohne Schatten (überstimmt bg-desk)', () => {
    const body = rule(raum, ":root[data-design='raum'] .lg-app header.md\\:hidden");
    expect(body).toContain('background-color: var(--raum-canvas)');
    expect(body).toContain('border: 0');
    expect(body).toContain('box-shadow: none');
  });
});

describe('Raum: Listen und Trennlinien', () => {
  it('macht eine Liste aus Zeilen zur Mulde mit 56 px hohen Zeilen', () => {
    expect(rule(raum, ":root[data-design='raum'] ul:has(> li > .lg-row)")).toContain(
      'box-shadow: var(--raum-in-m)',
    );
    expect(rule(raum, ":root[data-design='raum'] .lg-row")).toContain('min-height: 56px');
  });

  it('verschachtelt kein :has in :has (ungültig: der Browser verwürfe die ganze Regel)', () => {
    // Jede Auswahl (bis zur geschweiften Klammer) enthält höchstens ein :has(.
    for (const prelude of raum.split('{').map((part) => part.split(/[}]/).pop() ?? '')) {
      expect(prelude, prelude).not.toMatch(/:has\([^;,]*:has\(/);
    }
  });

  it('zeichnet die Trennlinie mit harten Stopps: 1 px dunkel, 1 px hell, zusammen 2 px', () => {
    const divider = rule(
      raum,
      ":root[data-design='raum'] :is(li + li > .lg-row, .lg-row + .lg-row)::before",
    );
    expect(divider).toContain('height: 2px');
    expect(divider).toContain('linear-gradient(var(--raum-dark) 1px, var(--raum-light) 1px)');
    // Dock und Chat-Eingabe tragen dieselbe Linie; keine zwei Verläufe mehr übereinander.
    expect(
      raum.match(/linear-gradient\(var\(--raum-dark\) 1px, var\(--raum-light\) 1px\)/g),
    ).toHaveLength(2);
    expect(raum).not.toMatch(/top \/ 100% 1px/);
  });

  it('macht den Bearbeiten-Knopf neben einer Zeile rund, die Zeile selbst nicht', () => {
    expect(raum).toMatch(
      /:root\[data-design='raum'\] li:has\(> \.lg-row\) > button:not\(\.lg-row\)\s*\{[^}]*border-radius: 50%/,
    );
  });
});
