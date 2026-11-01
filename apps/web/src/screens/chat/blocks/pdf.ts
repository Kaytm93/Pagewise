import { type DocumentSpec, SUBSCRIPTS, SUPERSCRIPTS } from '@pagewise/render/document';
import { rasterizeBlock } from './raster';

// A4 in Millimetern. Der Text läuft bis zur unteren Grenze, dann folgt eine neue Seite.
const PAGE = { width: 210, height: 297, left: 22, top: 24, bottom: 22 } as const;
const TEXT_WIDTH = PAGE.width - 2 * PAGE.left;
const BULLET_INDENT = 6;
/** Schriftgrößen in Punkt. */
const SIZE = { title: 18, heading: 13, text: 11, caption: 9, cell: 10 } as const;
/** Pixel des SVG in Millimetern (96 dpi) und Vergrößerung auf der Seite; Abbildungen sind höchstens so breit wie der Text. */
const PX_TO_MM = 0.2646;
const FIGURE_SCALE = 1.2;
const MAX_FIGURE_HEIGHT = 110;
/** Innenabstand einer Tabellenzelle in Millimetern. */
const CELL_PAD = 1.8;
const LINE = 1.45;
/** Steht anstelle einer Abbildung, die sich nicht zeichnen ließ. ASCII, damit die PDF-Schrift es setzt. */
const FIGURE_FAILED = '(Abbildung konnte nicht gezeichnet werden)';
const PT_TO_MM = 0.3528;
/** Hoch- und Tiefstellung: 70 % der Schriftgröße; Hochgestelltes um 35 %, Tiefgestelltes um 20 % der Größe verschoben. */
const SCRIPT_SCALE = 0.7;
const SUPER_RAISE = 0.35;
const SUB_LOWER = 0.2;
/** Breite des Minuszeichens und der Vergleichszeichen in Em (Adobe-Symbol-Metrik). */
const MINUS_EM = 0.549;
/**
 * Mathezeichen aus der eingebauten Symbol-Schrift (Adobe-Kodierung), die Helvetica nicht hat. Die Breite in Em
 * steht hier fest: Die Messung der Schrift liefert für diese Zeichen keine brauchbare Breite.
 */
const SYMBOL_CODES: ReadonlyMap<string, { code: string; em: number }> = new Map([
  ['→', { code: '®', em: 0.987 }],
  // Code 0x2D ist in der Symbol-Schrift das Minuszeichen, nicht der Bindestrich.
  ['−', { code: '-', em: MINUS_EM }],
  ['≤', { code: '£', em: 0.549 }],
  ['≥', { code: '³', em: 0.549 }],
  ['≈', { code: '»', em: 0.549 }],
]);

/**
 * Ein Zeichen mit seiner Schrift: Familie, Größe relativ zur Grundschrift und Anhebung in Em (negativ = tief).
 * Mathezeichen tragen ihre Breite in Em (`em`), alle anderen messen die Schrift selbst.
 */
interface Glyph {
  text: string;
  font: 'helvetica' | 'symbol';
  scale: number;
  raise: number;
  space: boolean;
  em?: number;
}

/** Hoch- oder tiefgestelltes Zeichen. Das Minus kommt aus der Symbol-Schrift, der Bindestrich wäre zu kurz. */
function scriptGlyph(text: string, raise: number): Glyph {
  if (text === '-') {
    return { text: '-', font: 'symbol', scale: SCRIPT_SCALE, raise, space: false, em: MINUS_EM };
  }
  return { text, font: 'helvetica', scale: SCRIPT_SCALE, raise, space: false };
}

function glyphOf(char: string): Glyph {
  const superscript = SUPERSCRIPTS.get(char);
  if (superscript) return scriptGlyph(superscript, SUPER_RAISE);
  const subscript = SUBSCRIPTS.get(char);
  if (subscript) return scriptGlyph(subscript, -SUB_LOWER);
  const symbol = SYMBOL_CODES.get(char);
  if (symbol) {
    return { text: symbol.code, font: 'symbol', scale: 1, raise: 0, space: false, em: symbol.em };
  }
  return { text: char, font: 'helvetica', scale: 1, raise: 0, space: char === ' ' };
}

/**
 * Bricht die Zeichen an Leerzeichen um. Passt ein Wort nicht in eine Zeile, bricht es zwischen zwei Zeichen.
 * Ein Leerzeichen am Zeilenanfang fällt weg.
 */
function wrap(glyphs: Glyph[], widthOf: (glyph: Glyph) => number, width: number): Glyph[][] {
  const lines: Glyph[][] = [];
  let line: Glyph[] = [];
  let lineWidth = 0;
  for (const glyph of glyphs) {
    const glyphWidth = widthOf(glyph);
    if (lineWidth + glyphWidth > width && line.length > 0) {
      let lastSpace = -1;
      line.forEach((item, index) => {
        if (item.space) lastSpace = index;
      });
      const rest = lastSpace === -1 ? [] : line.slice(lastSpace + 1);
      lines.push(lastSpace === -1 ? line : line.slice(0, lastSpace));
      line = rest;
      lineWidth = rest.reduce((sum, item) => sum + widthOf(item), 0);
    }
    if (glyph.space && line.length === 0) continue;
    line.push(glyph);
    lineWidth += glyphWidth;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Baut aus dem geprüften Dokument eine PDF-Datei (A4, eingebaute Helvetica). Die Bibliothek wird erst hier
 * geladen, also beim Herunterladen, nicht schon beim Anzeigen. Zeichen, die `isPdfText` durchlässt, setzt die
 * Datei: Hoch- und Tiefstellung als kleinere, verschobene Zeichen, Mathezeichen aus der Symbol-Schrift. Die
 * Abbildungen sind PNG-Bilder (Graph, Molekül, Noten), Tabellen sind Linien und Text. Verweise enthält die Datei nicht.
 */
export async function buildPdf(spec: DocumentSpec): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: spec.title, creator: 'Pagewise' });

  const bottom = PAGE.height - PAGE.bottom;
  let y = PAGE.top;

  /** Setzt Schrift und Größe für ein Zeichen. Die Symbol-Schrift kennt nur die normale Lage. */
  const select = (glyph: Glyph, size: number, bold: boolean) => {
    const style = bold && glyph.font === 'helvetica' ? 'bold' : 'normal';
    pdf.setFont(glyph.font, style);
    pdf.setFontSize(size * glyph.scale);
  };
  /** Breite eines Zeichens in Millimetern (wie die Positionen im Dokument). */
  const widthOf = (glyph: Glyph, size: number, bold: boolean) => {
    if (glyph.em !== undefined) return glyph.em * size * glyph.scale * PT_TO_MM;
    select(glyph, size, bold);
    return pdf.getTextWidth(glyph.text);
  };

  /** Schreibt eine Zeile. Gleich gesetzte Zeichen laufen als ein Stück, damit der Text zusammenhängt. */
  const drawLine = (line: Glyph[], x: number, baseline: number, size: number, bold: boolean) => {
    let cursor = x;
    let start = 0;
    for (let index = 1; index <= line.length; index += 1) {
      const current = line[index - 1] as Glyph;
      const next = line[index];
      if (
        next &&
        next.font === current.font &&
        next.scale === current.scale &&
        next.raise === current.raise
      ) {
        continue;
      }
      const run = line.slice(start, index);
      const first = run[0] as Glyph;
      const text = run.map((glyph) => glyph.text).join('');
      select(first, size, bold);
      pdf.text(text, cursor, baseline - first.raise * size * PT_TO_MM);
      cursor += run.reduce((sum, glyph) => sum + widthOf(glyph, size, bold), 0);
      start = index;
    }
  };

  /** Schreibt einen Absatz, bricht ihn um und beginnt bei Bedarf eine neue Seite. Mit Punkt: nur vor der ersten Zeile. */
  const write = (
    text: string,
    x: number,
    width: number,
    size: number,
    bold: boolean,
    bullet = false,
  ) => {
    const lines = wrap([...text].map(glyphOf), (glyph) => widthOf(glyph, size, bold), width);
    const step = size * PT_TO_MM * LINE;
    lines.forEach((line, index) => {
      if (y + step > bottom) {
        pdf.addPage();
        y = PAGE.top;
      }
      const baseline = y + size * PT_TO_MM;
      if (bullet && index === 0) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(size);
        pdf.text('•', PAGE.left, baseline);
      }
      drawLine(line, x, baseline, size, bold);
      y += step;
    });
  };

  /** Bricht Text für eine Breite um (Zeilen aus Zeichen mit Schrift). */
  const linesFor = (text: string, width: number, size: number, bold: boolean) =>
    wrap([...text].map(glyphOf), (glyph) => widthOf(glyph, size, bold), width);

  /** Schreibt einen kurzen Text zeilenweise mittig (Bildunterschrift). */
  const writeCentered = (text: string, size: number) => {
    const step = size * PT_TO_MM * LINE;
    for (const line of linesFor(text, TEXT_WIDTH, size, false)) {
      if (y + step > bottom) {
        pdf.addPage();
        y = PAGE.top;
      }
      const width = line.reduce((sum, glyph) => sum + widthOf(glyph, size, false), 0);
      drawLine(line, PAGE.left + (TEXT_WIDTH - width) / 2, y + size * PT_TO_MM, size, false);
      y += step;
    }
  };

  /** Setzt eine Tabelle: gleich breite Spalten, Kopfzeile fett und grau hinterlegt, Zeilen brechen nicht über Seiten. */
  const drawTable = (header: string[] | undefined, rows: string[][]) => {
    const columns = (rows[0] ?? []).length;
    const cellWidth = TEXT_WIDTH / columns;
    const step = SIZE.cell * PT_TO_MM * LINE;
    const all = header
      ? [{ cells: header, bold: true }, ...rows.map((cells) => ({ cells, bold: false }))]
      : rows.map((cells) => ({ cells, bold: false }));
    pdf.setDrawColor(190, 190, 190);
    pdf.setLineWidth(0.2);
    for (const row of all) {
      const wrapped = row.cells.map((cell) =>
        linesFor(cell, cellWidth - 2 * CELL_PAD, SIZE.cell, row.bold),
      );
      const height = Math.max(...wrapped.map((lines) => lines.length)) * step + 2 * CELL_PAD;
      if (y + height > bottom) {
        pdf.addPage();
        y = PAGE.top;
      }
      wrapped.forEach((lines, column) => {
        const x = PAGE.left + column * cellWidth;
        if (row.bold) {
          pdf.setFillColor(238, 238, 238);
          pdf.rect(x, y, cellWidth, height, 'FD');
        } else {
          pdf.rect(x, y, cellWidth, height, 'S');
        }
        lines.forEach((line, index) => {
          const baseline = y + CELL_PAD + index * step + SIZE.cell * PT_TO_MM;
          drawLine(line, x + CELL_PAD, baseline, SIZE.cell, row.bold);
        });
      });
      y += height;
    }
  };

  /**
   * Setzt eine Abbildung (Graph, Molekül, Noten): gezeichnet wie im Chat, als PNG auf weißem Grund, mittig, mit
   * Bildunterschrift. Lässt sich die Abbildung nicht zeichnen, steht stattdessen ein Hinweis; die Datei entsteht trotzdem.
   */
  const drawFigure = async (
    kind: 'graph' | 'mol' | 'abc' | 'chart',
    source: string,
    caption: string | undefined,
  ) => {
    let raster: Awaited<ReturnType<typeof rasterizeBlock>> | null = null;
    try {
      raster = await rasterizeBlock(kind, source);
    } catch {
      raster = null;
    }
    if (!raster) {
      write(FIGURE_FAILED, PAGE.left, TEXT_WIDTH, SIZE.text, false);
      y += 2.5;
      return;
    }
    let width = Math.min(TEXT_WIDTH, raster.width * PX_TO_MM * FIGURE_SCALE);
    let height = width / raster.ratio;
    if (height > MAX_FIGURE_HEIGHT) {
      height = MAX_FIGURE_HEIGHT;
      width = height * raster.ratio;
    }
    if (y + height > bottom) {
      pdf.addPage();
      y = PAGE.top;
    }
    pdf.addImage(raster.dataUrl, 'PNG', PAGE.left + (TEXT_WIDTH - width) / 2, y, width, height);
    y += height + 2;
    if (caption) {
      pdf.setTextColor(90, 90, 90);
      writeCentered(caption, SIZE.caption);
      pdf.setTextColor(0, 0, 0);
    }
    y += 3;
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
    } else if (part.type === 'table') {
      drawTable(part.header, part.rows);
      y += 4;
    } else if (part.type === 'figure') {
      await drawFigure(part.kind, part.source, part.caption);
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
