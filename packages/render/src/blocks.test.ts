import { describe, expect, it } from 'vitest';
import { extractBlocks, normalizeDisplayMath } from './blocks';

describe('extractBlocks', () => {
  it('findet umzäunte Blöcke der drei Sprachen und nummeriert sie je Art', () => {
    const text = [
      'Text',
      '```graph',
      '{"functions":["x"]}',
      '```',
      '',
      '```mol',
      'H2O',
      '```',
      '~~~abc',
      'X:1',
      '~~~',
      '```graph',
      '{"functions":["x^2"]}',
      '```',
    ].join('\n');
    const blocks = extractBlocks(text);
    expect(blocks.map((b) => [b.kind, b.index])).toEqual([
      ['graph', 1],
      ['mol', 1],
      ['abc', 1],
      ['graph', 2],
    ]);
    expect(blocks[1]?.source).toBe('H2O');
  });

  it('ignoriert andere Sprachen und Dollarzeichen im Code', () => {
    const text = ['```js', 'const a = "$x$";', '```', 'Befehl `echo $HOME and $PATH` hier'].join(
      '\n',
    );
    expect(extractBlocks(text)).toEqual([]);
  });

  it('erkennt Formeln im Text und als Anzeige', () => {
    const blocks = extractBlocks('Es gilt $a^2+b^2=c^2$ und\n\n$$\\frac{1}{2}$$\n\nEnde');
    expect(blocks).toMatchObject([
      { kind: 'math', display: false, source: 'a^2+b^2=c^2', index: 1 },
      { kind: 'math', display: true, source: '\\frac{1}{2}', index: 2 },
    ]);
  });

  it('hält Preise und einzelne Dollarzeichen für Text', () => {
    expect(extractBlocks('Das kostet 5 $ und 6 $ zusammen.')).toEqual([]);
    expect(extractBlocks('Nur ein $ am Ende')).toEqual([]);
    expect(extractBlocks('Maskiert \\$5 und \\$6')).toEqual([]);
  });

  it('läuft bei nie geschlossenem Block bis zum Ende, ohne zu hängen', () => {
    const blocks = extractBlocks('```graph\n{"functions":["x"]}\nweiter ohne Ende');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('graph');
  });

  it('kommt mit Windows-Zeilenenden und leerem Text zurecht', () => {
    expect(extractBlocks('')).toEqual([]);
    expect(extractBlocks('```mol\r\nH2O\r\n```\r\n')[0]?.source).toBe('H2O');
  });
});

describe('normalizeDisplayMath', () => {
  it('macht aus einer Formel allein in der Zeile eine Anzeigeformel mit eigenen $$-Zeilen', () => {
    expect(normalizeDisplayMath('Text\n\n$$\\frac{1}{2}$$\n\nEnde')).toBe(
      'Text\n\n$$\n\\frac{1}{2}\n$$\n\nEnde',
    );
    expect(normalizeDisplayMath('  $$ x^2 $$  ')).toBe('  $$\n  x^2\n  $$');
  });

  it('lässt Formeln mitten im Text, mehrzeilige und umzäunte unberührt', () => {
    const text = 'Mitten $$x$$ im Satz\n\n$$\nx\n$$\n\n```tex\n$$y$$\n```\n\n$$a$$ und $$b$$';
    expect(normalizeDisplayMath(text)).toBe(text);
  });

  it('lässt leere und kaputte Formeln unberührt', () => {
    expect(normalizeDisplayMath('$$ $$')).toBe('$$ $$');
    expect(normalizeDisplayMath('$$$$')).toBe('$$$$');
  });
});
