import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Checkboxen sind die sichtbare Bedienfläche ihrer Zeile und mindestens 24 px groß (M3-T027);
 * die umgebende label-Zeile bleibt mit mindestens 44 px (min-h-11) antippbar.
 * jsdom misst kein Layout, daher Strukturtest am Quelltext; die echten Maße kommen aus der
 * Browsermessung (pw/agents/m3-t027).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const CHECKBOX_FILES = ['ui/Field.tsx', 'screens/providers/ModelListEditor.tsx'];

describe('Checkboxgröße', () => {
  for (const file of CHECKBOX_FILES) {
    it(`${file}: Kästchen 24 px (size-6) in Zeile ab 44 px (min-h-11)`, () => {
      const source = read(file);
      expect(source).toContain('type="checkbox"');
      expect(source).toMatch(/size-6[^>]*accent-primary|accent-primary[^>]*size-6/);
      expect(source).not.toMatch(/type="checkbox"[^>]*size-5/);
      expect(source).toContain('min-h-11');
    });
  }
});
