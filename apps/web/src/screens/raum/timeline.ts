/**
 * Zeitachse der Startseite in der Richtung „Raum“ (D-045): die Stunden von heute als Karten an ihrer Uhrzeit,
 * dazu die „Jetzt“-Marke an der berechneten Stelle. Reine Rechnung ohne Darstellung, damit sie mit fester Uhr
 * prüfbar ist; `StartPlan.tsx` setzt die Zahlen als CSS-Variablen (`--at`, `--len`, `--now`).
 *
 * Maße in Minuten ab dem Beginn der ersten Stunde. Das Umrechnen in Pixel erledigt die CSS-Variable
 * `--tl-unit` (Pixel je Minute).
 */

/** Lücken kürzer als das sind keine Pause, sondern nur ein Wechsel. */
export const MIN_BREAK = 5;

/** Pixel je Minute: mindestens so viel, dass eine Karte zwei Zeilen Text trägt. */
const MIN_UNIT = 1.4;
const MAX_UNIT = 3;
/** Höhe, die auch die kürzeste Karte haben soll (Name und Zeile darunter). */
const CARD_MIN_PX = 60;

/** Höhe der Startzeit in der Zeitspalte (13 px Schrift, Zeilenhöhe 16 px, 3 px Abstand oben). */
const TIME_LABEL_TOP = 1;
const TIME_LABEL_BOTTOM = 19;
/** Höhe des Jetzt-Zettels in der Zeitspalte: zwei Zeilen („Jetzt“ und die Uhrzeit). */
export const NOW_LABEL_HEIGHT = 30;

export type LessonState = 'past' | 'now' | 'next';

export interface DayLesson {
  id: string;
  /** Minuten seit Mitternacht */
  start: number;
  end: number;
}

export interface LessonBlock {
  kind: 'lesson';
  id: string;
  /** Beginn der Karte ab Achsenanfang; bei Überschneidung hinter die vorige Stunde geschoben. */
  at: number;
  len: number;
  state: LessonState;
  /** Index in der übergebenen Liste (nach Sortierung) */
  index: number;
}

export interface BreakBlock {
  kind: 'break';
  id: string;
  at: number;
  len: number;
  /** Echte Dauer der Lücke in Minuten */
  minutes: number;
}

export type Block = LessonBlock | BreakBlock;

export interface Timeline {
  /** Minute des Achsenanfangs (Beginn der ersten Stunde) */
  origin: number;
  /** Länge der Achse in Minuten */
  span: number;
  /** Pixel je Minute */
  unit: number;
  blocks: Block[];
  /** Stelle der Marke ab Achsenanfang, auf die Achse begrenzt */
  nowAt: number;
  /** Index der laufenden Stunde, sonst −1 */
  runningIndex: number;
  /** Index der Stunde, vor der die Marke im Dokument steht (laufend, sonst nächste, sonst Länge) */
  markerBefore: number;
  /** Versatz des Jetzt-Zettels zur Marke in Pixel (zentriert, darunter oder darüber) */
  nowLabelShift: number;
}

export function stateOf(start: number, end: number, minutes: number): LessonState {
  return end <= minutes ? 'past' : start <= minutes ? 'now' : 'next';
}

/**
 * Legt den Tag auf die Achse. `lessons` muss nicht sortiert sein. Überschneidungen werden nicht
 * übereinandergelegt: die spätere Karte beginnt dann dort, wo die vorige endet (Zeit und Zustand
 * bleiben die echten).
 */
export function layoutTimeline(lessons: readonly DayLesson[], minutes: number): Timeline {
  const sorted = [...lessons].sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) {
    return {
      origin: minutes,
      span: 0,
      unit: MIN_UNIT,
      blocks: [],
      nowAt: 0,
      runningIndex: -1,
      markerBefore: 0,
      nowLabelShift: -NOW_LABEL_HEIGHT / 2,
    };
  }

  const origin = Math.min(...sorted.map((lesson) => lesson.start));
  const last = Math.max(...sorted.map((lesson) => lesson.end));
  const span = Math.max(last - origin, 1);
  const lengths = sorted.map((lesson) => lesson.end - lesson.start).filter((len) => len > 0);
  const shortest = lengths.length > 0 ? Math.min(...lengths) : 45;
  const unit =
    Math.round(Math.min(MAX_UNIT, Math.max(MIN_UNIT, CARD_MIN_PX / shortest)) * 100) / 100;

  const blocks: Block[] = [];
  let cursor = origin;
  sorted.forEach((lesson, index) => {
    const gap = lesson.start - cursor;
    if (index > 0 && gap >= MIN_BREAK) {
      blocks.push({
        kind: 'break',
        id: `pause-${lesson.id}`,
        at: cursor - origin,
        len: gap,
        minutes: gap,
      });
    }
    const at = Math.max(lesson.start, cursor);
    const len = Math.max(lesson.end - at, 10);
    blocks.push({
      kind: 'lesson',
      id: lesson.id,
      at: at - origin,
      len,
      state: stateOf(lesson.start, lesson.end, minutes),
      index,
    });
    cursor = Math.max(cursor, at + len);
  });

  const runningIndex = sorted.findIndex(
    (lesson) => stateOf(lesson.start, lesson.end, minutes) === 'now',
  );
  const firstNext = sorted.findIndex(
    (lesson) => stateOf(lesson.start, lesson.end, minutes) === 'next',
  );
  const markerBefore =
    runningIndex !== -1 ? runningIndex : firstNext !== -1 ? firstNext : sorted.length;
  const nowAt = Math.min(Math.max(minutes, origin), origin + span) - origin;

  return {
    origin,
    span,
    unit,
    blocks,
    nowAt,
    runningIndex,
    markerBefore,
    nowLabelShift: labelShift(
      nowAt * unit,
      blocks
        .filter((block): block is LessonBlock => block.kind === 'lesson')
        .map((b) => b.at * unit),
    ),
  };
}

/**
 * Der Jetzt-Zettel steht in der Zeitspalte neben der Marke und darf keine Startzeit einer Stunde überdecken.
 * Gesucht wird der Versatz (in ganzen Pixeln, 36 px nach oben bis 18 px nach unten), der keine Startzeit
 * berührt und möglichst nahe an der zentrierten Lage liegt. Gibt es keinen, bleibt der Zettel zentriert.
 * Gibt den Versatz des Zettels zur Marke in Pixel zurück.
 */
export function labelShift(markerPx: number, lessonTopsPx: readonly number[]): number {
  const centered = -NOW_LABEL_HEIGHT / 2;
  let best = centered;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let shift = -NOW_LABEL_HEIGHT - 6; shift <= 18; shift += 1) {
    const top = markerPx + shift;
    const bottom = top + NOW_LABEL_HEIGHT;
    const clear = lessonTopsPx.every(
      (lessonTop) => bottom <= lessonTop + TIME_LABEL_TOP || top >= lessonTop + TIME_LABEL_BOTTOM,
    );
    const cost = Math.abs(shift - centered);
    if (clear && cost < bestCost) {
      best = shift;
      bestCost = cost;
    }
  }
  return best;
}
