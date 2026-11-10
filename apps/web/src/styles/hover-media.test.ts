import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Hover-Zustände dürfen auf Touch nicht kleben bleiben (static-css#04): Überschreibungen des Hovers von
 * `.lg-slip`/`.lg-row` in den Designrichtungen stehen deshalb — wie in lagen.css — hinter
 * `@media (hover: hover)`. Dieser Test liest den Quelltext und nagelt das fest.
 *
 * D-109 weitet die Regel auf jede Stildatei und jeden Selektor aus: `.lg-chip:hover` (lagen.css) und der Griff
 * des Datei-Panels (screens.css) standen außerhalb der Abfrage und blieben unbemerkt, weil der Test nur
 * raum.css und atelier.css und dort nur Zeilen und Karten ansah.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

type Regel = { selector: string; medias: string[] };

/** Läuft durch das CSS und sammelt Stilregeln mit dem Pfad der sie umschließenden @media-Blöcke. */
function regeln(css: string): Regel[] {
  const gefundene: Regel[] = [];
  const offen: string[] = [];
  const medias: string[] = [];
  let text = '';
  for (const zeichen of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (zeichen === '{') {
      const vorspann = text.trim();
      text = '';
      if (!vorspann.startsWith('@')) {
        gefundene.push({ selector: vorspann, medias: [...medias] });
      }
      offen.push(vorspann);
      if (vorspann.startsWith('@media')) medias.push(vorspann);
    } else if (zeichen === '}') {
      const vorspann = offen.pop();
      if (vorspann?.startsWith('@media')) medias.pop();
      text = '';
    } else {
      text += zeichen;
    }
  }
  return gefundene;
}

const hoverRegeln = (file: string) =>
  regeln(read(file)).filter(
    (regel) => /:hover/.test(regel.selector) && /\.lg-(slip|row)\b/.test(regel.selector),
  );

describe.each([
  // Raum: 2 statt 3, seit der Zettel „Nächster Test“ dort keinen Hover mehr hat (D-116, Kay am 7. November 2026:
  // nicht klickbar, also ruhig). Übrig bleiben die Zeile und ihre Trennlinien; beide stehen hinter der Maus-Abfrage.
  ['raum.css', 2],
  ['atelier.css', 4],
])('%s: Hover von Zeilen und Karten', (file, anzahl) => {
  const hovers = hoverRegeln(file);

  it('hat Hover-Regeln zu .lg-slip/.lg-row, die der Test sieht', () => {
    expect(hovers).toHaveLength(anzahl);
  });

  it('steckt jede .lg-slip/.lg-row-Hover-Regel in @media (hover: hover)', () => {
    for (const regel of hovers) {
      expect(regel.medias, `außerhalb von @media (hover: hover): ${regel.selector}`).toContain(
        '@media (hover: hover)',
      );
    }
  });
});

const dateien = readdirSync(dir).filter((file) => file.endsWith('.css'));
const alleHover = (file: string) =>
  regeln(read(file)).filter((regel) => /:hover/.test(regel.selector));
const hinterMaus = (regel: Regel) => regel.medias.some((media) => /\(hover: hover\)/.test(media));

describe('Hover nur mit echter Maus, in jeder Stildatei (D-109)', () => {
  it('sieht die Hover-Regeln aller Stildateien', () => {
    expect(dateien).toEqual(expect.arrayContaining(['lagen.css', 'raum.css', 'atelier.css']));
    // 27 statt 28: Raum hat seit D-116 keine Hover-Regel am Zettel „Nächster Test“ mehr (nicht klickbar).
    expect(dateien.flatMap(alleHover).length).toBeGreaterThanOrEqual(27);
  });

  it.each(dateien)('%s: jede :hover-Regel steht in @media (hover: hover)', (file) => {
    for (const regel of alleHover(file)) {
      expect(hinterMaus(regel), `außerhalb von @media (hover: hover): ${regel.selector}`).toBe(
        true,
      );
    }
  });

  it.each(dateien)(
    '%s: kein Fokus- oder Gedrückt-Zustand steckt mit in der Maus-Abfrage',
    (file) => {
      // Teilt sich ein Selektor die Regel mit :hover, gälte er auf dem iPad nie.
      for (const regel of alleHover(file)) {
        for (const teil of regel.selector.split(',')) {
          if (/:(focus-visible|active)/.test(teil)) {
            expect(teil, `ohne :hover in der Maus-Abfrage: ${teil.trim()}`).toMatch(/:hover/);
          }
        }
      }
    },
  );

  it('lässt Tailwinds hover:-Klassen hinter (hover: hover): Version 4, keine eigene Variante', () => {
    const paket = JSON.parse(readFileSync(join(dir, '..', '..', 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(paket.devDependencies.tailwindcss).toMatch(/^[\^~]?4\./);
    for (const file of dateien) {
      expect(read(file), file).not.toMatch(/@(custom-)?variant\s+hover\b/);
    }
  });
});
