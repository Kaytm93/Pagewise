import type { ReactElement, Ref, SVGProps } from 'react';
import { messages as m } from '../i18n';

/**
 * Eigene Linien-Motive für die Fächer (D-110). Der Server speichert nur die Kennung (z. B. „flask“). Ein Fach
 * ohne Kennung oder mit unbekannter Kennung zeigt das neutrale Motiv (Abschlusshut), kein Buch mehr. Die Namen für
 * Bildschirmleser stehen in `i18n/de.ts` (`subjectDialog.iconNames`).
 *
 * Alle Motive teilen ein Raster und eine Rundung:
 * - 24 × 24, gezeichnet zwischen 2 und 22 (2 Einheiten Rand), nur absolute Pfadbefehle;
 * - nur Linien: `fill="none"`, `stroke="currentColor"`, runde Enden und runde Ecken;
 * - Strichstärke 1,6 im Normalfall, hauchdünn (0,4) als großes Motiv auf der Fachseite (`strokeWidth`);
 * - höchstens fünf Formen je Motiv, damit es bei 18 px lesbar bleibt.
 * Die Fachfarbe färbt das Motiv über `currentColor`; sie ist Akzent, nie Teil der Zeichnung.
 */

/** Eine Form im 24er-Raster: Pfad, Kreis `[cx, cy, r]` oder Rechteck `[x, y, breite, höhe, radius]`. */
type Shape =
  | string
  | readonly [cx: number, cy: number, r: number]
  | readonly [x: number, y: number, width: number, height: number, radius: number];

export type SubjectGlyphProps = Omit<SVGProps<SVGSVGElement>, 'strokeWidth' | 'ref'> & {
  /** Kennung des Fachs; `null` und Unbekanntes zeichnen das neutrale Motiv. */
  icon: string | null;
  ref?: Ref<SVGSVGElement>;
  /** Strichstärke im 24er-Raster. */
  strokeWidth?: number;
};

/** Strichstärke im Normalfall (Listen, Seitenleiste, Auswahl). */
export const SUBJECT_ICON_STROKE = 1.6;

/** Die Zeichnungen. Schlüssel = Kennung; `neutral` ist das Motiv für Fächer ohne (bekannte) Kennung. */
export const SUBJECT_MOTIFS = {
  // Aufgeschlagenes Buch: zwei Seiten, die sich am Rücken treffen (oben wie unten geschlossen).
  book: [
    'M12 6.5 C10 5 7 4.5 3.5 5 V18.5 C7 18 10 18.5 12 20',
    'M12 6.5 C14 5 17 4.5 20.5 5 V18.5 C17 18 14 18.5 12 20',
    'M12 6.5 V20',
  ],
  // Bleistift, schräg: Schaft, Zwinge, Spitze.
  pen: [
    'M4 20 L6.4 14.2 L16.2 4.4 L19.6 7.8 L9.8 17.6 Z',
    'M6.4 14.2 L9.8 17.6',
    'M13.7 6.9 L17.1 10.3',
  ],
  // Zwei Sprechblasen, die vordere mit einer Textzeile.
  languages: [
    'M4 4.5 H13 A2 2 0 0 1 15 6.5 V10.5 A2 2 0 0 1 13 12.5 H8 L5 15 V12.5 H4 A2 2 0 0 1 2 10.5 V6.5 A2 2 0 0 1 4 4.5 Z',
    'M18 9.5 H20 A2 2 0 0 1 22 11.5 V15.5 A2 2 0 0 1 20 17.5 H19 V20 L16 17.5 H11 A2 2 0 0 1 9 15.5 V15',
    'M5.5 8.5 H11.5',
  ],
  // Mathematik: die vier Rechenzeichen Plus, Minus, Mal und Gleich.
  calculator: [
    'M4 7 H10 M7 4 V10',
    'M14 7 H20',
    'M4.9 14.9 L9.1 19.1 M9.1 14.9 L4.9 19.1',
    'M14 15.5 H20 M14 18.5 H20',
  ],
  // Atom: zwei gekreuzte Bahnen um einen Kern.
  atom: [
    'M3.87 3.87 A11.5 4.6 45 1 0 20.13 20.13 A11.5 4.6 45 1 0 3.87 3.87',
    'M3.87 20.13 A11.5 4.6 -45 1 0 20.13 3.87 A11.5 4.6 -45 1 0 3.87 20.13',
    [12, 12, 1.2],
  ],
  // Erlenmeyerkolben mit Rand und Füllstand.
  flask: [
    'M8.5 3 H15.5',
    'M10 3 V9 L4.7 18 Q2.9 21 6.5 21 H17.5 Q21.1 21 19.3 18 L14 9 V3',
    'M6.5 15 H17.5',
  ],
  // Mikroskop: Tubus, Objektiv, Tisch, Bügel und Fuß.
  microscope: [
    [9, 3, 4, 9, 1.2],
    'M11 12 V14.5',
    'M13 6.5 H14 A7.25 7.25 0 0 1 14 21',
    'M7 16.5 H20.7',
    'M5 21 H19',
  ],
  // Blatt mit Mittelrippe und Stiel.
  leaf: ['M5 19 C5 10 10 4 20 4 C20 14 14 19 5 19 Z', 'M3.5 20.5 L13 11'],
  // Globus: Kugel, Äquator, Meridian.
  globe: [
    [12, 12, 9.5],
    'M2.5 12 H21.5',
    'M12 2.5 C8.4 6.2 8.4 17.8 12 21.5 C15.6 17.8 15.6 6.2 12 2.5 Z',
  ],
  // Säulenbau: Giebel, drei Säulen, Sockel.
  landmark: [
    'M3 9 L12 3.5 L21 9 Z',
    'M6.5 12 V17.5 M12 12 V17.5 M17.5 12 V17.5',
    'M3.5 20.5 H20.5',
  ],
  // Balkenwaage: Ständer mit Fuß, Balken, zwei Schalen.
  scale: [
    'M12 5 V20 M8 20 H16',
    'M5 6.5 H19',
    'M5 6.5 L2.5 13 A2.5 2.5 0 0 0 7.5 13 Z M2.5 13 H7.5',
    'M19 6.5 L16.5 13 A2.5 2.5 0 0 0 21.5 13 Z M16.5 13 H21.5',
  ],
  // Zwei verbundene Noten mit Doppelbalken.
  music: ['M9 17.5 V6 L19 4 V15.5', 'M9 9.5 L19 7.5', [6.5, 17.5, 2.5], [16.5, 15.5, 2.5]],
  // Malerpalette mit Daumenbucht und drei Farbtupfern.
  palette: [
    'M12 3.5 C6.8 3.5 2.8 7.2 2.8 12 C2.8 16.8 6.8 20.5 12 20.5 C13.4 20.5 14.2 19.6 14.2 18.5 C14.2 17.2 13.2 16.8 13.2 15.6 C13.2 14.5 14.1 13.8 15.2 13.8 H17.2 C19.6 13.8 21.2 12.2 21.2 10.2 C21.2 6.4 17.1 3.5 12 3.5 Z',
    [7.4, 12, 1],
    [9.6, 7.8, 1],
    [14.4, 7.2, 1],
  ],
  // Hantel, waagerecht: Stange, zwei Scheiben, zwei Enden.
  sport: [
    'M8.5 12 H15.5',
    [5.5, 6.5, 3, 11, 1.2],
    [15.5, 6.5, 3, 11, 1.2],
    'M3 9.5 V14.5 M21 9.5 V14.5',
  ],
  // Quelltext: spitze Klammern mit Schrägstrich.
  code: ['M8 7.5 L3.5 12 L8 16.5', 'M16 7.5 L20.5 12 L16 16.5', 'M13.5 5 L10.5 19'],
  // Neutral (ohne Kennung): Abschlusshut mit Quaste, steht für „ein Schulfach“.
  neutral: [
    'M12 4.5 L22 9.5 L12 14.5 L2 9.5 Z',
    'M6.5 11.8 V16 C6.5 17.9 9 19.5 12 19.5 C15 19.5 17.5 17.9 17.5 16 V11.8',
    'M22 9.5 V15',
  ],
} as const satisfies Record<string, readonly Shape[]>;

type MotifId = keyof typeof SUBJECT_MOTIFS;

const names = m.subjectDialog.iconNames;

/** Die wählbaren Motive in der Reihenfolge der Auswahl. `neutral` ist nicht wählbar. */
export const SUBJECT_ICONS: { id: string; label: string }[] = (
  Object.keys(names) as (keyof typeof names & MotifId)[]
).map((id) => ({ id, label: names[id] }));

const selectable = new Set(SUBJECT_ICONS.map((entry) => entry.id));

/** Die Zeichnung zu einer Kennung; `null` und Unbekanntes ergeben das neutrale Motiv. */
function motifId(icon: string | null): MotifId {
  return icon && selectable.has(icon) ? (icon as MotifId) : 'neutral';
}

function shapeElement(shape: Shape): ReactElement {
  if (typeof shape === 'string') return <path key={shape} d={shape} />;
  if (shape.length === 3) {
    const [cx, cy, r] = shape;
    return <circle key={shape.join(' ')} cx={cx} cy={cy} r={r} />;
  }
  const [x, y, width, height, radius] = shape;
  return <rect key={shape.join(' ')} x={x} y={y} width={width} height={height} rx={radius} />;
}

/**
 * Die Zeichnung selbst, als SVG mit `ref`, `className` und `strokeWidth` (für das große Motiv der Richtung
 * „Lagen“, das seine Formen nach dem Einhängen zum Zeichnen markiert). Immer reine Zier: Der Name des Fachs steht
 * daneben, die Namen der Motive in der Auswahl kommen aus `de.ts`.
 */
export function SubjectGlyph({
  icon,
  strokeWidth = SUBJECT_ICON_STROKE,
  ...rest
}: SubjectGlyphProps) {
  const id = motifId(icon);
  const shapes: readonly Shape[] = SUBJECT_MOTIFS[id];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={id}
      {...rest}
    >
      {shapes.map(shapeElement)}
    </svg>
  );
}

export function SubjectIcon({
  icon,
  className = 'size-[18px]',
  strokeWidth = SUBJECT_ICON_STROKE,
}: {
  icon: string | null;
  className?: string;
  /** Strichstärke im 24er-Raster. Das große Motiv auf der Fachseite ist hauchdünn. */
  strokeWidth?: number;
}) {
  return <SubjectGlyph icon={icon} strokeWidth={strokeWidth} className={className} />;
}
