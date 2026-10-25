/**
 * Speichert eine Datei aus dem Speicher: ein Link mit `download` auf eine Objekt-Adresse, der gleich angeklickt
 * wird. Die Adresse bleibt kurz bestehen, damit der Browser den Download sicher beginnt, und wird danach
 * freigegeben. Ohne Netz: die Datei kommt nie von einem Server.
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Dateiname aus dem Titel: ohne Zeichen, die Dateisysteme nicht mögen, und höchstens 80 Zeichen. */
export function fileName(title: string, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${base || 'Dokument'}.${extension}`;
}
