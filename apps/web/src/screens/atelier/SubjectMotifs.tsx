/**
 * Die gezeichneten Fachmotive der Richtung „Atelier“ (D-045): je Fach drei ruhige Linienmotive, die beim
 * Aufbau gestaffelt erscheinen (`mo-rise` mit `mo-i-1` … `mo-i-3` aus motion.css). Keine Flächen, keine
 * Strich-für-Strich-Animation — die Entscheidung im Projekt lautet: Motive erscheinen gestaffelt.
 *
 * Farbe kommt über `currentColor` (`.lg-motif` setzt `color: var(--subj)`), die Strichstärke über
 * `var(--hairline, 1.5)` aus atelier.css. Die Motive sind rein dekorativ und darum `aria-hidden`.
 * Ohne Bewegung (`fx-off`) steht die Gruppe sofort vollständig da; bei `fx-reduced` blendet sie kurz ein.
 */

/** Ein Motiv: Kennung (React-Key) und ein Pfad aus mehreren Linienzügen. */
type Motif = readonly [id: string, d: string];

const MOTIFS: Record<string, readonly Motif[]> = {
  book: [
    ['pages', 'M14 34 Q32 26 50 34 Q68 26 86 34 L86 62 Q68 54 50 62 Q32 54 14 62 Z M50 34 V62'],
    ['lines', 'M24 74 H44 M56 74 H76 M24 82 H62'],
    ['arc', 'M32 16 Q50 10 68 16'],
  ],
  pen: [
    ['nib', 'M50 14 L66 46 L50 62 L34 46 Z M50 30 V48 M48 54 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0'],
    ['lines', 'M20 76 H80 M20 84 H52'],
    ['arcs', 'M22 30 Q32 22 42 30 M58 30 Q68 22 78 30'],
  ],
  languages: [
    [
      'bubble',
      'M20 28 H80 Q86 28 86 34 V56 Q86 62 80 62 H46 L34 74 V62 H20 Q14 62 14 56 V34 Q14 28 20 28 Z M28 40 H64 M28 50 H52',
    ],
    ['lines', 'M22 82 H48 M56 82 H78'],
    ['arc', 'M34 16 Q50 10 66 16'],
  ],
  calculator: [
    [
      'body',
      'M30 16 H70 Q76 16 76 22 V78 Q76 84 70 84 H30 Q24 84 24 78 V22 Q24 16 30 16 Z M32 28 H68',
    ],
    [
      'keys',
      'M35 43 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M49 43 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M63 43 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M35 57 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M49 57 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M63 57 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
    ],
    ['line', 'M34 72 H66'],
  ],
  atom: [
    [
      'orbit',
      'M44 50 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M16 50 a34 15 0 1 0 68 0 a34 15 0 1 0 -68 0',
    ],
    ['orbit-cross', 'M50 16 Q22 50 50 84 Q78 50 50 16'],
    ['dot', 'M70 30 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0'],
  ],
  flask: [
    ['body', 'M40 16 V38 L24 74 Q21 82 30 82 H70 Q79 82 76 74 L60 38 V16 M34 16 H66'],
    ['liquid', 'M31 64 Q50 57 69 64'],
    [
      'bubbles',
      'M42 54 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M55 46 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0',
    ],
  ],
  microscope: [
    ['tube', 'M42 16 H58 L54 42 H46 Z M50 42 V54'],
    ['stand', 'M36 66 H64 M50 54 Q50 64 60 66 M28 82 H72 M50 66 V82'],
    ['stage', 'M22 50 Q30 44 38 50'],
  ],
  leaf: [
    ['blade', 'M50 20 Q78 34 70 62 Q50 82 30 62 Q22 34 50 20 Z M50 24 V72'],
    ['veins', 'M50 40 L38 46 M50 52 L62 58 M50 64 L42 68'],
    ['stem', 'M50 72 Q48 82 42 88'],
  ],
  globe: [
    ['sphere', 'M20 50 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0'],
    ['meridian', 'M50 20 Q34 50 50 80 Q66 50 50 20'],
    ['equator', 'M20 50 H80'],
  ],
  landmark: [
    ['roof', 'M20 40 L50 20 L80 40 Z M26 40 H74'],
    ['columns', 'M32 46 V70 M44 46 V70 M56 46 V70 M68 46 V70'],
    ['base', 'M22 78 H78'],
  ],
  scale: [
    ['post', 'M26 32 H74 M50 24 V76 M34 82 H66'],
    ['pan-left', 'M26 32 L18 50 M18 50 Q26 60 34 50 M26 32 L34 50'],
    ['pan-right', 'M74 32 L66 50 M66 50 Q74 60 82 50 M74 32 L82 50'],
  ],
  music: [
    ['notes', 'M46 26 V66 M46 26 L74 20 V58'],
    ['heads', 'M40 68 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M68 60 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0'],
    ['staff', 'M20 82 H80'],
  ],
  palette: [
    [
      'board',
      'M50 18 Q82 18 82 44 Q82 58 68 56 Q60 54 62 62 Q64 76 50 78 Q20 80 18 50 Q16 18 50 18 Z',
    ],
    [
      'pans',
      'M36 36 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M52 30 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M68 38 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
    ],
    ['stroke', 'M30 66 Q38 62 46 66'],
  ],
  sport: [
    ['bar', 'M24 50 H76 M24 36 V64 M76 36 V64'],
    ['plates', 'M16 40 V60 M84 40 V60'],
    ['arc', 'M34 74 Q50 80 66 74'],
  ],
  code: [
    ['brackets', 'M38 34 L20 50 L38 66 M62 34 L80 50 L62 66'],
    ['slash', 'M56 26 L44 74'],
    ['line', 'M28 82 H72'],
  ],
};

/** Ohne eigenes Symbol (oder bei unbekannter Kennung) das ruhige Buchmotiv, wie beim Symbol selbst. */
const FALLBACK = 'book';

export function SubjectMotifs({
  kind,
  className,
}: {
  /** Kennung des Fachsymbols (`subject.icon`), etwa „flask“; `null` und Unbekanntes zeigen das Buch. */
  kind: string | null;
  className?: string;
}) {
  const resolved = kind && MOTIFS[kind] ? kind : FALLBACK;
  const motifs = MOTIFS[resolved] ?? MOTIFS[FALLBACK] ?? [];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-motif={resolved}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `lg-motif-marks ${className}` : 'lg-motif-marks'}
    >
      {motifs.map(([id, d], index) => (
        <path key={id} className={`mo-rise mo-i-${index + 1}`} d={d} />
      ))}
    </svg>
  );
}
