import type { SlidesSpec } from '@pagewise/render/slides';

/** Schrift und Farben der Datei: fest, damit sie auf jedem Rechner gleich aussieht (Arial, Graphit). */
const FONT = 'Arial';
const INK = '2E2E2E';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Baut aus den geprüften Folien eine PowerPoint-Datei (16:9). pptxgenjs wird erst beim Herunterladen geladen.
 * Die Datei entsteht im Speicher: Die Bibliothek schreibt sie nicht über ein Element mit `style` (die CSP
 * verbietet das); der Aufruf holt nur den Blob, das Herunterladen übernimmt `saveBlob`.
 */
export async function buildPptx(spec: SlidesSpec): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = spec.title;
  pptx.author = 'Pagewise';

  for (const slide of spec.slides) {
    const page = pptx.addSlide();
    page.addText(slide.title, {
      x: 0.7,
      y: 0.5,
      w: 11.9,
      h: 1.1,
      fontFace: FONT,
      fontSize: 32,
      bold: true,
      color: INK,
      valign: 'top',
    });
    // Mit Stichpunkten steht der Absatz unter der Liste, sonst direkt unter dem Titel.
    const textY = slide.bullets.length > 0 ? 5.4 : 1.9;
    if (slide.bullets.length > 0) {
      page.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        {
          x: 0.9,
          y: 1.9,
          w: 11.5,
          h: 3.3,
          fontFace: FONT,
          fontSize: 22,
          color: INK,
          valign: 'top',
          paraSpaceAfter: 8,
        },
      );
    }
    if (slide.text !== undefined) {
      page.addText(slide.text, {
        x: 0.7,
        y: textY,
        w: 11.9,
        h: 1.4,
        fontFace: FONT,
        fontSize: 20,
        color: INK,
        valign: 'top',
      });
    }
  }

  const blob = await pptx.write({ outputType: 'blob' });
  if (!(blob instanceof Blob)) throw new Error('pptx: kein Blob');
  // pptxgenjs liefert den Typ „application/zip“; die Datei ist eine PowerPoint-Präsentation.
  return new Blob([blob], { type: PPTX_TYPE });
}
