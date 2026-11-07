import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * B-17 (D-097): Das Auswahlzeichen der Anbieter-Zeilen (Radioknopf, size-6) schrumpfte in der Flex-Zeile ungleich,
 * je nach Länge des Textes daneben: 13 bis 22 px breit. Mit shrink-0 bleibt es 24 px. Das Ziel ist die ganze Zeile
 * (min-h-14), die bleibt wie sie ist. jsdom misst kein Layout; dieser Test prüft die Klassen am Quelltext, die
 * Breiten kommen aus der Browsermessung.
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ProviderStep.tsx'),
  'utf8',
);

describe('Anbieter-Zeilen im Onboarding: gleich große Auswahlzeichen', () => {
  it('jeder Optionsknopf (Radioknopf) trägt size-6 und shrink-0', () => {
    const radios = (source.match(/<input\b[\s\S]*?\/>/g) ?? []).filter((tag) =>
      tag.includes('type="radio"'),
    );
    expect(radios.length).toBeGreaterThan(0);
    for (const tag of radios) {
      expect(tag).toMatch(/className="[^"]*\bsize-6\b[^"]*"/);
      expect(tag).toMatch(/className="[^"]*\bshrink-0\b[^"]*"/);
    }
  });
});
