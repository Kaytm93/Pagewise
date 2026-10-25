import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * WP1b: gemeinsame Bildschirm-Bausteine in screens.css. jsdom wertet CSS nicht aus, darum liest dieser
 * Test den Quelltext und nagelt Token, Haken-Zeichnung und die Einbindung fest.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(dir, 'screens.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Deklarationen der ersten Regel mit genau diesem Selektor (erste Ebene innerhalb des Textes). */
function body(selector: string, from = css): string {
  const start = from.indexOf(`${selector} {`);
  expect(start, `Regel fehlt: ${selector}`).toBeGreaterThanOrEqual(0);
  return from.slice(start + selector.length + 2, from.indexOf('}', start));
}

describe('screens.css ist eingebunden', () => {
  it('app.css importiert sie nach motion.css und vor den Richtungen', () => {
    const app = readFileSync(join(dir, 'app.css'), 'utf8');
    const motion = app.indexOf('@import "./motion.css"');
    const screens = app.indexOf('@import "./screens.css"');
    expect(screens).toBeGreaterThan(motion);
    expect(screens).toBeLessThan(app.indexOf('@import "./lagen.css"'));
  });
});

describe('--subject-h1', () => {
  it('startet für alle Richtungen auf dem Telefon bei 28 bis 34 px (subject#06)', () => {
    expect(body(':root')).toContain('--subject-h1: clamp(28px, 8vw, 34px)');
  });

  it('wird ab 768 px je Richtung fließend gesetzt', () => {
    const media = css.slice(css.indexOf('@media (min-width: 48rem)'));
    expect(body(':root', media)).toContain('--subject-h1: clamp(38px, 5.2vw, 60px)');
    expect(body(':root[data-design="lagen"]', media)).toContain(
      '--subject-h1: clamp(40px, 5.4vw, 64px)',
    );
    expect(body(':root[data-design="atelier"]', media)).toContain(
      '--subject-h1: clamp(38px, 5vw, 56px)',
    );
  });
});

describe('Haken eines erledigten Schritts (.lg-tool-check)', () => {
  const rule = body('.lg-tool-check path');

  it('wird als Strich gezeichnet und steht im Endzustand fertig da', () => {
    expect(rule).toContain('stroke-dasharray: 1 2');
    expect(rule).toContain('stroke-dashoffset: 0');
    expect(rule).toContain('animation: tool-check-draw var(--t-med) var(--ease) both');
  });

  it('hängt die Bewegung an --m: bei „Reduziert“ nur Überblenden, ohne Weg', () => {
    const frames = body('@keyframes tool-check-draw');
    const from = frames.slice(frames.indexOf('from'));
    expect(from).toContain('stroke-dashoffset: var(--m)');
    expect(from).toContain('opacity: var(--m)');
  });
});

describe('Effektstufen-Liste', () => {
  it('hat eine Grundregel für alle Richtungen', () => {
    expect(body('.lg-fx-list')).toContain('display: grid');
  });
});
