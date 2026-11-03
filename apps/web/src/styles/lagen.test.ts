import { readdirSync, readFileSync } from 'node:fs';
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
 * Lagen-Blattstapel bei langen Seiten (Befund B-26, D-078, Kay GF-06 „Drehung begrenzt“): Ein Blatt (`.lg-ply`) ist
 * so hoch wie die Seite und dreht sich um seine Mitte; bei 4800 px und 0,34° wandert eine Ecke um 14 px, das dritte
 * Blatt stand 5 px aus dem Fenster, das erste 6 px links neben dem Blatt. Die Hülle `.lg-plies` ist ein Größen-
 * Container, `--ply-tilt-max` = atan(2 · Abweichung / Diagonale) begrenzt jeden Winkel, damit keine Ecke weiter als
 * `--ply-corner` von ihrer Lage ohne Drehung abweicht. Die Wirkung ist im Echtbrowser gemessen (Chromium und
 * WebKit, ~/pagewise-agent/shots/S-02/1.4/); dieser Test nagelt die Regeln fest.
 */
describe('lagen.css: Drehung der Blätter darunter ist begrenzt (B-26, D-078)', () => {
  const winkel: Array<[string, string, string]> = [
    ['1', 'p1', '0.28deg'],
    ['2', 'p1', '0.3deg'],
    ['2', 'p2', '-0.26deg'],
    ['3', 'p1', '0.34deg'],
    ['3', 'p2', '-0.3deg'],
    ['3', 'p3', '0.22deg'],
  ];

  it('macht die Hülle .lg-plies so groß wie den Stapel und klickdurchlässig', () => {
    const body = regelBlock(lagen, '.lg-plies') ?? '';
    expect(body).toMatch(/position:\s*absolute\b/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/pointer-events:\s*none\b/);
    // Ohne Unterstützung bleibt sie eine gewöhnliche, leere Fläche: der Container steht nur unter @supports.
    expect(body).not.toMatch(/container-type/);
  });

  it('gibt jedem Blatt eine kleine feste Ecken-Grenze: 6 px für Blatt 1 und 2, 4 px für Blatt 3', () => {
    // Wenige Pixel (Kay: „wenige Pixel“). 6 px: so weit wanderten die Ecken vor D-078 auf Seiten des Alltags
    // (bis 5,8 px), dort bleibt das Bild. 4 px beim dritten Blatt: Es liegt 24 px versetzt, auf dem Telefon
    // bleiben bis zum Fensterrand 28 − 24 = 4 px.
    const blatt = regelBlock(lagen, '.lg-ply') ?? '';
    expect(blatt).toMatch(/--ply-corner:\s*6px\b/);
    // Ohne atan2() und Container-Einheiten: keine Grenze (90deg), der Stapel bleibt wie bisher.
    expect(blatt).toMatch(/--ply-tilt-max:\s*90deg\b/);
    expect(regelBlock(lagen, '.lg-ply.lg-p3')).toMatch(/--ply-corner:\s*4px\b/);
    for (const nr of ['p1', 'p2']) {
      expect(regelBlock(lagen, `.lg-ply.lg-${nr}`) ?? '').not.toMatch(/--ply-corner/);
    }
  });

  it('leitet die Grenze aus der Größe der Hülle ab: atan2(2 · Ecke, Diagonale), Container nur mit Unterstützung', () => {
    const start = lagen.indexOf('@supports (transform: rotate(atan2(1px, hypot(1cqw, 1cqh))))');
    expect(start, '@supports fehlt').toBeGreaterThan(-1);
    // Der Block bis zur passenden schließenden Klammer.
    let tiefe = 0;
    let ende = lagen.indexOf('{', start);
    for (; ende < lagen.length; ende++) {
      if (lagen[ende] === '{') tiefe++;
      else if (lagen[ende] === '}' && --tiefe === 0) break;
    }
    const block = lagen.slice(start, ende + 1);
    expect(block).toMatch(/\.lg-plies \{\s*container-type:\s*size;\s*\}/);
    expect(block).toMatch(
      /\.lg-ply \{\s*--ply-tilt-max:\s*atan2\(calc\(var\(--ply-corner\) \* 2\), hypot\(100cqw, 100cqh\)\);\s*\}/,
    );
    // Nach den Grundregeln der Blätter, sonst überstimmte `--ply-tilt-max: 90deg` die Grenze.
    expect(start).toBeGreaterThan(lagen.indexOf('.lg-ply.lg-p3 {'));
    expect(start).toBeGreaterThan(lagen.indexOf('.lg-ply {'));
  });

  it.each(winkel)(
    'begrenzt die Drehung bei Tiefe %s, Blatt %s (heute %s) mit min(…, var(--ply-tilt-max))',
    (tiefe, blatt, grad) => {
      const body = regelBlock(lagen, `.lg-stack[data-depth="${tiefe}"] .lg-${blatt}`) ?? '';
      const betrag = grad.replace('-', '');
      const vorzeichen = grad.startsWith('-') ? ' -1 \\*' : '';
      expect(body).toMatch(
        new RegExp(
          `rotate: calc\\(var\\(--m\\) \\*${vorzeichen} min\\(${betrag.replace('.', '\\.')}, var\\(--ply-tilt-max\\)\\)\\);`,
        ),
      );
    },
  );

  it('behält den Versatz der Blätter in transform und lässt keine Drehung ohne Grenze übrig', () => {
    const versatz = ['6px, 6px', '7px, 7px', '14px, 13px', '8px, 8px', '16px, 14px', '24px, 19px'];
    winkel.forEach(([tiefe, blatt], i) => {
      const body = regelBlock(lagen, `.lg-stack[data-depth="${tiefe}"] .lg-${blatt}`) ?? '';
      expect(body).toContain(`transform: translate(${versatz[i]});`);
      // Keine Drehung mehr in `transform`; jede Drehung (Eigenschaft `rotate`) trägt die Grenze.
      expect(body).not.toMatch(/transform:[^;]*rotate/);
      for (const drehung of body.match(/(?<![-\w])rotate:[^;]*/g) ?? []) {
        expect(drehung).toContain('var(--ply-tilt-max)');
      }
    });
  });

  it('übergibt den Winkel nicht der transition der Blätter: Er folgt der Seitenhöhe und wird beim ersten Anstrich nicht nachgezogen', () => {
    // Die Höhe ist beim ersten Anstrich noch nicht gemessen; mit Übergang schwängen die Blätter von der
    // ungekürzten Schiefe (0,34°) auf die Grenze (bei 4800 px 0,1°) nach. Versatz und Deckkraft bleiben animiert.
    const uebergang = /transition:([^;]*);/.exec(regelBlock(lagen, '.lg-ply') ?? '')?.[1] ?? '';
    expect(uebergang).toMatch(/transform var\(--t-slow\) var\(--spring\)/);
    expect(uebergang).toMatch(/opacity var\(--t-med\)/);
    expect(uebergang).not.toMatch(/rotate|\ball\b/);
  });

  it('lässt die Klemmen und die Ankunft des Blatts unberührt', () => {
    // Die Klemmen (M4-T035) bleiben als Notnagel; die Ankunft hängt am Blatt (.lg-arrive), nicht an den Blättern darunter.
    expect(regelBlock(lagen, '.lg-app')).toMatch(/overflow:\s*clip\b/);
    expect(regelBlock(lagen, '.lg-ply')).toMatch(/overflow:\s*clip\b/);
    expect(regelBlock(lagen, '.lg-ply')).toMatch(
      /transition:[^;]*transform var\(--t-slow\) var\(--spring\)/,
    );
    expect(regelBlock(lagen, '.lg-arrive')).toMatch(/animation:\s*sheet-arrive var\(--t-slow\)/);
  });

  it('setzt keine Hülle .lg-plies in raum.css und atelier.css (dort sind die Blätter ausgeblendet)', () => {
    for (const file of ['raum.css', 'atelier.css']) {
      const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(regelBlock(css, '.lg-plies'), `${file} setzt .lg-plies`).toBeNull();
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

/*
 * Scrim von Dialog und Schublade (Befund B-01, D-086): Ein Scrim mit gefüllter Deckkraft-Animation (`fade … both`)
 * wird in Chromium zur Hintergrundwurzel (Backdrop Root) des Panels. Der `backdrop-filter` des Atelier-Glases sieht
 * dann nur den Scrim und nicht die Seite dahinter, der Seitentext schien scharf durch (gemessen in BT2: Kantenstärke
 * im Panel 1,94 statt 0,39 wie bei „Aus“). Der Scrim blendet darum nur beim Öffnen ein und behält danach keinen
 * Füllmodus (`backwards`). In Raum und Lagen sieht man keinen Unterschied. Atelier legt die Tönung zusätzlich auf eine
 * Ebene ::before (geprüft in `atelier.test.ts`), damit der Blur schon in der Einblendung wirkt. Den Blur selbst
 * kann nur der Browser zeigen (Chromium); dieser Test nagelt die Bauweise fest.
 */
describe('lagen.css: Scrim von Dialog und Schublade ohne gefüllte Deckkraft-Animation (B-01, D-086)', () => {
  const tsx = (file: string) => readFileSync(join(dir, '..', file), 'utf8');

  /** Alle flachen Regeln einer Stylesheet-Datei (auch in @layer), ohne Kommentare. */
  const regeln = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selector: (match[1] as string).trim(),
      body: match[2] as string,
    }));

  it('blendet die Tönung des Scrims beim Öffnen mit `fade` über --t-med ein und füllt danach nicht (backwards)', () => {
    const body = regelBlock(lagen, '.lg-scrim') ?? '';
    const animation = /animation:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '';
    expect(animation).toBe('fade var(--t-med) backwards');
    expect(animation).not.toMatch(/\b(both|forwards)\b/);
    expect(animation).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
  });

  it('hält die Tönung im Wert wie bisher (rgba(var(--shadow), 0.45)) und legt sie in --scrim ab', () => {
    const body = regelBlock(lagen, '.lg-scrim') ?? '';
    expect(body).toContain('--scrim: rgba(var(--shadow), 0.45)');
    expect(body).toMatch(/background:\s*var\(--scrim\)/);
  });

  it('lässt `fade` ein reines Einblenden bleiben (nur from, Endwert ist die Deckkraft 1)', () => {
    const motion = readFileSync(join(dir, 'motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(motion).toMatch(/@keyframes fade \{\s*from \{\s*opacity: 0;\s*\}\s*\}/);
  });

  it('hat in keinem Stylesheet eine Regel, die den Scrim selbst mit both oder forwards animiert', () => {
    const dateien = readdirSync(dir).filter((name) => name.endsWith('.css'));
    expect(dateien).toContain('lagen.css');
    for (const name of dateien) {
      for (const regel of regeln(readFileSync(join(dir, name), 'utf8'))) {
        const trifftScrim = regel.selector.split(',').some((teil) => {
          const letzter =
            teil
              .trim()
              .split(/[\s>+~]+/)
              .pop() ?? '';
          return letzter.includes('.lg-scrim') && !letzter.includes('::');
        });
        if (!trifftScrim) continue;
        expect(regel.body, `${name}: ${regel.selector}`).not.toMatch(
          /animation(-fill-mode)?:[^;]*\b(both|forwards)\b/,
        );
      }
    }
  });

  it('setzt am Scrim im Markup nur beim Schließen eine Animation (Schublade, both ist dort erlaubt), im Dialog nie', () => {
    const modal = /className="(lg-scrim[^"]*)"/.exec(tsx('ui/modal.tsx'))?.[1] ?? '';
    expect(modal).toContain('lg-scrim');
    expect(modal).not.toContain('animate-');

    const drawer = tsx('shell/Drawer.tsx');
    const vorSchliessen = /className=\{`(lg-scrim[^`]*?)\$\{closing/.exec(drawer)?.[1] ?? '';
    expect(vorSchliessen).toContain('lg-scrim');
    expect(vorSchliessen).not.toContain('animate-');
    expect(drawer).toMatch(/closing \? 'pointer-events-none animate-\[lg-fade-out_/);
  });

  it('nimmt dem Scrim bei „Aus“ die Animation mit der allgemeinen Regel (auch für ::before)', () => {
    const motion = readFileSync(join(dir, 'motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const aus = regeln(motion).find((regel) => regel.selector.includes(':root.fx-off *::before'));
    expect(aus?.body).toMatch(/animation:\s*none\s*!important/);
  });
});
