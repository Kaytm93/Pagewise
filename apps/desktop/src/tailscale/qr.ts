import { encode } from 'uqr';

/**
 * QR-Code als Pfad für ein SVG, ohne `style`-Attribut (die CSP des Fensters erlaubt keine Inline-Styles). Die Seite
 * baut daraus per DOM ein `<svg>` mit einem `<path d="…">`: kein Bild, kein `data:`. Bibliothek: `uqr` 0.1.3
 * (MIT, ohne Abhängigkeiten, nach Project Nayuki), geprüft am 4. Oktober 2026.
 */
export interface QrPath {
  /** Seitenlänge in Modulen einschließlich des freien Rands (Vorgabe der QR-Norm: 4). */
  size: number;
  /** Pfaddaten `M x y h n v1 h-n z` je waagrechter Folge dunkler Module. */
  path: string;
}

const QUIET_ZONE = 4;

export function qrPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = data[y] ?? [];
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < size && row[end]) end += 1;
      parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  return { size: size + QUIET_ZONE * 2, path: parts.join('') };
}

/** Die Seite setzt den Pfad in ein Attribut: nur diese Zeichen sind darin erlaubt. */
export const QR_PATH_PATTERN = /^[MhvzHVZ0-9 .-]*$/;
