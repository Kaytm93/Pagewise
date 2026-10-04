import type { Api } from '../../api/api';
import type { Chat } from '../../api/types';

/**
 * Ein leerer Chat im eingebauten Fach „Standard“: ein vorhandener leerer wird weiterverwendet, damit kein
 * Stapel leerer Chats entsteht, sonst entsteht ein neuer.
 */
export async function emptyDefaultChat(api: Api, defaultSubjectId: string): Promise<Chat> {
  const chats = await api.chats(defaultSubjectId, null);
  return (
    chats.find((entry) => entry.title === '') ?? (await api.createChat(defaultSubjectId, null))
  );
}

/**
 * Nachrichten, die gesendet werden sollen, sobald ihr Chat geöffnet ist (zum Beispiel die Frage von der
 * Startseite). Sie liegen nur im Speicher dieser Seite und werden beim Abholen entfernt.
 */
const queued = new Map<string, string>();

export function queueSend(chatId: string, text: string): void {
  queued.set(chatId, text);
}

export function takeQueuedSend(chatId: string): string | undefined {
  const text = queued.get(chatId);
  queued.delete(chatId);
  return text;
}
