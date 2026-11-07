import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Sperre gegen Übergänge mit falscher Dauer (B-10, B-34, D-098).
 *
 * Regel (D-058, D-081, CLAUDE.md „Gestaltung“, docs/design.md „Bewegung“): Flächen bewegen sich nur mit
 * `transform` und `opacity`. An Bedienelementen dürfen Farbe, Rand und Schatten kurz wechseln, aber nur mit
 * `transition` und `var(--t-color)` (140 ms bei „Voll“, 0 ms bei „Reduziert“ und „Aus“). Eine Dauer aus
 * `--t-fast`, `--t-med` oder `--t-slow` (bei „Reduziert“ 100, 140 und 160 ms) oder die Standarddauer von
 * Tailwind (150 ms, nie 0) verstößt dagegen. Bis D-098 standen solche Dauern an Feldern, Zeilen und am
 * Onboarding-Balken, und der Quelltext-Scan der Bestandsaufnahme sah sie nicht, weil er Klassenkonstanten
 * außerhalb von `className=` übersah (B-34, Beispiel `inputClass` in ui/Field.tsx).
 *
 * Grenze: Er prüft nur die Dauer, nicht, ob das Element ein Bedienelement ist; ob eine Fläche einen Farb- oder
 * Schattenwechsel haben darf, entscheidet die Regel oben und die Durchsicht der Befunde.
 *
 * Dieser Test liest darum den ganzen Text jeder `.ts`-, `.tsx`- und `.css`-Datei unter apps/web/src (ohne
 * Tests) und prüft zwei Dinge:
 *   1. Tailwind-Klassen, wo auch immer sie im Text stehen: Jede Zeichenkette (zwischen `'`, `"` oder
 *      Backtick), die einen Übergang auf Farbe, Rand oder Schatten setzt (`transition`, `transition-colors`,
 *      `transition-shadow`, `transition-all`, `transition-[…]` mit solchen Eigenschaften, `[transition:…]`),
 *      trägt `duration-[var(--t-color)]` und keine andere Dauer.
 *   2. CSS-Regeln: Jeder Eintrag einer `transition`-Kurzform auf Farbe, Rand, Schatten, `all` oder eine
 *      eigene Eigenschaft (`--…`) hat `var(--t-color)` als Dauer. `transform`, `opacity` und andere
 *      Eigenschaften (zum Beispiel `stroke-dashoffset`) bleiben frei. Die Langformen `transition-property`
 *      und `transition-duration` wertet der Test nicht aus; sie sind deshalb verboten (Kurzform benutzen).
 * Ausnahmen stehen unten mit Datei und Begründung; jede muss noch einen Treffer haben, sonst schlägt der
 * Test an (keine toten Ausnahmen).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const T_COLOR = 'var(--t-color)';

interface Befund {
  datei: string;
  zeile: number;
  text: string;
}

/** Begründete Ausnahmen: nur eigene Eigenschaften (`--…`), die keine Bedienfläche, sondern Licht färben. */
const AUSNAHMEN: { datei: string; eintrag: string; grund: string }[] = [
  {
    datei: 'styles/lagen.css',
    eintrag: '--glow var(--t-slow) var(--ease)',
    grund:
      'Lichtfarbe des Schreibtischs (`@property --glow` in motion.css, D-043, docs/design.md „Leistung“): ' +
      'feste Fläche hinter allem, die beim Fachwechsel überblendet; kein Bedienelement und keine Fläche mit Inhalt.',
  },
  {
    datei: 'styles/atelier.css',
    eintrag: '--subj var(--t-slow) var(--ease)',
    grund:
      'Lichtfarbe im Atelier (`@property --subj`, D-058): Beim Fachwechsel blendet nur das Licht der Fachfarbe ' +
      'über (Dauer und Kurve aus motion.css); keine Bedienfläche.',
  },
];

/** Alle Dateien unter `dir`, die der Test liest: `.ts`, `.tsx`, `.css`, ohne Tests und ohne Typdateien. */
function quelldateien(dir: string): string[] {
  const out: string[] = [];
  for (const eintrag of readdirSync(dir, { withFileTypes: true })) {
    const pfad = join(dir, eintrag.name);
    if (eintrag.isDirectory()) out.push(...quelldateien(pfad));
    else if (/\.(ts|tsx|css)$/.test(eintrag.name) && !/\.(test\.tsx?|d\.ts)$/.test(eintrag.name)) {
      out.push(pfad);
    }
  }
  return out.sort();
}

/** Ersetzt jedes Zeichen außer Zeilenumbrüchen durch ein Leerzeichen, damit Zeilennummern stimmen. */
const leer = (text: string) => text.replaceAll(/[^\n]/g, ' ');
const zeileVon = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Teilt an Kommas und Leerzeichen außerhalb von Klammern (`var(--a, b)`, `calc(… * …)`, `linear(…)`). */
function teile(text: string, trenner: RegExp): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let aktuell = '';
  for (const zeichen of text) {
    if (zeichen === '(') tiefe += 1;
    if (zeichen === ')') tiefe -= 1;
    if (tiefe === 0 && trenner.test(zeichen)) {
      if (aktuell.trim()) teile.push(aktuell.trim());
      aktuell = '';
    } else {
      aktuell += zeichen;
    }
  }
  if (aktuell.trim()) teile.push(aktuell.trim());
  return teile;
}

/** Eigenschaften, deren Wechsel als Farb-, Rand- oder Schattenübergang zählt (`all` und eigene `--…` auch). */
const FARBEIGENSCHAFT =
  /^(all|color|background|background-color|border|border-color|border-(top|right|bottom|left|block|inline)(-(start|end))?-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|text-decoration-color|caret-color|accent-color|--[\w-]+)$/;

/** Prüft die Einträge einer `transition`-Kurzform; liefert die Einträge, deren Dauer nicht `var(--t-color)` ist. */
function falscheEintraege(wert: string): string[] {
  const falsch: string[] = [];
  for (const eintrag of teile(wert, /,/)) {
    const woerter = teile(eintrag, /\s/);
    const eigenschaft = woerter[0] ?? '';
    if (!FARBEIGENSCHAFT.test(eigenschaft)) continue;
    const dauer = woerter
      .slice(1)
      .find((wort) => /^(var\(--t-[a-z]+\)|calc\(.*\)|[\d.]+m?s)$/.test(wort));
    if (dauer !== T_COLOR) falsch.push(woerter.join(' '));
  }
  return falsch;
}

/** CSS: alle `transition`-Kurzformen außerhalb von Kommentaren, deren Farb-/Rand-/Schatteneintrag nicht `--t-color` hat. */
function cssBefunde(datei: string, css: string): (Befund & { eintrag: string })[] {
  const ohneKommentare = css.replaceAll(/\/\*[\s\S]*?\*\//g, leer);
  const befunde: (Befund & { eintrag: string })[] = [];
  for (const treffer of ohneKommentare.matchAll(/(?<![-\w])transition\s*:\s*([^;{}]*)/g)) {
    for (const eintrag of falscheEintraege(treffer[1] ?? '')) {
      befunde.push({
        datei,
        zeile: zeileVon(ohneKommentare, treffer.index ?? 0),
        eintrag,
        text: `transition: ${eintrag}`,
      });
    }
  }
  return befunde;
}

/** CSS: Langformen, die der Test nicht auswertet. */
function cssLangformen(datei: string, css: string): Befund[] {
  const ohneKommentare = css.replaceAll(/\/\*[\s\S]*?\*\//g, leer);
  return [...ohneKommentare.matchAll(/(?<![-\w])transition-(property|duration)\s*:/g)].map(
    (treffer) => ({
      datei,
      zeile: zeileVon(ohneKommentare, treffer.index ?? 0),
      text: treffer[0],
    }),
  );
}

/** Entfernt Varianten (`hover:`, `md:`, `[&>svg]:`, `motion-reduce:`) vor dem Namen einer Tailwind-Klasse. */
const ohneVarianten = (klasse: string) => klasse.replace(/^(?:[^\s[\]:]+:|\[[^\]]*\]:)+/, '');

/** Wahr, wenn die Tailwind-Klasse einen Übergang auf Farbe, Rand oder Schatten setzt. */
function istFarbuebergang(klasse: string): boolean {
  const name = ohneVarianten(klasse);
  if (['transition', 'transition-colors', 'transition-shadow', 'transition-all'].includes(name)) {
    return true;
  }
  const eigene = /^transition-\[(.+)\]$/.exec(name);
  if (eigene) {
    // `transition-[box-shadow,border-color]`: Leerzeichen stehen als `_`.
    return teile((eigene[1] ?? '').replaceAll('_', ' '), /,/).some((eintrag) =>
      FARBEIGENSCHAFT.test(teile(eintrag, /\s/)[0] ?? ''),
    );
  }
  return false;
}

/**
 * Tailwind: Zeichenketten (zwischen `'`, `"` und Backtick, auch mehrzeilig) mit einem Farbübergang, deren
 * Klassen nicht genau `duration-[var(--t-color)]` als Dauer haben. Gilt für jeden Text, nicht nur für `className=`.
 */
function tailwindBefunde(datei: string, quelltext: string): Befund[] {
  // Zeilenkommentare und Blockkommentare enthalten Wörter wie „transition“ ohne Klassen zu sein.
  const text = quelltext
    .replaceAll(/\/\*[\s\S]*?\*\//g, leer)
    .replaceAll(/(^|\s)\/\/[^\n]*/g, (treffer) => leer(treffer));
  const befunde: Befund[] = [];
  for (const abschnitt of text.matchAll(/[^'"`]+/g)) {
    const klassen = [...abschnitt[0].matchAll(/\S+/g)].map((k) => ({
      name: k[0],
      index: (abschnitt.index ?? 0) + (k.index ?? 0),
    }));
    // Eigenschaft `[transition:…]`: wie die CSS-Kurzform prüfen.
    for (const klasse of klassen) {
      const eigenschaft = /^(?:[^\s[\]:]+:)*\[transition:(.+)\]$/.exec(klasse.name);
      if (eigenschaft) {
        for (const eintrag of falscheEintraege((eigenschaft[1] ?? '').replaceAll('_', ' '))) {
          befunde.push({
            datei,
            zeile: zeileVon(text, klasse.index),
            text: `${klasse.name} (${eintrag})`,
          });
        }
      }
    }
    const farbe = klassen.filter((klasse) => istFarbuebergang(klasse.name));
    if (farbe.length === 0) continue;
    // Dauer ohne Variante gilt immer; mit Variante (`motion-reduce:duration-0`) ergänzt sie nur.
    const dauern = klassen.map((k) => k.name).filter((name) => /^duration-/.test(name));
    if (dauern.length === 1 && dauern[0] === 'duration-[var(--t-color)]') continue;
    for (const klasse of farbe) {
      befunde.push({
        datei,
        zeile: zeileVon(text, klasse.index),
        text: `${klasse.name} mit ${dauern.length ? dauern.join(' ') : 'Standarddauer (150 ms, nie 0)'}`,
      });
    }
  }
  return befunde;
}

const dateien = quelldateien(SRC).map((pfad) => ({
  pfad,
  datei: relative(SRC, pfad),
  text: readFileSync(pfad, 'utf8'),
}));

const cssBefundeAlle = dateien
  .filter((d) => d.datei.endsWith('.css'))
  .flatMap((d) => cssBefunde(d.datei, d.text));
const tailwindBefundeAlle = dateien
  .filter((d) => /\.tsx?$/.test(d.datei))
  .flatMap((d) => tailwindBefunde(d.datei, d.text));
const langformenAlle = dateien
  .filter((d) => d.datei.endsWith('.css'))
  .flatMap((d) => cssLangformen(d.datei, d.text));

const alsText = (befunde: Befund[]) =>
  befunde.map((b) => `${b.datei}:${b.zeile}: ${b.text}`).sort();

describe('Übergänge auf Farbe, Rand und Schatten nur mit var(--t-color) (B-10, B-34, D-098)', () => {
  it('liest die Quelldateien unter apps/web/src (CSS und TS/TSX), nicht nur className=', () => {
    expect(dateien.filter((d) => d.datei.endsWith('.css')).length).toBeGreaterThan(5);
    expect(dateien.some((d) => d.datei === 'ui/Field.tsx')).toBe(true);
    expect(dateien.some((d) => d.datei.endsWith('.test.ts'))).toBe(false);
    expect(dateien.some((d) => d.datei.endsWith('.test.tsx'))).toBe(false);
  });

  it('hat in keiner CSS-Datei eine Dauer ungleich var(--t-color) an Farbe, Rand oder Schatten', () => {
    const ausnahmen = AUSNAHMEN.map((a) => `${a.datei}|${a.eintrag}`);
    const offen = cssBefundeAlle.filter(
      (b) => !ausnahmen.includes(`${b.datei}|${b.eintrag.replaceAll(/\s+/g, ' ')}`),
    );
    expect(alsText(offen)).toEqual([]);
  });

  it('hat in keiner TS/TSX-Datei einen Farb-, Rand- oder Schattenübergang ohne duration-[var(--t-color)]', () => {
    expect(alsText(tailwindBefundeAlle)).toEqual([]);
  });

  it('nutzt keine Langformen transition-property und transition-duration (der Test wertet nur die Kurzform aus)', () => {
    expect(alsText(langformenAlle)).toEqual([]);
  });

  it('hat für jede Ausnahme noch einen Treffer und eine Begründung (keine toten Ausnahmen)', () => {
    for (const ausnahme of AUSNAHMEN) {
      expect(ausnahme.grund.length, `Begründung fehlt: ${ausnahme.datei}`).toBeGreaterThan(30);
      const treffer = cssBefundeAlle.filter(
        (b) => b.datei === ausnahme.datei && b.eintrag.replaceAll(/\s+/g, ' ') === ausnahme.eintrag,
      );
      expect(treffer.length, `Ausnahme ohne Treffer: ${ausnahme.datei} ${ausnahme.eintrag}`).toBe(
        1,
      );
    }
  });
});

// Der Test muss die bekannten Fehler wirklich sehen: Die Fälle unten sind die Muster aus B-10 und B-34.
describe('Der Erkennungsteil sieht die Fehlermuster', () => {
  it('findet die Klassenkonstante inputClass (Field.tsx) außerhalb von className=', () => {
    const quelle = `const inputClass =
  'lg-field min-h-11 w-full border border-control-edge transition-shadow duration-[var(--t-med)] focus:border-accent';`;
    expect(alsText(tailwindBefunde('x.tsx', quelle))).toEqual([
      'x.tsx:2: transition-shadow mit duration-[var(--t-med)]',
    ]);
  });

  it('findet transition-colors mit --t-slow in einer Vorlagenzeichenkette (StepFrame)', () => {
    const quelle = `className={\`h-1 flex-1 transition-colors duration-[var(--t-slow)] \${index < step ? 'bg-primary' : 'bg-line'}\`}`;
    expect(alsText(tailwindBefunde('x.tsx', quelle))).toHaveLength(1);
  });

  it('findet einen Farbübergang ohne Dauer (Standarddauer 150 ms) und `transition-all`', () => {
    expect(tailwindBefunde('x.tsx', "const a = 'transition-colors hover:bg-sheet';")).toHaveLength(
      1,
    );
    expect(tailwindBefunde('x.tsx', "const a = 'transition-all duration-300';")).toHaveLength(1);
    expect(
      tailwindBefunde('x.tsx', "const a = 'transition duration-[var(--t-fast)]';"),
    ).toHaveLength(1);
    expect(
      tailwindBefunde('x.tsx', "const a = 'transition-[box-shadow,border-color] duration-150';"),
    ).toHaveLength(1);
    expect(
      tailwindBefunde('x.tsx', "const a = '[transition:box-shadow_var(--t-med)_ease]';"),
    ).toHaveLength(1);
  });

  it('lässt var(--t-color), transform und opacity durch', () => {
    const gut = [
      "'transition-shadow duration-[var(--t-color)] focus:shadow-md'",
      "'transition-[box-shadow,border-color,background-color] duration-[var(--t-color)]'",
      "'hover:transition-colors duration-[var(--t-color)]'",
      "'size-4 transition-transform duration-[var(--t-med)] ease-[var(--spring-snap)]'",
      "'transition-opacity duration-[var(--t-slow)]'",
      "'transition-none'",
      "'[transition:box-shadow_var(--t-color)_ease]'",
      "'Text ohne Übergang'",
    ];
    for (const quelle of gut) expect(tailwindBefunde('x.tsx', `const a = ${quelle};`)).toEqual([]);
  });

  it('überspringt Kommentare', () => {
    const quelle = `// transition-colors duration-[var(--t-med)] (Beispiel)
/* transition-shadow */
const a = 1;`;
    expect(tailwindBefunde('x.tsx', quelle)).toEqual([]);
  });

  it('findet CSS-Einträge mit --t-fast, --t-med, --t-slow, Festwert und `all`', () => {
    const css = `.a { transition: transform var(--t-med) var(--spring), background-color var(--t-fast) ease, box-shadow var(--t-med) ease; }
.b { transition: border-color 200ms; }
.c { transition: all var(--t-slow); }
.d { transition: --glow var(--t-slow) var(--ease); }
.e { transition: color var(--t-color); }`;
    expect(cssBefunde('x.css', css).map((b) => b.eintrag)).toEqual([
      'background-color var(--t-fast) ease',
      'box-shadow var(--t-med) ease',
      'border-color 200ms',
      'all var(--t-slow)',
      '--glow var(--t-slow) var(--ease)',
    ]);
  });

  it('lässt CSS mit var(--t-color), transform, opacity, stroke-dashoffset und none durch', () => {
    const css = `/* transition: box-shadow var(--t-med); */
.a { transition: transform var(--t-med) var(--spring), opacity var(--t-med) ease; }
.b { transition:
    background-color var(--t-color) ease,
    box-shadow var(--t-color) ease; }
.c { transition: stroke-dashoffset var(--t-slow) var(--ease); }
.d { transition: none !important; }`;
    expect(cssBefunde('x.css', css)).toEqual([]);
  });
});
