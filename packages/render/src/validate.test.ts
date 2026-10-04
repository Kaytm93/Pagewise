import { describe, expect, it } from 'vitest';
import { validateMarkdown } from './validate';

const good = [
  'Der Satz $a^2+b^2=c^2$ gilt.',
  '',
  '$$\\frac{1}{2}$$',
  '',
  '```graph',
  '{"functions":["x^2-4"],"x":[-4,4]}',
  '```',
  '',
  '```mol',
  'H2O',
  '```',
  '',
  '```mol',
  'smiles: CCO',
  '```',
  '',
  '```abc',
  'X:1',
  'M:4/4',
  'L:1/4',
  'K:C',
  'CDEF|GABc|',
  '```',
].join('\n');

describe('validateMarkdown', () => {
  it('findet an einem Text mit lauter gültigen Blöcken nichts', () => {
    expect(validateMarkdown(good)).toEqual([]);
    expect(validateMarkdown('Nur Text, ohne Blöcke.')).toEqual([]);
    expect(validateMarkdown('')).toEqual([]);
  });

  it('nennt Art, Nummer und Code jedes fehlerhaften Blocks', () => {
    const text = [
      '$\\frac{1$ und $ok$',
      '```graph',
      '{"functions":["foo(x)"]}',
      '```',
      '```mol',
      'C8H18',
      '```',
      '```mol',
      'smiles: C(C',
      '```',
      '```abc',
      'das ist kein abc',
      '```',
    ].join('\n');
    const issues = validateMarkdown(text);
    expect(issues.map((i) => [i.kind, i.index, i.code]).sort()).toEqual([
      ['abc', 1, 'invalid_abc'],
      ['graph', 1, 'invalid_expression'],
      ['math', 1, 'invalid_math'],
      ['mol', 1, 'unknown_formula'],
      ['mol', 2, 'invalid_smiles'],
    ]);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues.find((i) => i.code === 'unknown_formula')?.detail).toBe('C8H18');
  });

  it('enthält in keinem Befund Text aus den Blöcken', () => {
    const issues = validateMarkdown(
      '```graph\n{"functions":["geheimnis(x)"]}\n```\n```abc\nWichtigerText\n```',
    );
    expect(JSON.stringify(issues)).not.toMatch(/geheimnis|WichtigerText/);
  });

  it('prüft große Texte schnell', () => {
    const start = Date.now();
    validateMarkdown(Array.from({ length: 200 }, () => good).join('\n\n'));
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
