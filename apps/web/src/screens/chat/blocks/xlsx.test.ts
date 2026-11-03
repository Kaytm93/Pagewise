import { parseSheetSpec } from '@pagewise/render/sheet';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsx } from './xlsx';

// Alle Inhalte sind erfunden.
const spec = () => {
  const result = parseSheetSpec(
    JSON.stringify({
      title: 'Beispiel-Noten',
      sheets: [
        {
          name: 'Tabelle1',
          header: ['Name', 'Punkte'],
          rows: [
            ['Beispiel A & B', 12.5],
            ['=1+1', -3],
            ['Mit "Anführung"; und Semikolon', 7],
          ],
        },
        { name: 'Zweites', rows: [['x']] },
      ],
    }),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('XLSX', () => {
  it('schreibt eine ZIP-Datei mit Arbeitsmappe, Blättern und Formatvorlage', async () => {
    const blob = buildXlsx(spec());
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const files = await unzip(blob);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const workbook = strFromU8(files['xl/workbook.xml'] as Uint8Array);
    expect(workbook).toContain('name="Tabelle1"');
    expect(workbook).toContain('name="Zweites"');
  });

  it('setzt Zahlen als Zahlen und Text immer als Text, auch wenn er mit = beginnt', async () => {
    const files = await unzip(buildXlsx(spec()));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] as Uint8Array);
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>-3</v></c>');
    expect(sheet).toContain(
      '<c r="A3" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>',
    );
    expect(sheet).not.toContain('<f>');
    // Maskierung
    expect(sheet).toContain('Beispiel A &amp; B');
    // Kopfzeile fett und fixiert
    expect(sheet).toContain('s="1"');
    expect(sheet).toContain('state="frozen"');
  });
});

describe('CSV', () => {
  it('schreibt BOM, Semikolon, Dezimalkomma und entschärft Formeln', async () => {
    const blob = buildCsv(spec().sheets[0] as never);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // UTF-8-Kennzeichen (BOM): `Blob.text()` würde es verschlucken, darum die Bytes prüfen.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = `\uFEFF${new TextDecoder().decode(bytes.slice(3))}`;
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Name;Punkte');
    expect(lines[1]).toBe('Beispiel A & B;12,5');
    expect(lines[2]).toBe("'=1+1;-3");
    expect(lines[3]).toBe('"Mit ""Anführung""; und Semikolon";7');
  });
});
