import type { DocumentSpec } from '@pagewise/render/document';

// A4 in Millimetern. Der Text läuft bis zur unteren Grenze, dann folgt eine neue Seite.
const PAGE = { width: 210, height: 297, left: 22, top: 24, bottom: 22 } as const;
const TEXT_WIDTH = PAGE.width - 2 * PAGE.left;
const BULLET_INDENT = 6;
/** Schriftgrößen in Punkt. */
const SIZE = { title: 18, heading: 13, text: 11 } as const;
const LINE = 1.45;
const PT_TO_MM = 0.3528;

/**
 * Baut aus dem geprüften Dokument eine PDF-Datei (A4, eingebaute Helvetica). Die Bibliothek wird erst hier
 * geladen, also beim Herunterladen, nicht schon beim Anzeigen. Nur Zeichen aus der PDF-Schrift (siehe
 * `isPdfText`) kommen durch die Prüfung; die Datei enthält keine Bilder und keine Verweise.
 */
export async function buildPdf(spec: DocumentSpec): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: spec.title, creator: 'Pagewise' });

  const bottom = PAGE.height - PAGE.bottom;
  let y = PAGE.top;

  /** Schreibt einen Absatz, bricht ihn um und beginnt bei Bedarf eine neue Seite. Mit Punkt: nur vor der ersten Zeile. */
  const write = (
    text: string,
    x: number,
    width: number,
    size: number,
    bold: boolean,
    bullet = false,
  ) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const step = size * PT_TO_MM * LINE;
    pdf.splitTextToSize(text, width).forEach((line: string, index: number) => {
      if (y + step > bottom) {
        pdf.addPage();
        y = PAGE.top;
      }
      const baseline = y + size * PT_TO_MM;
      if (bullet && index === 0) pdf.text('•', PAGE.left, baseline);
      pdf.text(line, x, baseline);
      y += step;
    });
  };

  write(spec.title, PAGE.left, TEXT_WIDTH, SIZE.title, true);
  y += 4;

  for (const part of spec.parts) {
    if (part.type === 'heading') {
      y += 3;
      write(part.text, PAGE.left, TEXT_WIDTH, SIZE.heading, true);
      y += 1;
    } else if (part.type === 'paragraph') {
      write(part.text, PAGE.left, TEXT_WIDTH, SIZE.text, false);
      y += 2.5;
    } else {
      for (const item of part.items) {
        write(item, PAGE.left + BULLET_INDENT, TEXT_WIDTH - BULLET_INDENT, SIZE.text, false, true);
        y += 1;
      }
      y += 1.5;
    }
  }

  return pdf.output('blob');
}
