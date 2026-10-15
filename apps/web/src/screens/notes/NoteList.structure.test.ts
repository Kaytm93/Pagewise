import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * M4-T036: `api.notes` liefert die `NoteList` samt `truncated`, und NoteList.tsx liest die
 * Liste wieder darüber statt den Umschlag selbst über `api.client.request` zu entpacken.
 * Das Verhalten decken die Notes-Tests (inkl. Neuesten-200-Hinweis) ab; dieser Quelltext-Test
 * nagelt den Weg fest, damit die Abweichung nicht zurückkommt.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('NoteList lädt die Hefteintragsliste über api.notes (M4-T036)', () => {
  const quelle = () => read('screens/notes/NoteList.tsx');

  it('ruft api.notes für die Liste auf', () => {
    expect(quelle()).toMatch(/api\s*\.\s*notes\(/);
  });

  it('greift für die Liste nicht direkt über api.client.request zu', () => {
    expect(quelle()).not.toContain('api.client');
  });
});
