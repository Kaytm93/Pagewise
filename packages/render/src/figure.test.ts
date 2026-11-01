import { describe, expect, it } from 'vitest';
import { type DocumentSpec, parseDocumentSpec } from './document';
import { parseFigureArtifact } from './figure';
import { parseSlidesSpec, type SlidesSpec } from './slides';
import { validateDocumentFigures, validateSlidesFigures } from './validate';

// Alle Inhalte sind erfunden.
const GRAPH = {
  functions: ['x^2-4'],
  x: [-4, 4],
  y: [-6, 6],
  points: [{ x: 2, y: 0, label: 'N' }],
};

const doc = (...parts: unknown[]) => JSON.stringify({ title: 'Beispiel', parts });
const parsedDoc = (...parts: unknown[]): DocumentSpec => {
  const result = parseDocumentSpec(doc(...parts));
  if (!result.ok) throw new Error(`${result.error.code}:${result.error.detail}`);
  return result.value;
};
const failDoc = (...parts: unknown[]) => {
  const result = parseDocumentSpec(doc(...parts));
  if (result.ok) throw new Error('sollte scheitern');
  return `${result.error.code}${result.error.detail ? `:${result.error.detail}` : ''}`;
};

describe('Abbildungen im Dokument', () => {
  it('nimmt einen Graph als Objekt und speichert den Quelltext des Blocks', () => {
    const spec = parsedDoc({ type: 'graph', graph: GRAPH, caption: 'Parabel' });
    expect(spec.parts[0]).toEqual({
      type: 'figure',
      kind: 'graph',
      source: JSON.stringify(GRAPH),
      caption: 'Parabel',
    });
  });

  it('nimmt Summenformel und SMILES und Noten', () => {
    const spec = parsedDoc(
      { type: 'molecule', formula: 'H2O' },
      { type: 'molecule', smiles: ' CCO ' },
      { type: 'notes', abc: 'X:1\nM:4/4\nL:1/4\nK:C\nCDEF|' },
    );
    expect(spec.parts.map((part) => part.type === 'figure' && part.source)).toEqual([
      'H2O',
      'smiles: CCO',
      'X:1\nM:4/4\nL:1/4\nK:C\nCDEF|',
    ]);
  });

  it('liest die gespeicherte Form wieder ein (Rundlauf)', () => {
    const spec = parsedDoc({ type: 'graph', graph: GRAPH });
    const again = parseDocumentSpec(JSON.stringify(spec));
    expect(again.ok && again.value).toEqual(spec);
  });

  it('lehnt zwei Inhaltsfelder, fremde Felder und falsche Arten ab', () => {
    expect(failDoc({ type: 'molecule', formula: 'H2O', smiles: 'CCO' })).toBe(
      'invalid_spec:molecule',
    );
    expect(failDoc({ type: 'graph', graph: GRAPH, farbe: 'rot' })).toBe('invalid_spec:graph');
    expect(failDoc({ type: 'figure', kind: 'video', source: 'x' })).toBe('invalid_spec:kind');
    expect(failDoc({ type: 'graph', graph: 5 })).toBe('invalid_spec:graph');
  });

  it('meldet einen kaputten Graph und eine unbekannte Summenformel', () => {
    expect(failDoc({ type: 'graph', graph: { functions: ['x^'], x: [0, 1] } })).toMatch(
      /^invalid_expression|invalid_spec/,
    );
    expect(failDoc({ type: 'molecule', formula: 'C8H18' })).toMatch(/unknown_formula|invalid_spec/);
  });

  it('prüft die Bildunterschrift wie jeden PDF-Text', () => {
    expect(failDoc({ type: 'graph', graph: GRAPH, caption: 'Δ' })).toBe('unsupported_text:U+0394');
  });
});

describe('Tabellen im Dokument', () => {
  it('liest Kopfzeile und Zeilen', () => {
    const spec = parsedDoc({
      type: 'table',
      header: ['Stoff', 'Formel'],
      rows: [
        ['Wasser', 'H₂O'],
        ['Kohlenstoffdioxid', 'CO₂'],
      ],
    });
    expect(spec.parts[0]).toMatchObject({ type: 'table', header: ['Stoff', 'Formel'] });
  });

  it('verlangt gleich viele Zellen je Zeile und Grenzen', () => {
    expect(failDoc({ type: 'table', rows: [['a', 'b'], ['c']] })).toBe('invalid_document:table');
    expect(failDoc({ type: 'table', header: ['a'], rows: [['a', 'b']] })).toBe(
      'invalid_document:table',
    );
    expect(failDoc({ type: 'table', rows: [] })).toBe('invalid_document:rows');
    expect(failDoc({ type: 'table', rows: [Array.from({ length: 7 }, () => 'x')] })).toBe(
      'invalid_document:table',
    );
    expect(failDoc({ type: 'table', rows: [['x']], extra: 1 })).toBe('invalid_document:table');
  });
});

describe('Abbildungen auf Folien', () => {
  const slides = (...entries: unknown[]) =>
    parseSlidesSpec(JSON.stringify({ title: 'Beispiel', slides: entries }));

  it('nimmt eine Abbildung je Folie', () => {
    const result = slides({ title: 'Parabel', figure: { type: 'graph', graph: GRAPH } });
    expect(result.ok && result.value.slides[0]?.figure).toMatchObject({ kind: 'graph' });
    const stored = result.ok ? JSON.stringify(result.value) : '';
    expect(parseSlidesSpec(stored).ok).toBe(true);
  });

  it('lehnt Unsinn als Abbildung ab', () => {
    const bad = slides({ title: 'A', figure: 'bild.png' });
    expect(bad.ok).toBe(false);
    expect(slides({ title: 'A', figure: { type: 'heading', text: 'x' } }).ok).toBe(false);
  });
});

describe('Tiefe Prüfung der Abbildungen', () => {
  it('erkennt eine SMILES-Zeichenfolge, die sich nicht zeichnen lässt', async () => {
    const spec = parsedDoc({ type: 'molecule', smiles: 'C(C' });
    expect((await validateDocumentFigures(spec))?.code).toBe('invalid_smiles');
  });

  it('akzeptiert gültiges SMILES und gültige Noten', async () => {
    const spec = parsedDoc(
      { type: 'molecule', smiles: 'CCO' },
      { type: 'notes', abc: 'X:1\nM:4/4\nL:1/4\nK:C\nCDEF|' },
    );
    expect(await validateDocumentFigures(spec)).toBeNull();
  });

  it('prüft die Abbildungen von Folien', async () => {
    const result = parseSlidesSpec(
      JSON.stringify({
        title: 'T',
        slides: [{ title: 'A', figure: { type: 'molecule', smiles: 'C(C' } }],
      }),
    );
    expect(result.ok).toBe(true);
    const spec = (result as { ok: true; value: SlidesSpec }).value;
    expect((await validateSlidesFigures(spec))?.code).toBe('invalid_smiles');
  });
});

describe('Einzelne Abbildung als Datei', () => {
  const art = (value: unknown) => parseFigureArtifact(JSON.stringify(value));

  it('liest Titel und Abbildung und den Rundlauf', () => {
    const first = art({ title: 'Parabel', figure: { type: 'graph', graph: GRAPH, caption: 'f' } });
    expect(first.ok && first.value.figure.kind).toBe('graph');
    if (first.ok) expect(parseFigureArtifact(JSON.stringify(first.value)).ok).toBe(true);
  });

  it('lehnt fehlenden Titel, fremde Felder und Unsinn ab', () => {
    expect(art({ figure: { type: 'graph', graph: GRAPH } }).ok).toBe(false);
    expect(art({ title: 'T', figure: { type: 'graph', graph: GRAPH }, x: 1 }).ok).toBe(false);
    expect(art({ title: 'T', figure: { type: 'heading', text: 'x' } }).ok).toBe(false);
    expect(parseFigureArtifact('kaputt').ok).toBe(false);
  });
});
