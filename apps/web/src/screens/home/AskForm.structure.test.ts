import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Der Platzhalter der Startseite darf nie mitten im Wort abreißen (shell-home#05). Zweifach gesichert:
 * Der Text in der i18n bleibt kurz genug für die schmalste Spalte (iPhone hoch, 246 px verfügbar),
 * und das Eingabefeld kürzt mit Ellipse statt hart zu beschneiden. Ob das Layout im echten Browser
 * stimmt, kann jsdom nicht messen – das belegt die Browsermessung (pw/agents/m3-t001).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Platzhalter der Startseite bricht nicht mitten im Wort ab (shell-home#05)', () => {
  it('der Platzhaltertext bleibt kurz genug für die schmalste Größe (iPhone hoch, ~246 px)', () => {
    const de = read('i18n/de.ts');
    const placeholder = de.match(/askPlaceholder:\s*'([^']*)'/);
    expect(placeholder).not.toBeNull();
    // 26 Zeichen ≈ 235 px bei 19 px Schrift; der Text muss darunter bleiben.
    expect(placeholder?.[1]?.length ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(26);
    expect(placeholder?.[1]).toBe('Frag, was du willst …');
  });

  it('das Eingabefeld kürzt mit Ellipse-Klasse, nicht hart (kein style=)', () => {
    const form = read('screens/home/AskForm.tsx');
    const input = form.match(/<input[\s\S]*?\/>/);
    expect(input).not.toBeNull();
    expect(input?.[0]).toContain('text-ellipsis');
    expect(input?.[0]).toContain('overflow-hidden');
    expect(input?.[0]).toContain('min-w-0');
    expect(input?.[0]).not.toContain('style=');
  });
});
