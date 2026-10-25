import { parseDocumentSpec } from '@pagewise/render/document';
import { describe, expect, it } from 'vitest';
import { buildPdf, fileName } from './pdf';

const spec = (overrides: Record<string, unknown> = {}) => {
  const result = parseDocumentSpec(
    JSON.stringify({
      title: 'Arbeitsblatt Wasser (erfunden)',
      parts: [
        { type: 'heading', text: 'Aufgabe 1' },
        { type: 'paragraph', text: 'Nenne die Formel von Wasser: H2O und Übungen für Schüler.' },
        { type: 'list', items: ['Wasserstoff', 'Sauerstoff', 'Ein sehr langer Punkt '.repeat(12)] },
      ],
      ...overrides,
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

describe('PDF-Erzeugung', () => {
  it('erzeugt eine PDF-Datei mit der Kennung am Anfang', async () => {
    const blob = await buildPdf(spec());
    expect(blob.type).toBe('application/pdf');
    const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
    expect(head.startsWith('%PDF-')).toBe(true);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('bricht lange Dokumente auf weitere Seiten um', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: 'paragraph',
      text: `Absatz ${i + 1} mit etwas Text, damit die Seite voll wird. `.repeat(5),
    }));
    const blob = await buildPdf(spec({ parts: many }));
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    // Jede Seite ist ein eigenes Objekt mit /Type /Page
    expect(text.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0).toBeGreaterThan(2);
  });
});

describe('Dateiname', () => {
  it('entfernt Zeichen, die Dateisysteme nicht mögen', () => {
    expect(fileName('Wasser: Arbeitsblatt/1?', 'pdf')).toBe('Wasser Arbeitsblatt1.pdf');
    expect(fileName('   ', 'pdf')).toBe('Dokument.pdf');
    expect(fileName('x'.repeat(200), 'pptx').length).toBe(80 + '.pptx'.length);
  });
});
