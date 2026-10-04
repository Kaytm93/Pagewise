const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** „512 B“, „48 KB“, „3,2 MB“: Größe einer Datei zur Anzeige. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / (1024 * 1024))} MB`;
}
