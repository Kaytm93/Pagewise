import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Fensterlicht in „Raum“ (M4-T018): Das Lichtfeld (.lg-app::after) soll dem Zeiger folgen
 * und die Fachfarbe aufnehmen. Zwei Ursachen waren gemessen (~/pagewise-agent/befunde/static-css.json
 * #02/#03): Registrierte Variablen mit `inherits: false` vererben nicht ins Pseudo-Element,
 * und `--win` auf :root löste var(--subj) zum neutralen Ton der Wurzel auf, nicht zur Fachfarbe
 * auf .lg-app[data-subj]. Dieser Test nagelt die Struktur des Fixes fest; die Wirkung
 * (berechneter ::after-Stil ändert sich mit der Maus, Fachfarbe im Licht) ist im Echtbrowser
 * gemessen (Chromium und WebKit, siehe ~/pagewise-agent/logs/bericht-m4-t018.md).
 *
 * Ab D-073 (Licht und Schatten statt Rahmen) prüfen die Abschnitte unten zusätzlich: keine Umrandung an
 * Bedienelementen, vier Schichten je Schattenliste, Hover nur mit echter Maus, Körnung nur auf dem Raumton,
 * keine Reste der alten Reiter und Ringe.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'raum.css'), 'utf8')
  .replaceAll('"', "'")
  .replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { selector: string; medias: string[]; body: string };

/**
 * Stilregeln mit ihrem Selektor, den umschließenden @media-Bedingungen und dem Rumpf. @keyframes und @property
 * werden übersprungen; @layer und @container sind nur Hüllen und zählen nicht als Bedingung.
 */
function rules(source: string, medias: string[] = []): Rule[] {
  const out: Rule[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const prelude = source.slice(index, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
      end++;
    }
    const inner = source.slice(open + 1, end - 1);
    if (!prelude.startsWith('@')) {
      out.push({ selector: prelude, medias, body: inner });
    } else if (prelude.startsWith('@media')) {
      out.push(...rules(inner, [...medias, prelude]));
    } else if (prelude.startsWith('@layer') || prelude.startsWith('@container')) {
      out.push(...rules(inner, medias));
    }
    index = end;
  }
  return out;
}

/** Deklarationen eines Rumpfes als Tabelle (--name -> Wert). */
function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1] as string] = (match[2] as string).replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** Anzahl der Schichten einer Schattenliste (Kommas auf oberster Ebene, `var(--raum-rim)` ausgeklappt). */
function layers(value: string, rim: string): number {
  const expanded = value.replaceAll('var(--raum-rim)', rim);
  let depth = 0;
  let count = 1;
  for (const char of expanded) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) count++;
  }
  return count;
}

const all = rules(css);
const rootTokens = declarationsOf(
  all.find((rule) => rule.selector === ":root[data-design='raum']")?.body ?? '',
);

describe('raum.css: Fensterlicht folgt der Maus (M4-T018)', () => {
  it('registriert --px und --py mit inherits: true, damit .lg-app::after sie erbt', () => {
    for (const name of ['--px', '--py']) {
      const match = new RegExp(`@property\\s+${name}\\s*\\{([^}]*)\\}`).exec(css);
      expect(match, `@property ${name} fehlt`).not.toBeNull();
      expect(match?.[1]).toMatch(/inherits:\s*true\b/);
      expect(match?.[1]).toMatch(/initial-value:\s*0\b/);
    }
  });
});

describe('raum.css: Fensterlicht trägt die Fachfarbe (M4-T018, D-073)', () => {
  // Die Fachfarbe mischt sich in das Fensterlicht („--raum-pane“), die Deckkraft kommt aus „--raum-pane-a“.
  // Nach dem Zeilenumbruch-Ausgleich: ein Leerzeichen zwischen Argumenten, keines nach „(“ oder vor „)“.
  const winDeclaration =
    /--win: color-mix\(in srgb, color-mix\(in srgb, var\(--subj\) 20%, var\(--raum-pane\)\) calc\(var\(--raum-pane-a\) \* 100%\), transparent\)/;
  const flat = (text: string) =>
    text.replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')');

  it('definiert --win an .lg-app, nicht an der Wurzel', () => {
    // Block der Wurzel (erste :root[data-design='raum']-Regel): dort darf --win nicht stehen,
    // denn var(--subj) würde dort zum neutralen Ton der Wurzel aufgelöst.
    const rootStart = css.indexOf(":root[data-design='raum'] {");
    expect(rootStart).toBeGreaterThanOrEqual(0);
    const rootEnd = css.indexOf('}', rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    expect(flat(rootBlock)).not.toMatch(winDeclaration);

    // .lg-app-Regel mit der Definition (Muster: --glow in lagen.css).
    const appRule = /[^{}]*\.lg-app[^{}]*\{[^}]*\}/.exec(css);
    expect(appRule, 'keine .lg-app-Regel gefunden').not.toBeNull();
    expect(flat(appRule?.[0] ?? '')).toMatch(winDeclaration);
    expect(appRule?.[0]).toMatch(/:root\[data-design='raum'\]\s+\.lg-app/);
  });
});

describe('raum.css: keine Umrandung an Bedienelementen (Freigabe 1)', () => {
  const outsideContrast = all.filter(
    (rule) => !rule.medias.some((media) => media.includes('prefers-contrast')),
  );

  it('setzt --raum-edge nie als Rand (border, border-color) außerhalb von „Mehr Kontrast“', () => {
    for (const rule of outsideContrast) {
      expect(rule.body, `Rand mit --raum-edge in ${rule.selector}`).not.toMatch(
        /border(-color|-(top|right|bottom|left))?:[^;]*--raum-edge/,
      );
    }
  });

  it('hat das Textfeld der Startseite und des Chats die Bodenlinie in --raum-edge (2 px)', () => {
    const startField = all.find(
      (rule) => rule.selector === ":root[data-design='raum'] .rm-start-dock form > div",
    );
    const chatField = all.find(
      (rule) => rule.selector === ":root[data-design='raum'] .lg-composer textarea",
    );
    expect(startField?.body).toContain('inset 0 -2px 0 0 var(--raum-edge)');
    expect(chatField?.body).toContain('inset 0 -2px 0 0 var(--raum-edge)');
  });

  it('kehrt bei „Mehr Kontrast“ die 1 px Umrandung an den Bedienelementen zurück', () => {
    const contrast = all.filter((rule) =>
      rule.medias.some((media) => media.includes('prefers-contrast: more')),
    );
    const outline = contrast.find((rule) =>
      rule.body.includes('outline: 1px solid var(--raum-edge)'),
    );
    expect(outline, 'keine 1 px Umrandung bei „Mehr Kontrast“').toBeDefined();
    expect(outline?.body).toContain('outline-offset: -1px');
    expect(outline?.selector).toContain('.lg-nav-item');
    expect(outline?.selector).toContain('.lg-row');
    expect(outline?.selector).toContain("[role='tablist']");
  });
});

describe('raum.css: Schatten haben vier Schichten in fester Reihenfolge (D-073)', () => {
  const rim = rootTokens['--raum-rim'] ?? '';

  it('hat --raum-rim zwei Kanten (hell und dunkel innen)', () => {
    expect(layers(rim, '')).toBe(2);
  });

  for (const name of [
    '--raum-up-s',
    '--raum-up-m',
    '--raum-up-l',
    '--raum-in-s',
    '--raum-in-m',
    '--raum-flat',
  ]) {
    it(`${name} hat genau vier Schichten`, () => {
      expect(rootTokens[name], `${name} fehlt`).toBeDefined();
      expect(layers(rootTokens[name] ?? '', rim)).toBe(4);
    });
  }

  it('hat gehoben außen hell oben links und dunkel unten rechts, eingelassen innen', () => {
    expect(rootTokens['--raum-up-s']).toMatch(/var\(--raum-light\)/);
    expect(rootTokens['--raum-up-s']).toMatch(/var\(--raum-dark\)/);
    expect(rootTokens['--raum-in-s']).toMatch(/^0 0 0 0 transparent, 0 0 0 0 transparent,\s*inset/);
  });

  it('hat die Radien 28, 20 und 16 px (nur diese)', () => {
    expect(rootTokens['--raum-r-plate']).toBe('28px');
    expect(rootTokens['--raum-r-big']).toBe('20px');
    expect(rootTokens['--raum-r-small']).toBe('16px');
  });
});

describe('raum.css: Hover nur mit echter Maus (D-058, Freigabe Konzept)', () => {
  it('steht jede Regel mit :hover in @media (hover: hover)', () => {
    const hovers = all.filter((rule) => rule.selector.includes(':hover'));
    expect(hovers.length).toBeGreaterThan(0);
    for (const rule of hovers) {
      expect(rule.medias, `außerhalb von @media (hover: hover): ${rule.selector}`).toContain(
        '@media (hover: hover)',
      );
    }
  });
});

describe('raum.css: Körnung nur auf dem Raumton (Konzept)', () => {
  it('setzt --grain genau einmal, und zwar in .lg-app::before', () => {
    const users = all.filter((rule) => rule.body.includes('--grain'));
    expect(users).toHaveLength(1);
    expect(users[0]?.selector).toContain('.lg-app::before');
  });
});

describe('raum.css: keine Reste der alten Reiter, Ringe und des Stilattributs', () => {
  it('kennt keine Klassen rm-reg oder rm-rings mehr', () => {
    expect(css).not.toMatch(/rm-reg|rm-rings/);
  });

  it('verwendet kein style-Attribut (CSP, D-023) und kein backdrop-filter (Raum hat kein Glas)', () => {
    expect(css).not.toMatch(/style\s*=/);
    expect(css).not.toMatch(/backdrop-filter/);
  });
});

describe('raum.css: Stapel und Parallaxe bleiben unverändert', () => {
  it('gibt den Ebenen will-change nur, solange die Parallaxe läuft', () => {
    const uses = css.match(/will-change/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(css).toMatch(
      /\.lg-app\[data-parallax\]::before,\s*:root\[data-design='raum'\] \.lg-app\[data-parallax\]::after\s*\{\s*will-change: transform/,
    );
  });
});
