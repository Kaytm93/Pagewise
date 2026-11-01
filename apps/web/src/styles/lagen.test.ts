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

/*
 * Kopf der schmalen Breite in „Lagen“ (D-076, Befund B-18): in Ruhe ohne Fläche, nach wenigen Pixeln Scrollen
 * deckend im Ton des bisherigen Bandes. Den Zustand setzt `ui/scrolled.ts` als Attribut `data-scrolled`.
 * Die Basisregel `.lg-mobilkopf` (var(--desk)) bleibt für Raum und Atelier, die darauf aufbauen.
 */
describe('lagen.css: Kopf der schmalen Breite bekommt die Fläche erst beim Scrollen (D-076)', () => {
  const kopf = ':root[data-design="lagen"] .lg-mobilkopf';
  const flaeche = `${kopf}::before`;
  const gescrollt = `${kopf}[data-scrolled]::before`;

  it('lässt den Kopf in Lagen in Ruhe ohne Fläche, Rand und Schatten', () => {
    const body = regelBlock(lagen, kopf) ?? '';
    expect(body).toMatch(/background-color:\s*transparent\b/);
    expect(body).toMatch(/border:\s*0\b/);
    expect(body).toMatch(/box-shadow:\s*none\b/);
  });

  it('legt die Fläche als Ebene hinter den Inhalt des Kopfes, in Ruhe unsichtbar', () => {
    const body = regelBlock(lagen, flaeche) ?? '';
    expect(body).toContain('content: ""');
    expect(body).toMatch(/position:\s*absolute\b/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/z-index:\s*-1\b/);
    expect(body).toContain('background-color: var(--desk)');
    expect(body).toMatch(/opacity:\s*0\b/);
    expect(body).toMatch(/pointer-events:\s*none\b/);
  });

  it('macht die Fläche mit data-scrolled deckend', () => {
    const body = regelBlock(lagen, gescrollt) ?? '';
    expect(body).toMatch(/opacity:\s*1\b/);
  });

  it('animiert die Fläche nur über opacity, mit --t-color (0 ms bei „Reduziert“ und „Aus“)', () => {
    const body = regelBlock(lagen, flaeche) ?? '';
    const transitions = [...body.matchAll(/transition:\s*([^;]+);/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(transitions).toEqual(['opacity var(--t-color)']);
    expect(body).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
  });

  it('nutzt für die Fläche nur Tokens, keine festen Farben', () => {
    for (const selector of [kopf, flaeche, gescrollt]) {
      expect(regelBlock(lagen, selector) ?? '').not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  it('behält die Basisfläche var(--desk) für Raum und Atelier, die darauf aufbauen', () => {
    expect(regelBlock(lagen, '.lg-mobilkopf')).toContain('background-color: var(--desk)');
  });

  // Seit Schritt 1.3b (D-076) hängt auch Atelier sein Glas an `data-scrolled` (Regel auf `header.sticky.md:hidden::before`,
  // geprüft in `atelier.test.ts`). Die Erwartung „Atelier kennt das Attribut nicht“ war damit durch die Entscheidung
  // veraltet. Raum bleibt ohne Attribut; die Ebene `.lg-mobilkopf::before` setzt weiterhin nur Lagen.
  it('gilt das Attribut nur in Lagen und Atelier: Raum kennt es nicht', () => {
    const raum = readFileSync(join(dir, 'raum.css'), 'utf8');
    expect(raum, 'raum.css nennt data-scrolled').not.toContain('data-scrolled');
  });

  it('setzt die Ebene .lg-mobilkopf::before nur in Lagen: Raum und Atelier nicht', () => {
    for (const file of ['raum.css', 'atelier.css']) {
      const css = readFileSync(join(dir, file), 'utf8');
      expect(css, `${file} setzt .lg-mobilkopf::before`).not.toMatch(/\.lg-mobilkopf::before/);
    }
  });

  it('wird in der AppShell am Kopf gestartet, der die Klasse lg-mobilkopf trägt', () => {
    const shell = readFileSync(join(dir, '../shell/AppShell.tsx'), 'utf8');
    expect(shell).toContain("import { startScrolledState } from '../ui/scrolled'");
    expect(shell).toContain("querySelector<HTMLElement>('.lg-mobilkopf')");
    expect(shell).toContain('startScrolledState(header)');
  });
});
