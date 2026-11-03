import { parseSlidesSpec } from '@pagewise/render/slides';
import { describe, expect, it, vi } from 'vitest';
import { buildPptx } from './pptx';
import * as raster from './raster';

const deck = () => {
  const result = parseSlidesSpec(
    JSON.stringify({
      title: 'Wasser (erfunden)',
      slides: [
        {
          title: 'Stoffe',
          bullets: ['H₂O', 'Sauerstoff'],
          text: 'Erfundene Beispielfolie mit Übungen.',
        },
        { title: 'Ende' },
      ],
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

describe('PowerPoint-Erzeugung', () => {
  it('erzeugt eine ZIP-Datei im PPTX-Format mit einer Folie je Eintrag', async () => {
    const blob = await buildPptx(deck());
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // ZIP-Kopf (PK), und die Folienteile sind in der Datei enthalten
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('ppt/slides/slide1.xml');
    expect(raw).toContain('ppt/slides/slide2.xml');
    expect(raw).not.toContain('ppt/slides/slide3.xml');
  });
});

describe('PowerPoint mit Abbildung', () => {
  const PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const withFigure = () => {
    const result = parseSlidesSpec(
      JSON.stringify({
        title: 'Beispiel',
        slides: [
          {
            title: 'Parabel',
            bullets: ['Nullstellen'],
            figure: { type: 'graph', graph: { functions: ['x^2'], x: [-2, 2] }, caption: 'f(x)' },
          },
        ],
      }),
    );
    if (!result.ok) throw result.error;
    return result.value;
  };

  it('legt die Zeichnung als Bild in die Datei', async () => {
    const spy = vi
      .spyOn(raster, 'rasterizeBlock')
      .mockResolvedValue({ dataUrl: PIXEL, ratio: 1.5, width: 480, height: 320 });
    const blob = await buildPptx(withFigure());
    spy.mockRestore();
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('ppt/media/');
  });

  it('erzeugt die Datei auch, wenn sich die Abbildung nicht zeichnen lässt', async () => {
    const spy = vi.spyOn(raster, 'rasterizeBlock').mockRejectedValue(new Error('x'));
    const blob = await buildPptx(withFigure());
    spy.mockRestore();
    expect(blob.size).toBeGreaterThan(1000);
  });
});
