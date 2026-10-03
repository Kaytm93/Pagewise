import type { ChatMessage } from '../providers/client';

/**
 * Höchstmenge an Verlauf, die mit einer Anfrage an den Anbieter geht (Zeichen, ohne System-Prompt).
 * Ältere Nachrichten fallen heraus, im Chat bleiben sie sichtbar. Das ist eine grobe Schätzung ohne
 * Token-Zähler und lässt auch bei kleineren Modellen Platz für die Antwort.
 */
export const HISTORY_MAX_CHARACTERS = 150_000;

export interface StoredTurn {
  role: 'user' | 'assistant';
  content: string;
  status: string;
}

/**
 * Macht aus den gespeicherten Nachrichten den Verlauf für das Modell:
 * - Antworten ohne Text (Fehler, Abbruch, laufende Antwort) fallen weg, Teilantworten bleiben.
 * - Aufeinanderfolgende Nachrichten derselben Rolle werden verbunden, weil manche Anbieter
 *   abwechselnde Rollen verlangen (z. B. wenn eine Antwort fehlschlug und die Frage wiederholt wurde).
 * - Ist der Verlauf zu lang, fallen die ältesten Nachrichten heraus. Die letzte bleibt immer.
 * - Der Verlauf beginnt mit einer Nachricht des Nutzers.
 */
export function buildHistory(
  turns: StoredTurn[],
  maxCharacters: number = HISTORY_MAX_CHARACTERS,
): ChatMessage[] {
  const usable = turns.filter(
    (turn) => turn.role === 'user' || (turn.status !== 'streaming' && turn.content.trim() !== ''),
  );

  const merged: ChatMessage[] = [];
  for (const turn of usable) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else merged.push({ role: turn.role, content: turn.content });
  }

  let total = 0;
  let start = merged.length;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const size = [...(merged[index]?.content ?? '')].length;
    if (start < merged.length && total + size > maxCharacters) break;
    total += size;
    start = index;
  }
  const kept = merged.slice(start);
  while (kept[0] && kept[0].role !== 'user') kept.shift();
  return kept;
}

/** Titel aus der ersten Nachricht: erste nicht leere Zeile, Leerraum zusammengezogen, höchstens 60 Zeichen. */
export function titleFrom(content: string): string {
  const line = content.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  const flat = line.replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  return characters.length > 60 ? `${characters.slice(0, 59).join('').trimEnd()}…` : flat;
}
