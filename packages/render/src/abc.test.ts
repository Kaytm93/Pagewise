import { describe, expect, it } from 'vitest';
import { checkAbc, validateAbc } from './abc';

const tune = 'X:1\nT:Beispiel\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|';

describe('Noten prüfen', () => {
  it('nimmt gültiges ABC an', () => {
    expect(validateAbc(tune)).toBeNull();
    expect(checkAbc(tune).warning).toBe(false);
  });

  it('lehnt Fließtext statt Noten ab, ohne den Text zurückzugeben', () => {
    const result = checkAbc('das ist kein abc');
    expect(result.error?.code).toBe('invalid_abc');
    expect(JSON.stringify(result.error)).not.toContain('kein');
  });

  it('lehnt leere und zu große Angaben ab', () => {
    expect(validateAbc('')?.code).toBe('empty');
    expect(validateAbc(`${tune}\n${'C'.repeat(9000)}`)?.code).toBe('too_large');
  });

  it('meldet ungenaue Taktlängen nur als Hinweis', () => {
    const result = checkAbc('X:1\nM:4/4\nL:1/4\nK:C\nCDEFG|ABc|');
    expect(result.error).toBeNull();
  });

  it('gibt bei Fehlern höchstens Zeile und Spalte als Hinweis zurück', () => {
    const result = checkAbc('X:1\nM:4/4\nL:1/4\nK:C\nCD#!?EF|');
    if (result.error) expect(result.error.detail ?? '').toMatch(/^(\d+:\d+)?$/);
  });
});
