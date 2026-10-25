import { parseSlidesSpec } from '@pagewise/render/slides';
import { describe, expect, it } from 'vitest';
import { buildPptx } from './pptx';

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
