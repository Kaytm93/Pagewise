/** Höchstgröße, die der Server annimmt (siehe `timetable-scan/image.ts`). */
export const MAX_SCAN_IMAGE_BYTES = 6 * 1024 * 1024;
/** Größere Dateien werden gar nicht erst in den Speicher geholt. */
export const MAX_CLIENT_IMAGE_BYTES = 20 * 1024 * 1024;
/** Längste Kante nach dem Verkleinern: genug für kleine Schrift, klein genug für den Versand. */
const MAX_EDGE = 1800;

type Source = CanvasImageSource & { width: number; height: number; close?: () => void };

/**
 * Liest das Bild im Browser. `createImageBitmap` ist der übliche Weg, der Rückfall nutzt ein
 * `Image` mit `decode()`. Beide Wege landen im selben Canvas-Schritt.
 */
async function decode(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Zeichnet das Bild neu: verkleinert, weißer Hintergrund (transparente Stellen werden nicht
 * schwarz) und JPEG-Ausgabe. Das Entfernen von EXIF und anderen Metadaten passiert hier schon
 * im Browser; der Server prüft und bereinigt zusätzlich. Das Original verlässt das Gerät nie.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  const source = await decode(file);
  try {
    const edge = Math.max(source.width, source.height);
    if (edge < 1) throw new Error('invalid_image');
    const scale = Math.min(1, MAX_EDGE / edge);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no_canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!blob) throw new Error('no_blob');
    return blob;
  } finally {
    source.close?.();
  }
}
