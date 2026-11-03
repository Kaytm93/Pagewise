import type { Sheet, SheetSpec } from '@pagewise/render/sheet';
import { type Part, packOffice, REL_DOC, RELS_NS, XML_HEAD, xmlText } from './ooxml';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Spaltenbuchstaben: 0 → A, 25 → Z, 26 → AA. */
function columnName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Zellen, die mit Zeichen beginnen, die Tabellenprogramme als Formel lesen, bekommen in CSV ein `'` davor. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number, column: number, row: number, style: number): string {
  const ref = `${columnName(column)}${row}`;
  // Zahlen als Zahlen, Text immer als eingebetteter Text: Auch „=1+1“ bleibt Text und wird nie berechnet.
  if (typeof value === 'number')
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const all: { cells: (string | number)[]; head: boolean }[] = [
    ...(sheet.header ? [{ cells: sheet.header, head: true }] : []),
    ...sheet.rows.map((cells) => ({ cells, head: false })),
  ];
  const columns = (all[0]?.cells ?? []).length;
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.min(60, Math.max(8, ...all.map((row) => String(row.cells[c] ?? '').length + 2))),
  );
  const rows = all
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.cells.map((value, c) => cell(value, c, r + 1, row.head ? 1 : 0)).join('')}</row>`,
    )
    .join('');
  const view = sheet.header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  return `${XML_HEAD}<worksheet xmlns="${MAIN}">${view}<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

/**
 * Baut aus der geprüften Tabellendatei eine Excel-Datei (XLSX): ein Blatt je Eintrag, Kopfzeile fett und fixiert,
 * Spaltenbreiten nach Inhalt. Zahlen sind Zahlen, Text ist immer Text und wird nie als Formel berechnet (D-077).
 */
export function buildXlsx(spec: SheetSpec): Blob {
  const sheets = spec.sheets;
  const parts: Part[] = [
    {
      path: '[Content_Types].xml',
      data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      path: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${REL_DOC}" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      path: 'xl/workbook.xml',
      data: `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${sheets.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: `${XML_HEAD}<Relationships xmlns="${RELS_NS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    },
    { path: 'xl/styles.xml', data: STYLES },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(sheet),
    })),
  ];
  return packOffice(parts, XLSX_TYPE);
}

/** Ein CSV-Feld: Anführungszeichen, wenn nötig; Formelzeichen am Anfang werden entschärft. */
function csvField(value: string | number): string {
  // Deutsche Programme erwarten ein Komma als Dezimaltrenner und das Semikolon als Trenner.
  if (typeof value === 'number') return String(value).replace('.', ',');
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV für ein Blatt: UTF-8 mit Kennzeichen (BOM), Trenner Semikolon, Dezimalkomma, Zeilenende CRLF (so liest
 * Excel im deutschen Raum die Datei ohne Umwege). Text, der mit `=`, `+`, `-` oder `@` beginnt, bekommt ein
 * `'` davor, damit ihn kein Programm als Formel auswertet.
 */
export function buildCsv(sheet: Sheet): Blob {
  const lines = [...(sheet.header ? [sheet.header] : []), ...sheet.rows].map((row) =>
    row.map(csvField).join(';'),
  );
  return new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
}
