import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SelectField (M4-T011): Ohne `appearance-none` rendert WebKit eine 25 px hohe System-Auswahlliste
 * und ignoriert `min-h-11`. Mit `appearance-none`, eigenem Pfeil (lucide `ChevronDown`,
 * `pointer-events-none`) und `min-h-11` sieht sie aus wie die Eingabefelder. jsdom misst kein
 * Layout, daher Strukturtest am Quelltext; die echten Maße kommen aus der Browsermessung
 * (pw/agents/m4-t011).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'ui/Field.tsx'), 'utf8');
const select = source.slice(source.indexOf('export function SelectField'));

describe('Auswahlliste wie die übrigen Felder (M4-T011)', () => {
  it('SelectField: appearance-none, eigener Pfeil (ChevronDown, pointer-events-none), min-h-11', () => {
    expect(select).toContain('appearance-none');
    expect(select).toContain('ChevronDown');
    expect(select).toContain('pointer-events-none');
    expect(select).toContain('min-h-11');
    expect(select).toContain('aria-hidden');
  });

  it('jedes <select> in Field.tsx trägt appearance-none (niemand holt die Systemliste zurück)', () => {
    const selectTags = source.match(/<select\b/g) ?? [];
    const withAppearance = source.match(/<select[\s\S]*?className=\{`[^`]*appearance-none/g) ?? [];
    expect(selectTags.length).toBe(withAppearance.length);
    expect(selectTags.length).toBeGreaterThan(0);
  });
});
