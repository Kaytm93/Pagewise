import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Feinschliff der Richtung „Lagen“ (Abgleich mit Mockup A). lagen.css ist die Grundlage von raum.css und
 * atelier.css: Was nur „Lagen“ betrifft, steht unter `:root[data-design="lagen"]`, sonst verändert es die
 * anderen Richtungen. Die Tests lesen den Quelltext und nageln Zuordnung und Werte fest; wie es aussieht,
 * zeigt nur ein Browser-Lauf.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  readFileSync(join(dir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll('"', "'")
    .replaceAll(/\s+/g, ' ');

const LAGEN = ":root[data-design='lagen']";
const lagen = read('lagen.css');
const motion = read('motion.css');

interface Rule {
  selector: string;
  body: string;
}

/** Alle Regeln (ohne Keyframes), auch in @media und @layer, mit ihrer Selektorliste und ihrem Rumpf. */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1).trim();
      if (prelude.startsWith('@keyframes')) {
        // Keyframes sind keine Selektoren.
      } else if (prelude.startsWith('@')) {
        walk(body);
      } else {
        found.push({ selector: prelude, body });
      }
      i = j;
    }
  };
  walk(css);
  return found;
}

const lagenRules = rules(lagen);
const rule = (selector: string) => {
  const hit = lagenRules.find((entry) => entry.selector === selector);
  if (!hit) throw new Error(`Regel fehlt in lagen.css: ${selector}`);
  return hit.body;
};
const keyframes = (css: string, name: string) => {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start === -1) throw new Error(`Keyframe fehlt: ${name}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`Keyframe nicht geschlossen: ${name}`);
};

describe('lagen.css: nur Lagen betrifft, steht unter dem Richtungs-Selektor', () => {
  const NUR_LAGEN = [
    'lg-recent',
    'lg-motif-stroke',
    'lg-register',
    'lg-seg-wide',
    'lg-composer-field > button',
    'lg-tool-check',
  ];

  it.each(NUR_LAGEN)('hat jede Regel zu „%s“ den Selektor :root[data-design="lagen"]', (name) => {
    const betroffen = lagenRules.filter((entry) => entry.selector.includes(name));
    expect(betroffen.length).toBeGreaterThan(0);
    for (const entry of betroffen) {
      for (const teil of entry.selector.split(',')) {
        expect(teil.trim().startsWith(LAGEN), teil).toBe(true);
      }
    }
  });

  it('lässt die gemeinsamen Grundregeln .lg-sheet, .lg-stack und .lg-aside unberührt vom neuen Rand', () => {
    for (const grund of ['.lg-sheet', '.lg-stack', '.lg-aside']) {
      for (const entry of lagenRules.filter((e) => e.selector === grund)) {
        expect(entry.body, grund).not.toMatch(/padding-left|margin-left|z-index|--stack-space/);
      }
    }
  });
});

describe('lagen.css: Stapel und Rand (Mockup A: 14/30/30/0, Blatt 16 px unter dem Heftrücken)', () => {
  const MD = `${LAGEN} .lg-app #main`;

  it('setzt den Rand ab „md“ auf oben 14, rechts 30, unten 30, links 0 und schiebt das Blatt 16 px unter den Rücken', () => {
    const body = rule(MD);
    expect(body).toContain('padding-block: 14px 30px');
    expect(body).toContain('padding-inline: 0 max(30px, env(safe-area-inset-right))');
    expect(body).toContain('margin-left: calc(var(--sheet-under) * -1)');
    expect(rule(LAGEN)).toBeTruthy();
    expect(lagen).toContain('--sheet-under: 16px');
  });

  it('legt den Heftrücken über das Blatt und gleicht die 16 px im Blatt aus', () => {
    expect(rule(`${LAGEN} .lg-aside`)).toContain('z-index: 1');
    expect(rule(`${LAGEN} .lg-sheet`)).toContain('padding-left: var(--sheet-under)');
  });

  it('zieht den Mehr-Rand unten von der Mindesthöhe des Blatts ab (30 − 14 = 16 px)', () => {
    expect(rule(`${LAGEN} .lg-stack`)).toContain('--stack-space: 16px');
  });

  it('gilt nur ab 768 px', () => {
    const start = lagen.indexOf(`${MD} {`);
    const davor = lagen.slice(0, start);
    expect(davor.lastIndexOf('@media (min-width: 768px)')).toBeGreaterThan(
      davor.lastIndexOf('@media (min-width: 768px) and (max-width: 1023.98px)'),
    );
  });
});

describe('lagen.css: Startseite', () => {
  it('lässt die Jetzt-Linie wachsen und die Marke einblenden, beides an --m gebunden', () => {
    expect(rule('.lg-now-marker::after')).toMatch(
      /animation: lg-line-in calc\(var\(--t-slow\) \* 1\.6\)/,
    );
    expect(rule('.lg-now-marker::after')).toContain('transform-origin: left');
    expect(rule('.lg-now-marker-label')).toContain('animation: rise var(--t-slow)');
    expect(keyframes(motion, 'lg-line-in')).toContain('var(--m)');
  });

  it('hat eine Pausenzeile mit gepunkteter Linie und leiser Schrift', () => {
    const body = rule('.lg-lesson-break');
    expect(body).toContain('1px dotted var(--line-warm)');
    expect(body).toContain('color: var(--ink-muted)');
  });

  it('zeichnet die Unterstreichung der Überschrift in der Fachfarbe mit --t-slow', () => {
    const body = rule(`${LAGEN} .lg-app[data-view='home'] .lg-sheet h1::after`);
    expect(body).toContain('background: var(--subj)');
    expect(body).toContain('animation: lg-line-in calc(var(--t-slow)');
    expect(body).toContain('transform-origin: left');
  });

  it('macht den ersten Eintrag von „Zuletzt genutzt“ groß (28 px, 84 px hoch) und die übrigen kleiner (20 px)', () => {
    expect(rule(`${LAGEN} .lg-recent-subject`)).toContain('font-size: 1.25rem');
    expect(rule(`${LAGEN} .lg-recent > li:first-child .lg-row`)).toContain('min-height: 5.25rem');
    expect(rule(`${LAGEN} .lg-recent > li:first-child .lg-recent-icon`)).toContain(
      'width: 1.875rem',
    );
    const gross = lagenRules.filter(
      (entry) => entry.selector === `${LAGEN} .lg-recent > li:first-child .lg-recent-subject`,
    );
    expect(gross.map((entry) => /font-size: (1\.5625|1\.75)rem/.exec(entry.body)?.[1])).toEqual([
      '1.5625',
      '1.75',
    ]);
  });
});

describe('lagen.css: Fachkopf, Reiter, Chat, Einstellungen', () => {
  it('zeichnet das Fachmotiv mit dasharray 1 und dem Keyframe draw; Reduziert blendet ein, Aus steht fertig', () => {
    const body = rule(`${LAGEN} .lg-motif-stroke`);
    expect(body).toContain('stroke-dasharray: 1');
    expect(body).toMatch(/animation: draw calc\(var\(--t-slow\) \* 2\)/);
    expect(rule(`${LAGEN}.fx-reduced .lg-motif-stroke`)).toContain('animation: fade var(--t-med)');
    expect(rule(`${LAGEN}.fx-reduced .lg-motif-stroke`)).toContain('stroke-dasharray: none');
    expect(rule(`${LAGEN}.fx-off .lg-motif-stroke`)).toContain('stroke-dasharray: none');
  });

  it('macht den gewählten Reiter zum Mappenreiter: Blattfarbe, Fachbalken oben, kein Unterstrich', () => {
    const tab = `${LAGEN} .lg-register [role='tab']`;
    expect(rule(tab)).toContain('border-width: 1px 1px 0');
    const gewaehlt = rule(`${tab}[aria-selected='true']`);
    expect(gewaehlt).toContain('background: var(--sheet)');
    expect(gewaehlt).not.toContain('var(--paper)');
    const balken = rule(`${tab}[aria-selected='true']::before`);
    expect(balken).toContain('top: 0');
    expect(balken).toContain('background: var(--subj)');
    expect(rule(`${tab}[aria-selected='true']::after`)).toContain('background: var(--sheet)');
  });

  it('gibt der Sende- und Stopp-Taste im Composer den Radius 12 px', () => {
    expect(rule(`${LAGEN} .lg-composer-field > button`)).toContain('border-radius: 12px');
  });

  it('zeigt den Schalter in Blattfarbe auf Papier und trägt den Zustand zusätzlich im Rand (≥ 3 : 1)', () => {
    const spur = rule(`${LAGEN} .lg-seg-wide`);
    expect(spur).not.toMatch(/background/);
    const streifen = rule(`${LAGEN} .lg-seg-wide::before`);
    expect(streifen).not.toMatch(/background/);
    expect(streifen).toContain('0 0 0 1px var(--control-edge)');
    // Die Grundregel liefert Papier als Spur und Blatt als Streifen.
    expect(rule('.lg-seg')).toContain('background: var(--paper)');
    expect(rule('.lg-seg::before')).toContain('background: var(--sheet)');
  });

  it('setzt die Überschrift der Einstellungen auf 44 px und lässt sie auf dem Telefon kleiner werden', () => {
    const body = rule(`${LAGEN} .lg-app[data-view='settings'] .lg-sheet h1`);
    expect(body).toContain('2.75rem');
    expect(body).toContain('clamp(');
    expect(body).toContain('letter-spacing: -0.03em');
  });
});

describe('motion.css: Ankunft des neuen Blatts in „Lagen“', () => {
  const zahlen = (text: string) =>
    [...text.matchAll(/\* (-?[0-9.]+)(%|deg|px)/g)].map((m) => Number(m[1]));

  it('ist spürbar größer als die Grundlage, bleibt aber an --m gebunden', () => {
    const alt = zahlen(keyframes(motion, 'sheet-arrive'));
    const neu = zahlen(keyframes(motion, 'lg-sheet-arrive'));
    expect(alt).toEqual([1.2, -1.6, 0.7]);
    expect(neu).toEqual([3.5, -5, 2]);
    expect(keyframes(motion, 'lg-sheet-arrive')).toContain('var(--m)');
    expect(keyframes(motion, 'lg-sheet-under')).toContain('calc(var(--m) * 14px)');
    // ruhig: deutlich weniger als das Mockup für das abziehende Blatt (5 % / -7 % / 3°)
    expect(Math.abs(neu[0] ?? 99)).toBeLessThan(5);
    expect(Math.abs(neu[1] ?? 99)).toBeLessThan(7);
    expect(Math.abs(neu[2] ?? 99)).toBeLessThan(3);
  });

  it('gilt nur in „Lagen“, dreht um den oberen Rand und blendet getrennt ein', () => {
    for (const richtung of ['fwd', 'back']) {
      const hit = rules(motion).find(
        (entry) => entry.selector === `${LAGEN} .lg-arrive[data-dir='${richtung}']`,
      );
      expect(hit, richtung).toBeTruthy();
      expect(hit?.body).toContain('transform-origin: 50% 0');
      expect(hit?.body).toContain('fade var(--t-med) ease-out both');
    }
    // Die Grundregeln für alle Richtungen bleiben, wie sie waren.
    expect(motion).toContain(
      ".lg-arrive[data-dir='back'] { animation: sheet-arrive var(--t-slow) var(--spring) both; }",
    );
  });
});
