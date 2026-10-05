import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Hover-Zustände dürfen auf Touch nicht kleben bleiben (static-css#04): Überschreibungen des Hovers von
 * `.lg-slip`/`.lg-row` in den Designrichtungen stehen deshalb — wie in lagen.css — hinter
 * `@media (hover: hover)`. Dieser Test liest den Quelltext und nagelt das fest.
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
  ['raum.css', 2],
  ['atelier.css', 2],
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
