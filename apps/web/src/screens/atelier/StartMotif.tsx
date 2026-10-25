/**
 * Das Zierbild der Startseite in „Atelier“ (Mockup B): ein gewölbtes Fenster mit Sprossen und schrägen
 * Lichtbändern, blass in der Linienfarbe. Eigene, einfache Linien; rein dekorativ, darum `aria-hidden`, ohne
 * Beschriftung und nicht fokussierbar.
 *
 * Wie bei den Fachmotiven (`SubjectMotifs.tsx`) tragen alle Striche `pathLength="1"` und die Klasse
 * `lg-motif-stroke`: `atelier-fach.css` lässt sie mit dem Keyframe `draw` nacheinander erscheinen, bei
 * „Reduziert“ blenden sie nur ein, bei „Aus“ steht alles sofort da. Größe, Lage und Farbe stehen in
 * `atelier.css` (`.at-start-motif`).
 */

/** Ein Strich: Kennung (React-Key) und Pfad im Raster 200 × 200. */
type Stroke = readonly [id: string, d: string];

const STROKES: readonly Stroke[] = [
  // Gewölbter Rahmen: Bogen über zwei Pfosten
  ['frame', 'M50 178 V84 A50 50 0 0 1 150 84 V178'],
  // Innenkante, einen Fingerbreit eingerückt
  ['reveal', 'M58 178 V84 A42 42 0 0 1 142 84 V178'],
  // Sprossen: eine Mittelstrebe, Kämpfer am Bogenansatz und eine Querleiste
  ['bars', 'M100 42 V178 M58 84 H142 M58 132 H142'],
  // Fensterbank
  ['sill', 'M40 178 H160 V190 H40 Z'],
  // Schräge Lichtbänder, die nach unten rechts aus dem Fenster fallen
  ['light', 'M150 60 L182 102 M152 96 L194 150 M152 134 L196 184'],
];

export function StartMotif() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 200 200" className="at-start-motif">
      {STROKES.map(([id, d], index) => (
        <path key={id} d={d} pathLength={1} className={`lg-motif-stroke mo-i-${index + 1}`} />
      ))}
    </svg>
  );
}
