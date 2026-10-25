import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * subject#06: Der Fachname brach bei schmalen Breiten mitten im Wort („Mathemati/k“), weil
 * `break-words` ohne `hyphens` sofort an beliebiger Stelle umbricht. jsdom kann Zeilenumbrüche
 * nicht messen — dieser Quelltext-Test nagelt die Klassen fest (Polster rechts, Schrift-Clamps,
 * lang + hyphens-auto). Ob „Mathematik“ wirklich einzeilig bleibt, belegt die Browsermessung
 * (pw/agents/m4-t002, 390/800/820 px, Chromium + WebKit, vorher/nachher).
 */

const root = join(dirname(fileURLToPath(import.meta.url)));
const quelle = readFileSync(join(root, 'SubjectPage.tsx'), 'utf8');
const kopf = readFileSync(join(root, 'lagen', 'SubjectHead.tsx'), 'utf8');
const screensCss = readFileSync(join(root, '..', 'styles', 'screens.css'), 'utf8');

/** Klassenzeichenkette des <h1 … className="…"> in SubjectPage.tsx. */
function h1Klassen(src: string): string {
  const h1 = src.match(/<h1\b[\s\S]*?<\/h1>/);
  expect(h1, '<h1> in SubjectPage.tsx gefunden').toBeTruthy();
  const m = h1?.[0].match(/className="?`([^`]*)`"?|className="([^"]*)"/);
  expect(m, 'className am <h1> gefunden').toBeTruthy();
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

describe('Fachname (H1) bricht nicht mitten im Wort (subject#06)', () => {
  const klassen = h1Klassen(quelle);

  it('trennt mit Silbentrennung statt an beliebiger Stelle', () => {
    expect(klassen).toContain('hyphens-auto');
    expect(klassen).toContain('break-words');
  });

  it('trägt lang="de", damit die Trennregeln der Sprache gelten', () => {
    const h1 = String(quelle.match(/<h1\b[\s\S]*?<\/h1>/) ?? '');
    expect(h1).toMatch(/lang="de"/);
  });

  it('gibt dem Blattmotiv rechts Platz, aber weniger als 96 px auf dem Telefon', () => {
    // Die Größe des Fach-Wappenbilds (84 px) ist die Untergrenze; pr-24 (96 px) war zu viel.
    expect(quelle).toContain('pr-[88px]');
    expect(quelle).not.toContain('pr-24');
  });

  it('nimmt die Größe aus dem Token --subject-h1, in beiden Köpfen (WP1b)', () => {
    expect(klassen).toContain('text-[length:var(--subject-h1)]');
    expect(h1Klassen(kopf)).toContain('text-[length:var(--subject-h1)]');
    expect(klassen).not.toMatch(/text-\[clamp/);
  });

  it('startet auf dem Telefon mit 28 px statt 40 px Mindestschrift (clamp im Token)', () => {
    expect(screensCss).toMatch(/:root \{\s*--subject-h1: clamp\(28px, 8vw, 34px\);/);
  });

  it('setzt ab 768 px je Richtung eine eigene Spanne (Lagen 40 bis 64 px, Atelier 38 bis 56 px)', () => {
    expect(screensCss).toContain('--subject-h1: clamp(40px, 5.4vw, 64px)');
    expect(screensCss).toContain('--subject-h1: clamp(38px, 5vw, 56px)');
    expect(screensCss).toContain('--subject-h1: clamp(38px, 5.2vw, 60px)');
  });

  it('bedienflächen bleiben unberührt: min-h-11 / size-11 stehen weiter', () => {
    // Geist/Knopfflächen ≥ 44 px (Regel 6) — der Fix fasst nur die H1-Stelle an.
    expect(quelle).toContain('size-11 shrink-0');
    expect(quelle).toContain('min-h-11');
  });
});
