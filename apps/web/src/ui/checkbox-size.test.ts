import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Checkboxen und Radioknöpfe sind die sichtbare Bedienfläche ihrer Zeile und mindestens 24 px
 * groß (M3-T027, M3-T032); die umgebende label-Zeile bleibt mit mindestens 44 px (min-h-11)
 * beziehungsweise 56 px (min-h-14, zweizeilig im Onboarding) antippbar.
 * jsdom misst kein Layout, daher Strukturtest am Quelltext; die echten Maße kommen aus der
 * Browsermessung (pw/agents/m3-t027, pw/agents/m3-t032).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const BOX_FILES = [
  'ui/Field.tsx',
  'screens/providers/ModelListEditor.tsx',
  'screens/subjects/TemplatePicker.tsx',
  'screens/onboarding/ProviderStep.tsx',
];

describe('Checkboxgröße', () => {
  for (const file of BOX_FILES) {
    it(`${file}: Kästchen 24 px (size-6), kein size-5 mehr, Zeile ab 44 px`, () => {
      const source = read(file);
      expect(source).toMatch(/type="(?:checkbox|radio)"/);
      expect(source).toMatch(/size-6[^>]*accent-primary|accent-primary[^>]*size-6/);
      expect(source).not.toMatch(/type="(?:checkbox|radio)"[^>]*size-5/);
      expect(source).toMatch(/min-h-(?:11|14)/);
    });
  }

  it('Record verdeckt alle Dateien mit Kästchen im Quelltext', () => {
    // Verallgemeinerung (M3-T032): Neue Treffer an anderen Orten fallen sofort auf.
    const hits = new Set<string>();
    for (const file of BOX_FILES) {
      const source = read(file);
      if (/type="(?:checkbox|radio)"/.test(source)) hits.add(file);
    }
    expect(hits.size).toBe(BOX_FILES.length);
  });
});
