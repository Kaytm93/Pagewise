import type { ChatMessage } from '../../api/types';
import { messages as m } from '../../i18n';
import type { ChatPhase } from './SubjectAtelierChat';

/*
 * Kopfzeile über jeder Antwort in der Richtung „Atelier“ (Mockup B): ein rundes Zeichen in der Fachfarbe, der Name,
 * das Modell (sofern die Nachricht es kennt) und rechts der Zustand der Antwort. Die Zeile ist rein optisch und für
 * Hilfstechnik unsichtbar: Der Zustand steht schon in der Live-Ansage der Chatansicht, im Text unter der Antwort
 * („schreibt …“, Fehlerkasten, Hinweis „gestoppt“) und das Modell in der Aktionszeile — nichts wird doppelt gehört.
 * Die Zeile hat eine feste Höhe (`atelier-fach.css`), der Wechsel des Zustands verschiebt also nichts.
 */

/** Zustand einer einzelnen Antwort aus dem, was `MessageItem` ohnehin kennt. */
export function messagePhase(
  message: Pick<ChatMessage, 'status'>,
  live: boolean,
  thinking: boolean,
): ChatPhase {
  if (live) return thinking ? 'thinking' : 'writing';
  switch (message.status) {
    case 'error':
      return 'failed';
    case 'stopped':
    case 'interrupted':
      return 'stopped';
    case 'streaming':
      return 'writing';
    default:
      return 'done';
  }
}

export function BotHead({
  message,
  live,
  thinking,
}: {
  message: Pick<ChatMessage, 'status' | 'model'>;
  live: boolean;
  thinking: boolean;
}) {
  const phase = messagePhase(message, live, thinking);
  return (
    <div aria-hidden="true" className="at-bot-head" data-state={phase}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 22 22" className="at-bot-mark">
        <circle cx="11" cy="11" r="11" fill="currentColor" />
        <path d="M7.5 5.5h5l3.5 3.5v7.5h-8.5z M12.5 5.5V9H16" className="at-bot-glyph" />
      </svg>
      <span className="at-bot-name">{m.app.name}</span>
      {message.model && <span className="at-bot-model">{message.model}</span>}
      <span className="at-bot-status">
        <span className="at-bot-dot" />
        {m.atelierFach.status[phase]}
      </span>
    </div>
  );
}
