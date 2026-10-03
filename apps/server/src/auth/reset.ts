import type { Db } from '../db/client';
import { authCredentials, sessions } from '../db/schema';

/**
 * Entfernt Passcode und alle Sitzungen, sonst nichts: Fächer, Chats und Einstellungen bleiben.
 * Gedacht für ein lokales Kommando, wer es ausführen kann, hat ohnehin Zugriff auf die Daten.
 * Beim nächsten Start gibt es wieder einen Einrichtungscode.
 */
export function resetAccess(db: Db): void {
  db.delete(sessions).run();
  db.delete(authCredentials).run();
}
