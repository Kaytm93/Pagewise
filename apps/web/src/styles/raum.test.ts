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

/** Ende von `@layer components { … }`: was dahinter steht, gewinnt gegen Tailwind-Utilities (Schicht `utilities`). */
const layerStart = css.indexOf('@layer components {');
let layerEnd = layerStart;
for (let depth = 0, at = css.indexOf('{', layerStart); at < css.length; at++) {
  if (css[at] === '{') depth++;
  if (css[at] === '}' && --depth === 0) {
    layerEnd = at;
    break;
  }
}

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

describe('raum.css: Schublade hat den Raumton, Seitenleiste bleibt durchsichtig (D-082, B-03)', () => {
  it('macht den Heftrücken nur in der Seitenleiste durchsichtig und ohne Schatten', () => {
    const transparent = all.filter(
      (rule) =>
        rule.selector.includes('.lg-binder') && rule.body.includes('background-color: transparent'),
    );
    expect(transparent.map((rule) => rule.selector)).toEqual([
      ":root[data-design='raum'] .lg-aside .lg-binder",
    ]);
    expect(transparent[0]?.body).toContain('box-shadow: none');
  });

  it('nimmt den Schatten nur in der Seitenleiste weg', () => {
    const shadowless = all.filter(
      (rule) => rule.selector.includes('.lg-binder') && /box-shadow:\s*none/.test(rule.body),
    );
    expect(shadowless.length).toBeGreaterThan(0);
    for (const rule of shadowless) {
      expect(
        rule.selector,
        `Schatten entfernt außerhalb der Seitenleiste: ${rule.selector}`,
      ).toContain('.lg-aside');
    }
  });

  it('gibt der Schublade eine deckende Fläche in --raum-canvas, ohne box-shadow: none', () => {
    const drawer = all.find(
      (rule) => rule.selector === ":root[data-design='raum'] .lg-scrim .lg-binder",
    );
    expect(drawer, 'keine Regel für die Schublade (.lg-scrim .lg-binder)').toBeDefined();
    expect(drawer?.body).toContain('background-color: var(--raum-canvas)');
    expect(drawer?.body).toContain('background-image: none');
    expect(drawer?.body).toMatch(/border:\s*0;/);
    expect(drawer?.body).not.toMatch(/box-shadow/);
    expect(drawer?.body).not.toContain('transparent');
  });

  it('setzt --raum-surf in der Schublade auf den Raumton wie in der Seitenleiste', () => {
    const drawer = all.find(
      (rule) => rule.selector === ":root[data-design='raum'] .lg-scrim .lg-binder",
    );
    expect(drawer?.body).toContain('--raum-surf: var(--raum-canvas);');
  });
});

describe('raum.css: Dialog ist eine gehobene Fläche wie Blatt und Karte (D-088, B-21, GF-01)', () => {
  const dialogSelector = ":root[data-design='raum'] .lg-dialog";
  const footSelector = ":root[data-design='raum'] .lg-dialog-foot";
  const panel = all.find((rule) => rule.selector === dialogSelector && rule.medias.length === 0);
  const panelWide = all.find(
    (rule) => rule.selector === dialogSelector && rule.medias.includes('@media (min-width: 640px)'),
  );
  const foot = all.find((rule) => rule.selector === footSelector);
  const footLine = all.find((rule) => rule.selector === `${footSelector}::before`);

  // Gelten muss die Regel gegen `rounded-t-card sm:rounded-card` am Panel und `border-t border-line-warm bg-sheet` an
  // der Fußzeile (Tailwind-Utilities, Schicht `utilities`): Das schaffen nur Regeln außerhalb von @layer.
  it('hat eine Regel für .lg-dialog (vorher keine, der Dialog trug die Lagen-Papierfläche)', () => {
    expect(panel, 'keine Raum-Regel für .lg-dialog').toBeDefined();
  });

  it('gibt dem Dialog die Fläche --raum-raised, keinen Rand, keine Körnung und die große Schattenstufe', () => {
    expect(panel?.body).toContain('background-color: var(--raum-raised)');
    expect(panel?.body).toMatch(/border:\s*0;/);
    expect(panel?.body).toContain('background-image: none');
    expect(panel?.body).toContain('box-shadow: var(--raum-up-l)');
    expect(panel?.body).not.toMatch(/--grain/);
  });

  it('setzt --raum-surf auf die Fläche des Dialogs, damit Eingelassenes darin richtig liegt', () => {
    expect(panel?.body).toContain('--raum-surf: var(--raum-raised);');
  });

  it('rundet mit dem Raum-Radius: unten Blatt nur oben, ab 640 px rundum', () => {
    expect(panel?.body).toContain('border-radius: var(--raum-r-big) var(--raum-r-big) 0 0');
    expect(panelWide?.body).toContain('border-radius: var(--raum-r-big);');
  });

  it('benutzt nur Tokens: keine festen Farben, keine festen Radien, Schatten und Fläche ohne Zahlen', () => {
    for (const rule of [panel, panelWide, foot, footLine]) {
      expect(rule?.body, rule?.selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
    expect(`${panel?.body}${panelWide?.body}`).not.toMatch(/border-radius:[^;]*\d+px/);
  });

  it('steht außerhalb von @layer, sonst gewinnen die Utilities am Panel und an der Fußzeile', () => {
    // Plausibilität der Schichtgrenze: das Blatt steht noch in der Schicht, der Dialog dahinter.
    expect(layerStart).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(":root[data-design='raum'] .lg-sheet {")).toBeLessThan(layerEnd);
    for (const selector of [dialogSelector, footSelector, `${footSelector}::before`]) {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} fehlt`).toBeGreaterThan(layerEnd);
    }
  });

  it('nimmt der Fußzeile die Randlinie und gibt ihr die Fläche des Dialogs (deckend)', () => {
    expect(foot?.body).toMatch(/border-top:\s*0;/);
    expect(foot?.body).toContain('background-color: var(--raum-raised)');
  });

  it('zeichnet statt der Randlinie eine eingravierte Doppellinie oben (dunkel, dann hell, je 1 px)', () => {
    expect(footLine?.body).toContain(
      'background: linear-gradient(var(--raum-dark) 1px, var(--raum-light) 1px)',
    );
    expect(footLine?.body).toMatch(/height:\s*2px/);
    expect(footLine?.body).toMatch(/top:\s*0/);
    expect(footLine?.body).not.toMatch(/border/);
  });

  it('kehrt bei „Mehr Kontrast“ die 1 px Umrandung auch am Dialog zurück', () => {
    const outline = all.find(
      (rule) =>
        rule.medias.some((media) => media.includes('prefers-contrast: more')) &&
        rule.body.includes('outline: 1px solid var(--raum-edge)'),
    );
    expect(outline?.selector).toContain('.lg-dialog,');
  });

  it('ui/modal.tsx trägt die Haken lg-dialog (Panel) und lg-dialog-foot (Fußzeile)', () => {
    const modal = readFileSync(join(dir, '..', 'ui', 'modal.tsx'), 'utf8');
    expect(modal).toMatch(/className=\{?`lg-dialog /);
    expect(modal).toMatch(/lg-dialog-foot /);
  });
});

describe('raum.css: Textfelder sind eingelassen mit Bodenlinie (D-089, B-20)', () => {
  const fieldSelector = ":root[data-design='raum'] .lg-field";
  const field = all.find((rule) => rule.selector === fieldSelector);
  const focus = all.find((rule) => rule.selector === `${fieldSelector}:focus`);
  const invalid = all.find((rule) => rule.selector === `${fieldSelector}[aria-invalid='true']`);
  const invalidFocus = all.find(
    (rule) => rule.selector === `${fieldSelector}[aria-invalid='true']:focus`,
  );
  const placeholder = all.find((rule) => rule.selector === `${fieldSelector}::placeholder`);
  const composer = all.find(
    (rule) => rule.selector === ":root[data-design='raum'] .lg-composer textarea",
  );
  const flat = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ');

  it('hat eine Regel für .lg-field mit Mulde, Bodenlinie und ohne vollen Rand', () => {
    expect(field, 'keine Raum-Regel für .lg-field').toBeDefined();
    expect(field?.body).toMatch(/border:\s*0;/);
    expect(field?.body).toContain('border-radius: var(--raum-r-big)');
    expect(field?.body).toContain('background-color: var(--raum-raised)');
    expect(flat(field?.body)).toContain(
      'box-shadow: inset 0 -2px 0 0 var(--raum-edge), var(--raum-in-m);',
    );
    expect(field?.body).not.toMatch(/border(-color|-(top|right|bottom|left))?:\s*[1-9]/);
  });

  it('hat dieselbe Mulde, Fläche, Bodenlinie und Ecke wie die Chat-Eingabe', () => {
    expect(composer?.body).toContain('var(--raum-in-m)');
    expect(composer?.body).toContain('inset 0 -2px 0 0 var(--raum-edge)');
    expect(composer?.body).toContain('background-color: var(--raum-raised)');
    expect(composer?.body).toContain('border-radius: var(--raum-r-big)');
    expect(field?.body).toContain('var(--raum-in-m)');
    expect(field?.body).toContain('background-color: var(--raum-raised)');
    expect(field?.body).toContain('border-radius: var(--raum-r-big)');
  });

  it('malt die Bodenlinie zuoberst (erste Schicht), sonst verblasst sie hinter der hellen Innenschicht der Mulde', () => {
    for (const rule of [field, focus, invalid]) {
      expect(flat(rule?.body), rule?.selector).toMatch(
        /box-shadow: inset 0 -2px 0 0 var\(--(raum-edge|accent|danger)\), var\(--raum-in-m\);/,
      );
    }
  });

  it('wechselt Schatten nur kurz mit --t-color (D-058), nicht mit den längeren Zeiten', () => {
    expect(field?.body).toContain('transition: box-shadow var(--t-color) ease');
    expect(field?.body).not.toMatch(/--t-(fast|med|slow)/);
  });

  it('zeigt den Fokus: Bodenlinie in --accent und ein Ring von 2 px mit 3 px Abstand', () => {
    expect(focus, 'keine Regel für .lg-field:focus').toBeDefined();
    expect(flat(focus?.body)).toContain('inset 0 -2px 0 0 var(--accent), var(--raum-in-m)');
    expect(focus?.body).toContain('outline: 2px solid var(--accent)');
    expect(focus?.body).toContain('outline-offset: 3px');
  });

  it('zeigt einen Fehler an der Bodenlinie in --danger, auch fokussiert (der Rand der Seite entfällt)', () => {
    expect(invalid, 'keine Regel für aria-invalid').toBeDefined();
    expect(flat(invalid?.body)).toContain('inset 0 -2px 0 0 var(--danger), var(--raum-in-m)');
    expect(invalidFocus?.body).toContain('outline-color: var(--danger)');
    // Reihenfolge: erst Fokus, dann Fehler, sonst überstimmt der Fokus die Fehlerlinie bei gleicher Gewichtung
    expect(css.indexOf(`${fieldSelector}[aria-invalid='true'] {`)).toBeGreaterThan(
      css.indexOf(`${fieldSelector}:focus {`),
    );
  });

  it('setzt den Platzhalter in --ink-muted ohne Abdunkeln (mindestens 4,5 : 1)', () => {
    expect(placeholder?.body).toContain('color: var(--ink-muted)');
    expect(placeholder?.body).toContain('opacity: 1');
  });

  it('steht außerhalb von @layer, sonst gewinnen border, bg-sheet, rounded-* und focus:* am Feld', () => {
    for (const selector of [fieldSelector, `${fieldSelector}:focus`]) {
      expect(css.indexOf(`${selector} {`), `${selector} fehlt`).toBeGreaterThan(layerEnd);
    }
  });

  it('benutzt nur Tokens: keine festen Farben und Radien in den Feldregeln', () => {
    for (const rule of [field, focus, invalid, invalidFocus, placeholder]) {
      expect(rule?.body, rule?.selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
    expect(field?.body).not.toMatch(/border-radius:[^;]*\d+px/);
  });

  it('kehrt bei „Mehr Kontrast“ die 1 px Umrandung auch am Feld zurück', () => {
    const outline = all.find(
      (rule) =>
        rule.medias.some((media) => media.includes('prefers-contrast: more')) &&
        rule.body.includes('outline: 1px solid var(--raum-edge)'),
    );
    expect(outline?.selector).toContain('.lg-field,');
  });

  it('lässt Lagen und Atelier unberührt: der Haken lg-field steht in keinem anderen Stylesheet', () => {
    for (const name of [
      'lagen.css',
      'atelier.css',
      'atelier-fach.css',
      'tokens.css',
      'motion.css',
    ]) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toContain('lg-field');
    }
  });

  it('hängt die gemeinsame Feldklasse in ui/Field.tsx an den Haken lg-field (Text, Auswahl, Textbereich)', () => {
    const fieldTsx = readFileSync(join(dir, '..', 'ui', 'Field.tsx'), 'utf8');
    expect(fieldTsx).toMatch(/const inputClass =\s*'lg-field /);
    expect(fieldTsx).toMatch(/className=\{`lg-field mt-1\.5 \$\{compact/);
    expect(fieldTsx.match(/lg-field/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('hängt die Hefte-Suche, die Stichwörter und das Textfeld des Editors an denselben Haken', () => {
    const list = readFileSync(join(dir, '..', 'screens', 'notes', 'NoteList.tsx'), 'utf8');
    const page = readFileSync(join(dir, '..', 'screens', 'notes', 'NotePage.tsx'), 'utf8');
    expect(list.match(/className="lg-field /g)).toHaveLength(1);
    expect(page).toMatch(/id="note-tags"[\s\S]*?className="lg-field /);
    expect(page).toMatch(/id="note-text"[\s\S]*?className="lg-field /);
  });

  it('hängt die Eingabefelder der Bausteine Modellliste, Modellwahl und Vorlagenwahl an den Haken (Nachzug zu B-20)', () => {
    const expected: Record<string, number> = {
      'screens/providers/ModelListEditor.tsx': 3,
      'screens/providers/ModelChoice.tsx': 1,
      'screens/subjects/TemplatePicker.tsx': 1,
    };
    for (const [file, count] of Object.entries(expected)) {
      const source = readFileSync(join(dir, '..', file), 'utf8');
      // Kontrollkästchen (Fähigkeiten, Auswahl der Vorlagen) bleiben ohne Haken; jedes andere Eingabefeld trägt ihn.
      const fields = (source.match(/<input[\s\S]*?\/>/g) ?? []).filter(
        (tag) => !tag.includes('type="checkbox"'),
      );
      expect(fields, file).toHaveLength(count);
      for (const tag of fields) expect(tag, file).toContain('className="lg-field ');
    }
  });
});

describe('raum.css: Seitenleiste ist breit genug für „Mathematik“ (B-04, D-094)', () => {
  /** Breite aus `--sidebar-w` der Regel auf :root[data-design='raum'], mit oder ohne die iPad-Bedingung. */
  const sidebarWidth = (media: string | null): number | null => {
    const hit = all.find(
      (rule) =>
        rule.selector === ":root[data-design='raum']" &&
        (media === null ? rule.medias.length === 0 : rule.medias.join(' ') === media) &&
        '--sidebar-w' in declarationsOf(rule.body),
    );
    const value = hit ? declarationsOf(hit.body)['--sidebar-w'] : undefined;
    return value ? Number.parseFloat(value) : null;
  };

  it('hält 240 px ab 1100 px Breite wie bisher', () => {
    expect(sidebarWidth(null)).toBe(240);
  });

  it('macht die Leiste auf dem iPad hochkant und in kleinen Fenstern (768 bis 1099 px) 236 statt 216 px breit', () => {
    expect(sidebarWidth('@media (min-width: 768px) and (max-width: 1099.98px)')).toBe(236);
  });

  it('lässt der Namensspalte dort mindestens 4 px mehr, als „Mathematik“ braucht', () => {
    // Gemessen im Browser (Chromium und WebKit, Raum): bei 216 px Leiste hat die Namensspalte 73 px, die Leiste
    // nimmt also 143 px für Pfeilspalte, Symbol, Punkt und Abstände. „Mathematik“ ist 88,4 px breit.
    const festeAnteile = 216 - 73;
    const mathematik = 88.4;
    const breite = sidebarWidth('@media (min-width: 768px) and (max-width: 1099.98px)') ?? 0;
    expect(breite - festeAnteile).toBeGreaterThanOrEqual(mathematik + 4);
  });
});

describe('raum.css: Bodenlinie der Chat-Eingabe und des Startfelds steht zuoberst (D-116, Nachtrag zu D-073)', () => {
  const selector = (tail: string) => `:root[data-design='raum'] ${tail}`;
  const startField = all.find((rule) => rule.selector === selector('.rm-start-dock form > div'));
  const chatField = all.find((rule) => rule.selector === selector('.lg-composer textarea'));
  const startFocus = all.find(
    (rule) => rule.selector === selector('.rm-start-dock form > div:focus-within'),
  );
  const chatFocus = all.find((rule) => rule.selector === selector('.lg-composer textarea:focus'));
  const field = all.find((rule) => rule.selector === selector('.lg-field'));
  const flat = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ');

  it('malt die Bodenlinie als erste Schicht, vor der hellen Innenschicht der Mulde (gemessen 1,5 : 1 hell, sonst unter 3 : 1)', () => {
    for (const rule of [startField, chatField]) {
      expect(flat(rule?.body), rule?.selector).toContain(
        'box-shadow: inset 0 -2px 0 0 var(--raum-edge), var(--raum-in-m);',
      );
    }
  });

  it('hat dieselbe Schattenfolge wie das neue Feld lg-field (D-089)', () => {
    const shadowOf = (rule: Rule | undefined) =>
      /box-shadow:\s*([^;]+);/.exec(flat(rule?.body))?.[1]?.trim();
    expect(shadowOf(field)).toBeDefined();
    expect(shadowOf(startField)).toBe(shadowOf(field));
    expect(shadowOf(chatField)).toBe(shadowOf(field));
  });

  it('lässt den Fokus an Startfeld und Chat-Eingabe stehen: Ring 2 px mit 3 px Abstand in --accent', () => {
    for (const rule of [startFocus, chatFocus]) {
      expect(rule, 'keine Fokusregel').toBeDefined();
      expect(rule?.body, rule?.selector).toContain('outline: 2px solid var(--accent)');
      expect(rule?.body, rule?.selector).toContain('outline-offset: 3px');
      expect(flat(rule?.body), rule?.selector).toContain('inset 0 -2px 0 0 var(--accent)');
    }
  });

  it('behält Mulde, Fläche, Ecke und den Übergang nur mit --t-color', () => {
    for (const rule of [startField, chatField]) {
      expect(rule?.body, rule?.selector).toContain('background-color: var(--raum-raised)');
      expect(rule?.body, rule?.selector).toContain('border-radius: var(--raum-r-big)');
      expect(rule?.body, rule?.selector).toContain('transition: box-shadow var(--t-color) ease');
    }
  });
});

describe('raum.css: Zettel „Nächster Test“ steht ruhig, ohne Heben und Einsinken (D-116)', () => {
  const slipRules = all.filter((rule) => rule.selector.includes('.lg-slip'));
  const slip = all.find((rule) => rule.selector === ":root[data-design='raum'] .lg-slip");

  it('sieht die Regeln des Zettels', () => {
    expect(slip, 'keine Raum-Regel für .lg-slip').toBeDefined();
    expect(slipRules.length).toBeGreaterThanOrEqual(3);
  });

  it('hat keine Regel mit :hover oder :active (der Zettel ist ein div ohne Klick)', () => {
    for (const rule of slipRules) {
      expect(rule.selector, `Zustand am Zettel: ${rule.selector}`).not.toMatch(/:(hover|active)/);
    }
  });

  it('bewegt sich nicht: transform none, kein Übergang, kein Schattenwechsel auf die Mulde', () => {
    expect(slip?.body).toMatch(/transform:\s*none;/);
    expect(slip?.body).toMatch(/transition:\s*none;/);
    expect(slip?.body).not.toMatch(/translate|--raum-in-/);
  });

  it('behält den Ruhestil: gehobene Fläche mit großem Schatten, Radius und Raumfläche', () => {
    expect(slip?.body).toContain('box-shadow: var(--raum-up-l)');
    expect(slip?.body).toContain('background-color: var(--raum-raised)');
    expect(slip?.body).toContain('border-radius: var(--raum-r-big)');
  });

  it('ist an beiden Stellen ein einfaches div ohne Knopf oder Link um den Zettel', () => {
    for (const file of ['planning/NextUp.tsx', 'screens/lagen/StartGrid.tsx']) {
      const source = readFileSync(join(dir, '..', file), 'utf8');
      expect(source, file).toContain('<div className="lg-slip">');
      expect(source, file).not.toMatch(/<(a|button|Link)[^>]*className="lg-slip/);
    }
  });

  it('lässt Lagen und Atelier unberührt: dort hebt sich der Zettel weiter (Kay: nur Raum)', () => {
    expect(readFileSync(join(dir, 'lagen.css'), 'utf8')).toContain('.lg-slip:hover');
    expect(readFileSync(join(dir, 'atelier.css'), 'utf8')).toContain('.lg-slip:hover');
  });
});
