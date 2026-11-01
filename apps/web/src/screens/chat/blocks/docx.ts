import type { DocumentSpec } from '@pagewise/render/document';
import {
  bytesOfDataUrl,
  type Part,
  packOffice,
  REL_DOC,
  RELS_NS,
  XML_HEAD,
  xmlText,
} from './ooxml';
import { rasterizeBlock } from './raster';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const EMU_PER_PX = 9525;
/** Breite des Textbereichs (A4 mit 22 mm Rand) in Pixeln bei 96 dpi; Abbildungen sind höchstens so breit. */
const TEXT_WIDTH_PX = 620;
const MAX_FIGURE_HEIGHT_PX = 460;
const FIGURE_SCALE = 1.2;

const FALLBACK_TEXT = '(Abbildung konnte nicht gezeichnet werden)';

const run = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;

const paragraph = (content: string, props = '') =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;

function table(header: string[] | undefined, rows: string[][]): string {
  const columns = (rows[0] ?? []).length;
  const width = Math.floor(9000 / columns);
  const cell = (text: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${paragraph(run(text, head ? '<w:b/>' : ''), '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
  const line = (cells: string[], head: boolean) =>
    `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((text) => cell(text, head)).join('')}</w:tr>`;
  const border = (name: string) =>
    `<w:${name} w:val="single" w:sz="4" w:space="0" w:color="BEBEBE"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * columns}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header ? line(header, true) : ''}${rows.map((cells) => line(cells, false)).join('')}</w:tbl>${paragraph('')}`;
}

function picture(id: number, rel: string, widthPx: number, heightPx: number, name: string) {
  const cx = Math.round(widthPx * EMU_PER_PX);
  const cy = Math.round(heightPx * EMU_PER_PX);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xmlText(name)}" descr="${xmlText(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlText(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const STYLES = `${XML_HEAD}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr><w:rPr><w:i/><w:color w:val="5A5A5A"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;

const NUMBERING = `${XML_HEAD}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

/**
 * Baut aus dem geprüften Dokument eine Word-Datei (DOCX, A4, Arial). Titel, Überschriften, Absätze, Aufzählungen
 * und Tabellen sind echte Word-Elemente; Abbildungen (Graph, Molekül, Noten) sind PNG-Bilder wie im PDF
 * (D-077). Lässt sich eine Abbildung nicht zeichnen, steht ein Hinweis, die Datei entsteht trotzdem.
 */
export async function buildDocx(spec: DocumentSpec): Promise<Blob> {
  const body: string[] = [];
  const media: Part[] = [];
  const rels: string[] = [];
  let nextImage = 1;

  body.push(paragraph(run(spec.title), '<w:pStyle w:val="Title"/>'));
  for (const part of spec.parts) {
    if (part.type === 'heading') {
      body.push(paragraph(run(part.text), '<w:pStyle w:val="Heading1"/>'));
    } else if (part.type === 'paragraph') {
      body.push(paragraph(run(part.text)));
    } else if (part.type === 'list') {
      for (const item of part.items) {
        body.push(
          paragraph(
            run(item),
            '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
          ),
        );
      }
    } else if (part.type === 'table') {
      body.push(table(part.header, part.rows));
    } else {
      let raster: Awaited<ReturnType<typeof rasterizeBlock>> | null = null;
      try {
        raster = await rasterizeBlock(part.kind, part.source);
      } catch {
        raster = null;
      }
      if (!raster) {
        body.push(paragraph(run(FALLBACK_TEXT)));
        continue;
      }
      let width = Math.min(TEXT_WIDTH_PX, raster.width * FIGURE_SCALE);
      let height = width / raster.ratio;
      if (height > MAX_FIGURE_HEIGHT_PX) {
        height = MAX_FIGURE_HEIGHT_PX;
        width = height * raster.ratio;
      }
      const index = nextImage;
      nextImage += 1;
      const rel = `rId${index + 10}`;
      media.push({ path: `word/media/image${index}.png`, data: bytesOfDataUrl(raster.dataUrl) });
      rels.push(`<Relationship Id="${rel}" Type="${R}/image" Target="media/image${index}.png"/>`);
      body.push(
        paragraph(
          picture(index, rel, width, height, part.caption ?? 'Abbildung'),
          '<w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/>',
        ),
      );
      if (part.caption) body.push(paragraph(run(part.caption), '<w:pStyle w:val="Caption"/>'));
    }
  }

  const document = `${XML_HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1361" w:right="1247" w:bottom="1247" w:left="1247" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const parts: Part[] = [
    {
      path: '[Content_Types].xml',
      data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      path: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${REL_DOC}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      path: 'docProps/core.xml',
      data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(spec.title)}</dc:title><dc:creator>Pagewise</dc:creator></cp:coreProperties>`,
    },
    {
      path: 'word/_rels/document.xml.rels',
      data: `${XML_HEAD}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>`,
    },
    { path: 'word/document.xml', data: document },
    { path: 'word/styles.xml', data: STYLES },
    { path: 'word/numbering.xml', data: NUMBERING },
    ...media,
  ];
  return packOffice(parts, DOCX_TYPE);
}
