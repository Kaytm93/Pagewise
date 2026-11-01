import type { SlidesSpec } from '@pagewise/render/slides';
import { rasterizeBlock } from './raster';

/** Schrift und Farben der Datei: fest, damit sie auf jedem Rechner gleich aussieht (Arial, Graphit). */
const FONT = 'Arial';
const INK = '2E2E2E';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Zeichnet eine Abbildung für die Folie; lässt sie sich nicht zeichnen, bleibt die Folie ohne sie (die Datei entsteht trotzdem). */
async function rasterOrNull(kind: 'graph' | 'mol' | 'abc', source: string) {
  try {
    return await rasterizeBlock(kind, source);
  } catch {
    return null;
  }
}

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
    // Mit Abbildung teilt sich die Folie: links Stichpunkte und Absatz, rechts die Zeichnung (D-075).
    const figure = slide.figure ? await rasterOrNull(slide.figure.kind, slide.figure.source) : null;
    const split = figure !== null && (slide.bullets.length > 0 || slide.text !== undefined);
    const textWidth = split ? 6.2 : 11.9;
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
          w: split ? 5.9 : 11.5,
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
        w: textWidth,
        h: 1.4,
        fontFace: FONT,
        fontSize: 20,
        color: INK,
        valign: 'top',
      });
    }
    if (figure && slide.figure) {
      const box = split ? { x: 7.2, y: 1.9, w: 5.4, h: 4.4 } : { x: 0.7, y: 1.8, w: 11.9, h: 4.8 };
      const caption = slide.figure.caption;
      const room = caption ? box.h - 0.5 : box.h;
      const fit =
        figure.ratio > box.w / room
          ? { w: box.w, h: box.w / figure.ratio }
          : { w: room * figure.ratio, h: room };
      const x = box.x + (box.w - fit.w) / 2;
      page.addImage({
        data: figure.dataUrl.replace(/^data:/, ''),
        x,
        y: box.y,
        w: fit.w,
        h: fit.h,
        altText: caption ?? slide.title,
      });
      if (caption) {
        page.addText(caption, {
          x: box.x,
          y: box.y + fit.h + 0.1,
          w: box.w,
          h: 0.4,
          fontFace: FONT,
          fontSize: 12,
          color: INK,
          align: 'center',
        });
      }
    }
  }

  const blob = await pptx.write({ outputType: 'blob' });
  if (!(blob instanceof Blob)) throw new Error('pptx: kein Blob');
  // pptxgenjs liefert den Typ „application/zip“; die Datei ist eine PowerPoint-Präsentation.
  return new Blob([blob], { type: PPTX_TYPE });
}
