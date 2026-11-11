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
 * Kopf der schmalen Breite in „Atelier“ (D-083, Befund B-18, Kay GF-03): Glas erst beim Scrollen. In Ruhe liegt der
 * Kopf ohne Fläche, ohne Filter und ohne Rand auf dem Fachlicht; mit `data-scrolled` (gesetzt von `ui/scrolled.ts`)
 * wird die Ebene `::before` zum heutigen Glas. Der Blur lässt sich nur in Chromium prüfen (Playwright-WebKit zeichnet
 * `backdrop-filter` nicht, D-084); darum sichert dieser Test die Bauweise: Das Glas hängt an der Ebene, und `opacity`
 * läuft nur dort, nie am Kopf oder an einem Vorfahren (ein Vorfahr mit opacity unter 1 nähme dem Glas den Blur).
 */
describe('Kopf der schmalen Breite: Glas erst beim Scrollen (D-083)', () => {
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

/*
 * Scrim von Dialog und Schublade in „Atelier“ (Befund B-01, D-086): Das Glas des Panels (`backdrop-filter`) sieht den
 * Grund nur, wenn kein Vorfahr eine Deckkraft-Animation trägt (Chromium: Hintergrundwurzel, gemessen in BT2). Darum
 * animiert der Scrim hier nicht; seine Tönung liegt als Ebene ::before hinter dem Panel und blendet dort beim Öffnen ein.
 * Die Ebene ist kein Vorfahr des Panels. Den Blur kann nur der Browser zeigen (Chromium, D-084); dieser Test sichert die
 * Bauweise.
 */
describe('Scrim von Dialog und Schublade: Blur schon in der Einblendung (B-01, D-086)', () => {
  const scrim = ":root[data-design='atelier'] .lg-scrim";
  const ebene = `${scrim}::before`;
  const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] as string).trim(),
    body: match[2] as string,
  }));
  const mitScrim = regeln.filter((regel) => regel.selector.includes('.lg-scrim'));

  it('nimmt dem Scrim selbst Animation und Fläche', () => {
    const body = rule(scrim);
    expect(body).toMatch(/animation:\s*none\b/);
    expect(body).toMatch(/background:\s*none\b/);
    expect(body).not.toMatch(/!important/);
  });

  it('legt die Tönung als Ebene hinter das Panel: Stapelkontext des Scrims, klickdurchlässig, Wert aus --scrim', () => {
    const body = rule(ebene);
    expect(body).toContain("content: ''");
    expect(body).toMatch(/position:\s*absolute\b/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/z-index:\s*-1\b/);
    expect(body).toMatch(/pointer-events:\s*none\b/);
    expect(body).toMatch(/background:\s*var\(--scrim\)/);
  });

  it('blendet die Ebene beim Öffnen mit `fade` über --t-med ein und füllt danach nicht', () => {
    const animation = /animation:\s*([^;]+);/.exec(rule(ebene))?.[1]?.trim() ?? '';
    expect(animation).toBe('fade var(--t-med) backwards');
  });

  it('hängt backdrop-filter, filter, opacity und Animationen nur an die Ebene, nie an den Scrim', () => {
    for (const regel of mitScrim) {
      if (regel.selector.endsWith('::before')) continue;
      expect(regel.body, `Scrim selbst: ${regel.selector}`).not.toMatch(
        /backdrop-filter|(^|[;\s])opacity\s*:|(^|[;\s])filter\s*:/,
      );
      expect(regel.body, `Scrim selbst: ${regel.selector}`).not.toMatch(
        /animation(-fill-mode)?:[^;]*\b(both|forwards)\b/,
      );
    }
  });

  it('steht in der Ebene components, damit die Utility beim Schließen der Schublade (lg-fade-out) weiter gilt', () => {
    const roh = readFileSync(join(dir, 'atelier.css'), 'utf8').replaceAll('"', "'");
    const layer = roh.indexOf('@layer components {');
    expect(layer).toBeGreaterThan(-1);
    expect(roh.indexOf(scrim)).toBeGreaterThan(layer);
    // Die Regel steht vor dem Abschnitt „Ohne @layer“ (dort würde sie jede Utility überstimmen).
    expect(roh.indexOf(scrim)).toBeLessThan(roh.indexOf('Ohne @layer'));
  });
});

/*
 * Dialog, Schublade und Fuß des Dialogs in „Atelier“ (Befunde B-07 und B-22, D-087): Dialogblatt und Schublade haben
 * eine eigene Glasfüllung (`--glass-dialog-fill`), weil sie auf dem Scrim liegen und der gedämpfte Text mit der
 * Füllung der übrigen Flächen unter 4,5 : 1 stand (Kontrastrechnung in `atelier-contrast.test.ts`, Pixelmessung im
 * Browser). Seitenleiste, Kopf, Composer und Testkarte behalten `--glass-fill`. Der Fuß ist deckend im Ton des Dialogs
 * und reicht bis an dessen Rand. Wo `backdrop-filter` fehlt, sind Blatt, Schublade und Fuß deckend (94 % `--canvas`).
 */
describe('Dialog, Schublade und Fuß: eigene Fläche (B-07, B-22, D-087)', () => {
  const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] as string).trim(),
    body: match[2] as string,
  }));
  /** Auswahl der Regel nach den Kommentaren, ohne die Bedingung des @supports-Blocks davor. */
  const teile = (selector: string) => selector.split(',').map((teil) => teil.trim());
  const root = ":root[data-design='atelier']";
  const dialog = `${root} .lg-dialog`;
  const schublade = `${root} .lg-scrim .lg-binder`;
  const fuss = `${root} .lg-dialog-foot`;
  const deckend = /color-mix\(in srgb, var\(--canvas\) 94%, transparent\)/;

  it('legt Dialogblatt und Schublade auf --glass-dialog-fill, hinter die gemeinsame Glasregel', () => {
    const glasRegel = regeln.findIndex(
      (regel) => teile(regel.selector).includes(dialog) && /backdrop-filter/.test(regel.body),
    );
    const eigene = regeln.findIndex(
      (regel) =>
        teile(regel.selector).includes(dialog) &&
        teile(regel.selector).includes(schublade) &&
        /background-color:\s*var\(--glass-dialog-fill\)/.test(regel.body),
    );
    expect(glasRegel).toBeGreaterThan(-1);
    expect(eigene, 'Regel mit --glass-dialog-fill').toBeGreaterThan(glasRegel);
    // nur diese eine Regel nutzt die Füllung, und sonst nichts außer der Fläche
    const nutzer = regeln.filter((regel) => regel.body.includes('--glass-dialog-fill'));
    expect(nutzer).toHaveLength(1);
    expect(nutzer[0]?.body.trim()).toBe('background-color: var(--glass-dialog-fill);');
  });

  it('lässt Seitenleiste, Kopf, Composer und Testkarte auf --glass-fill und trifft sie nicht mit der Dialogfüllung', () => {
    const fuellung = regeln.find(
      (regel) => teile(regel.selector).includes(dialog) && /--glass-fill/.test(regel.body),
    );
    expect(fuellung, 'gemeinsame Glasregel').toBeDefined();
    for (const selector of ['.at-glass', '.lg-binder', '.lg-composer', '.at-test']) {
      expect(teile(fuellung?.selector ?? '')).toContain(`${root} ${selector}`);
    }
    // die Seitenleiste am Mac (.lg-aside .lg-binder) liegt nicht unter .lg-scrim
    const eigene = regeln.find((regel) => regel.body.includes('--glass-dialog-fill'));
    for (const teil of teile(eigene?.selector ?? '')) {
      expect([dialog, schublade]).toContain(teil);
    }
  });

  it('ersetzt die Fläche von Dialogblatt, Schublade und Fuß ohne backdrop-filter durch 94 % --canvas', () => {
    const rueckfall = css.match(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{[^}]*\}\s*\}/g,
    );
    expect(rueckfall, '@supports-Blöcke').not.toBeNull();
    const text = (rueckfall ?? []).join('\n');
    expect(text).toContain(dialog);
    expect(text).toContain(schublade);
    expect(text).toContain(fuss);
    expect(text).toMatch(deckend);
    // der Block der Flächen steht hinter der Regel mit der Dialogfüllung, sonst gälte sie wieder
    const eigene = css.indexOf('background-color: var(--glass-dialog-fill)');
    const rueckfallStart = css.indexOf('@supports not', eigene);
    expect(eigene).toBeGreaterThan(-1);
    expect(rueckfallStart).toBeGreaterThan(eigene);
    expect(css.slice(rueckfallStart, css.indexOf('}\n  }', rueckfallStart))).toContain(schublade);
  });

  it('gibt dem Fuß eine deckende Fläche im Ton des Dialogs, bis an den Rand des Dialogs und ohne feste Farben', () => {
    const regel = regeln.find(
      (eintrag) => eintrag.selector === fuss && /clip-path/.test(eintrag.body),
    );
    expect(regel, 'Regel des Fußes').toBeDefined();
    const body = regel?.body ?? '';
    expect(body).toMatch(/--ft:\s*var\(--glass-dialog-foot\)/);
    expect(body).toMatch(/background-color:\s*var\(--ft\)/);
    expect(body).toMatch(/box-shadow:\s*0 0 0 100vmax var\(--ft\)/);
    expect(body).toMatch(/clip-path:\s*inset\(0 -100vmax\)/);
    expect(body).toMatch(/border-top-color:\s*var\(--line-warm\)/);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    // keine Rundung am Fuß selbst: Radius und overflow des Dialogs runden die Ecken
    expect(body).not.toMatch(/border-radius/);
  });

  it('bietet dem Fuß ohne backdrop-filter dieselbe deckende Fläche wie dem Dialog', () => {
    const regel = regeln.find(
      (eintrag) =>
        eintrag.selector === fuss && !/clip-path/.test(eintrag.body) && /--ft:/.test(eintrag.body),
    );
    expect(regel?.body).toMatch(/--ft:\s*color-mix\(in srgb, var\(--canvas\) 94%, transparent\)/);
  });

  it('lässt keine andere Regel den Fuß färben (nur Tokens, kein weißes Rechteck mehr)', () => {
    for (const eintrag of regeln.filter((regel) => regel.selector.includes('.lg-dialog-foot'))) {
      expect(eintrag.body).not.toMatch(
        /background-color:\s*color-mix\(in srgb, var\(--canvas\) 94%/,
      );
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

describe('Wortmarke über der Karte: bündig mit der Spalte in Atelier (B-24, D-090)', () => {
  const wortmarke = ":root[data-design='atelier'] .lg-wordmark";
  const bildschirme = [
    join(dir, '..', 'screens', 'AuthLayout.tsx'),
    join(dir, '..', 'screens', 'onboarding', 'StepFrame.tsx'),
  ];

  it('gibt die Wortmarke über der Karte den Haken lg-wordmark (Anmeldung, Einrichtung, Verbindung, Onboarding)', () => {
    for (const file of bildschirme) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/<p className="lg-wordmark /);
    }
  });

  it('rückt um dasselbe Polster ein wie die Karte: p-6 und ab sm p-8, also 24 px und 32 px', () => {
    for (const file of bildschirme) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/className="lg-sheet[^"]*\sp-6 sm:p-8"/);
    }
    expect(rule(wortmarke).replace(/\s+/g, ' ').trim()).toBe('padding-inline: 1.5rem;');
    expect(css).toMatch(
      /@media \(min-width: 640px\) \{\s*:root\[data-design='atelier'\] \.lg-wordmark \{\s*padding-inline:\s*2rem;/,
    );
  });

  it('lässt Raum und Lagen unberührt: deren Karte zeigt eine Fläche, dort gibt es keinen Haken-Stil', () => {
    for (const name of ['raum.css', 'lagen.css']) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toContain('lg-wordmark');
    }
  });
});

describe('„Zum Ende“-Knopf: rund und deckend, ohne Glas (F-082, D-118, D-070)', () => {
  const button = rule(":root[data-design='atelier'] .lg-toend-button");

  it('hat eine deckende Fläche im Grund und den Haarstrich innen in --control-edge', () => {
    expect(button).toContain('background-color: var(--canvas)');
    expect(button).toContain('--toend-surface: var(--canvas)');
    expect(button).toContain(
      'inset 0 0 0 1px color-mix(in srgb, var(--control-edge) 72%, var(--ink))',
    );
    expect(button).toContain('var(--glass-shadow-near)');
  });

  it('ist keine Glasfläche: kein backdrop-filter, nicht in der Liste der Glas-Hüllen', () => {
    expect(button).not.toMatch(/backdrop-filter/);
    const glass = css.slice(
      css.indexOf(":root[data-design='atelier'] .at-glass,"),
      css.indexOf('backdrop-filter: blur(var(--glass-blur))'),
    );
    expect(glass).toContain('.lg-composer');
    expect(glass).not.toContain('toend');
  });

  it('hat keinen eigenen Rand und keine feste Farbe; Hover nur mit Maus', () => {
    expect(button).toMatch(/border:\s*0;/);
    expect(button).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*:root\[data-design='atelier'\] \.lg-toend-button:hover \{\s*background-color: var\(--paper\);/,
    );
  });

  it('der Fokusring kommt von der Regel für Bedienelemente (Text-Ton), nicht von einer eigenen', () => {
    expect(css).toContain(
      ":root[data-design='atelier'] :is(a, button, input, select, textarea, summary):focus-visible",
    );
    expect(button).not.toMatch(/outline/);
  });
});
