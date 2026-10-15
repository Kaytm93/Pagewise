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

  it('startet auf dem Telefon mit 28 px statt 40 px Mindestschrift (clamp)', () => {
    expect(klassen).toMatch(/text-\[clamp\(28px,8vw,34px\)\]/);
  });

  it('steigt ab md weniger steil (3,9 vw statt 6,4 vw, Deckel 48 px statt 64 px)', () => {
    expect(klassen).toMatch(/md:text-\[clamp\(28px,3\.9vw,48px\)\]/);
  });

  it('bedienflächen bleiben unberührt: min-h-11 / size-11 stehen weiter', () => {
    // Geist/Knopfflächen ≥ 44 px (Regel 6) — der Fix fasst nur die H1-Stelle an.
    expect(quelle).toContain('size-11 shrink-0');
    expect(quelle).toContain('min-h-11');
  });
});
