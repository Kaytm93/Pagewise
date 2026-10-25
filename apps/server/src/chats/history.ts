import type { ChatMessage, ContentPart } from '../providers/client';

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

/** Bild aus einem Chat-Import, das (wenn das Modell es kann) mit zum Anbieter geht. */
export interface HistoryImage {
  name: string;
  mime: string;
  data: Uint8Array;
}

/** Maximalgröße eines Bildes in Byte, das mit zum Anbieter geht (größere bleiben nur Namen im Text). */
export const IMAGE_WIRE_MAX_BYTES = 5 * 1024 * 1024;

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

/**
 * Hängt die Bilder eines Chat-Imports an die letzte Nutzer-Nachricht des Verlaufs: als Text- und
 * Bildteile (OpenAI-Format, Daten-URL). Die Dateinamen stehen immer im Text, damit auch Modelle ohne
 * Bildverstehen (Agenten, kleine Modelle) wissen, was beigelegt war. Bilder über
 * {@link IMAGE_WIRE_MAX_BYTES} werden nur als Name mitgenommen.
 */
export function attachImages(history: ChatMessage[], images: HistoryImage[]): void {
  if (images.length === 0) return;
  const target = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === 'user' && typeof message.content === 'string' && message.content !== '',
    );
  if (!target || typeof target.content !== 'string') return;
  const text = target.content;
  let names = '';
  const parts: ContentPart[] = [];
  for (const image of images) {
    names += `\n- ${image.name}`;
    if (image.data.length <= IMAGE_WIRE_MAX_BYTES) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}`,
        },
      });
    }
  }
  // Der Text steht zuerst und nennt die beigelegten Dateien beim Namen; danach folgen die Bilder.
  parts.unshift({ type: 'text', text: `${text}${names}` });
  target.content = parts;
  target.contentText = `${text}${names}`;
}

/** Titel aus der ersten Nachricht: erste nicht leere Zeile, Leerraum zusammengezogen, höchstens 60 Zeichen. */
export function titleFrom(content: string): string {
  const line = content.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  const flat = line.replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  return characters.length > 60 ? `${characters.slice(0, 59).join('').trimEnd()}…` : flat;
}
