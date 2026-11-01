import { strToU8, zipSync } from 'fflate';

/**
 * Gemeinsame Bausteine für Office-Dateien (DOCX, XLSX), die Pagewise selbst schreibt (D-077): eine ZIP-Datei mit
 * XML-Teilen. Ohne eigene Bibliothek für das Format, nur `fflate` (MIT, steckt schon in jsPDF), weil die
 * Datei-Bibliotheken für Word und Excel `eval` oder viel Gewicht mitbringen würden.
 */

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Maskiert Text für XML. Zeichen, die XML nicht kennt (Steuerzeichen), fallen weg. */
export function xmlText(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 erlaubt diese Zeichen nicht.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

export interface Part {
  path: string;
  data: string | Uint8Array;
}

/** Packt die Teile zu einer ZIP-Datei mit dem angegebenen Dateityp. */
export function packOffice(parts: Part[], mime: string): Blob {
  const files: Record<string, Uint8Array> = {};
  // „[Content_Types].xml“ steht als erster Eintrag, wie Office es schreibt.
  for (const part of parts) {
    files[part.path] = typeof part.data === 'string' ? strToU8(part.data) : part.data;
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob(
    [zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer],
    { type: mime },
  );
}

/** Bytes aus einer Daten-Adresse (`data:image/png;base64,…`). */
export function bytesOfDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const REL_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
