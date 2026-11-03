import { describe, expect, it } from 'vitest';
import { parseSheetSpec } from './sheet';

// Alle Inhalte sind erfunden.
const sheet = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Beispiel-Noten',
    sheets: [
      {
        name: 'Tabelle1',
        header: ['Name', 'Punkte'],
        rows: [
          ['Beispiel A', 12.5],
          ['Beispiel B', 9],
        ],
      },
    ],
    ...overrides,
  });
const fail = (source: string) => {
  const result = parseSheetSpec(source);
  if (result.ok) throw new Error('sollte scheitern');
  return `${result.error.code}${result.error.detail ? `:${result.error.detail}` : ''}`;
};

describe('Tabellendatei', () => {
  it('liest Blätter mit Kopfzeile, Text und Zahlen', () => {
    const result = parseSheetSpec(sheet());
    expect(result.ok && result.value.sheets[0]?.rows[0]).toEqual(['Beispiel A', 12.5]);
  });

  it('liest die gespeicherte Form wieder ein', () => {
    const first = parseSheetSpec(sheet());
    expect(first.ok).toBe(true);
    if (first.ok) expect(parseSheetSpec(JSON.stringify(first.value)).ok).toBe(true);
  });

  it('behandelt Text mit = am Anfang als Text', () => {
    const result = parseSheetSpec(
      sheet({ sheets: [{ name: 'A', rows: [['=SUMME(A1:A2)', '+1']] }] }),
    );
    expect(result.ok && result.value.sheets[0]?.rows[0]).toEqual(['=SUMME(A1:A2)', '+1']);
  });

  it('lehnt ungültige Blattnamen, doppelte Namen und Formen ab', () => {
    expect(fail(sheet({ sheets: [{ name: 'A/B', rows: [['x']] }] }))).toBe('invalid_sheet:name');
    expect(
      fail(
        sheet({
          sheets: [
            { name: 'A', rows: [['x']] },
            { name: 'a', rows: [['y']] },
          ],
        }),
      ),
    ).toBe('invalid_sheet:name');
    expect(fail(sheet({ sheets: [{ name: 'A', rows: [['x', 'y'], ['z']] }] }))).toBe(
      'invalid_sheet:rows',
    );
    expect(fail(sheet({ sheets: [{ name: 'A', header: ['a'], rows: [['x', 'y']] }] }))).toBe(
      'invalid_sheet:header',
    );
    expect(fail(sheet({ sheets: [{ name: 'A', rows: [[Number.NaN]] }] }))).toMatch(/invalid_/);
    expect(fail(sheet({ sheets: [] }))).toBe('invalid_sheet:sheets');
    expect(fail(sheet({ extra: 1 }))).toBe('invalid_sheet');
    expect(fail('kaputt')).toBe('invalid_json');
  });

  it('begrenzt Zeilen, Spalten und Größe', () => {
    const many = Array.from({ length: 201 }, () => ['x']);
    expect(fail(sheet({ sheets: [{ name: 'A', rows: many }] }))).toBe('invalid_sheet:rows');
    const wide = [Array.from({ length: 13 }, () => 'x')];
    expect(fail(sheet({ sheets: [{ name: 'A', rows: wide }] }))).toBe('invalid_sheet:rows');
    expect(fail(`{"title":"${'x'.repeat(40_000)}"}`)).toBe('too_large');
  });
});
