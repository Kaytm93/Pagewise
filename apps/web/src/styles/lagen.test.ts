import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Die schiefen Deko-Ebenen (`.lg-ply`, translate + rotate) dürfen die Seite nicht breiter machen
 * (M4-T035): Die Drehung vergrößert die Box der Ebene — bei langen Seiten kippte die rechte Kante
 * über den Fensterrand und erzeugte einen waagerechten Scroll (395/390 px bei iPhone-hoch). Der Fix
 * klemmt an zwei Stellen in lagen.css: die App-Fläche `.lg-app` (Anker der Ebene) und die Ebene
 * selbst. Dieser Test liest den Quelltext und nagelt das fest; die Wirkung ist im Echtbrowser
 * gemessen (Chromium und WebKit, siehe ~/pagewise-agent/logs/bericht-m4-t035.md).
 */

const dir = dirname(fileURLToPath(import.meta.url));
const lagen = readFileSync(join(dir, 'lagen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Text der Deklarationen der ersten Regel mit genau diesem Selektor, auch innerhalb von @-Blöcken. */
function regelBlock(css: string, selector: string): string | null {
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf('{', i);
    if (start === -1) return null;
    const vorspann = css.slice(i, start).trim();
    let tiefe = 1;
    let j = start + 1;
    while (j < css.length && tiefe > 0) {
      if (css[j] === '{') tiefe++;
      else if (css[j] === '}') tiefe--;
      j++;
    }
    const body = css.slice(start + 1, j - 1);
    if (vorspann.startsWith('@')) {
      const innen = regelBlock(body, selector);
      if (innen !== null) return innen;
    } else if (vorspann === selector) {
      return body;
    }
    i = j;
  }
  return null;
}

describe('lagen.css: Deko-Schiefe ist eingeklemmt (M4-T035)', () => {
  it('klemmt die App-Fläche .lg-app mit overflow: clip', () => {
    expect(regelBlock(lagen, '.lg-app')).toMatch(/overflow:\s*clip\b/);
  });

  it('klemmt die Deko-Ebene .lg-ply selbst mit overflow: clip', () => {
    expect(regelBlock(lagen, '.lg-ply')).toMatch(/overflow:\s*clip\b/);
  });

  it('berschreibt .lg-app und .lg-ply in raum.css und atelier.css nicht', () => {
    for (const file of ['raum.css', 'atelier.css']) {
      const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const selector of ['.lg-app', '.lg-ply']) {
        expect(regelBlock(css, selector), `${file} setzt ${selector}`).toBeNull();
      }
    }
  });
});
