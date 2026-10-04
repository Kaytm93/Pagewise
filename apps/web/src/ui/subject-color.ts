/** Anzahl der Fachfarben, passend zu `[data-subj='0'…'7']` in styles/tokens.css und zum Server. */
export const SUBJECT_COLORS = 8;

/**
 * Wert für das Attribut `data-subj`: die Fachfarbe 0 bis 7 oder `undefined` ohne Farbe (dann gilt der
 * neutrale Ton). Fremde Werte (aus einer älteren oder fehlerhaften Antwort) ergeben ebenfalls `undefined`.
 */
export function subjectColorAttr(color: number | null | undefined): string | undefined {
  return typeof color === 'number' &&
    Number.isInteger(color) &&
    color >= 0 &&
    color < SUBJECT_COLORS
    ? String(color)
    : undefined;
}
