import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSubjectTemplates } from './subject-templates';

describe('Fächer-Vorlagen', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function write(content: string): string {
    const file = join(base, 'vorlagen.json');
    writeFileSync(file, content);
    return file;
  }

  it('liest nur die Namen', () => {
    const file = write(
      JSON.stringify({
        version: 1,
        subjects: [
          { name: 'Beispielfach A', teacher: 'Beispiel-Lehrkraft' },
          { name: 'Beispielfach B' },
        ],
      }),
    );
    expect(loadSubjectTemplates(file)).toEqual([
      { name: 'Beispielfach A' },
      { name: 'Beispielfach B' },
    ]);
  });

  it('entfernt doppelte Namen unabhängig von der Schreibweise', () => {
    const file = write(
      JSON.stringify({
        version: 1,
        subjects: [{ name: 'Beispielfach' }, { name: 'BEISPIELFACH' }],
      }),
    );
    expect(loadSubjectTemplates(file)).toEqual([{ name: 'Beispielfach' }]);
  });

  it.each([
    ['eine fehlende Datei', null],
    ['kein JSON', 'das ist kein JSON'],
    ['eine falsche Version', JSON.stringify({ version: 2, subjects: [] })],
    ['einen ungültigen Namen', JSON.stringify({ version: 1, subjects: [{ name: '' }] })],
    [
      'zu viele Einträge',
      JSON.stringify({
        version: 1,
        subjects: Array.from({ length: 51 }, (_, i) => ({ name: `Beispielfach ${i}` })),
      }),
    ],
  ])('liefert bei %s eine leere Liste', (_label, content) => {
    const file = content === null ? join(base, 'gibt-es-nicht.json') : write(content);
    expect(loadSubjectTemplates(file)).toEqual([]);
  });
});
