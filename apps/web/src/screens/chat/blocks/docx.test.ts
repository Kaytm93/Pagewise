import { parseDocumentSpec } from '@pagewise/render/document';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { buildDocx } from './docx';
import * as raster from './raster';

// Ein Pixel, damit die Abbildung ohne Leinwand (jsdom) in der Datei landet.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Alle Inhalte sind erfunden.
const spec = () => {
  const result = parseDocumentSpec(
    JSON.stringify({
      title: 'Lernzettel Wasser & Salz',
      parts: [
        { type: 'heading', text: 'Aufgabe 1' },
        { type: 'paragraph', text: 'Beschreibe H₂O <kurz>.' },
        { type: 'list', items: ['Wasserstoff', 'Sauerstoff'] },
        { type: 'table', header: ['Stoff', 'Formel'], rows: [['Wasser', 'H₂O']] },
        { type: 'graph', graph: { functions: ['x^2'], x: [-2, 2] }, caption: 'Parabel' },
      ],
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('DOCX-Erzeugung', () => {
  it('schreibt Titel, Überschrift, Absatz, Liste, Tabelle und das Bild als echte Word-Teile', async () => {
    const spy = vi
      .spyOn(raster, 'rasterizeBlock')
      .mockResolvedValue({ dataUrl: PIXEL, ratio: 1.5, width: 480, height: 320 });
    const blob = await buildDocx(spec());
    spy.mockRestore();
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const files = await unzip(blob);
    expect(Object.keys(files)).toContain('word/media/image1.png');
    const document = strFromU8(files['word/document.xml'] as Uint8Array);
    expect(document).toContain('Lernzettel Wasser &amp; Salz');
    expect(document).toContain('w:val="Heading1"');
    expect(document).toContain('Beschreibe H₂O &lt;kurz&gt;.');
    expect(document).toContain('<w:numId w:val="1"/>');
    expect(document).toContain('<w:tbl>');
    expect(document).toContain('<w:drawing>');
    expect(document).toContain('Parabel');
    const rels = strFromU8(files['word/_rels/document.xml.rels'] as Uint8Array);
    expect(rels).toContain('media/image1.png');
    const types = strFromU8(files['[Content_Types].xml'] as Uint8Array);
    expect(types).toContain('Extension="png"');
  });

  it('erzeugt die Datei auch, wenn sich die Abbildung nicht zeichnen lässt', async () => {
    const spy = vi.spyOn(raster, 'rasterizeBlock').mockRejectedValue(new Error('keine Leinwand'));
    const files = await unzip(await buildDocx(spec()));
    spy.mockRestore();
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(false);
    expect(strFromU8(files['word/document.xml'] as Uint8Array)).toContain(
      'Abbildung konnte nicht gezeichnet werden',
    );
  });
});
