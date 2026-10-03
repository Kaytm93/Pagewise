import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatService } from '../chats/service';
import type { DatabaseHandle } from '../db/client';
import type { DataPaths } from './data-paths';
import type { SecretStore } from './secret-store';

/**
 * „Alles löschen“: entfernt alle Inhalte, die Pagewise für dich gespeichert hat. Passcode und Anmeldung
 * bleiben, damit du Pagewise danach sofort neu einrichten kannst (Onboarding startet wieder).
 *
 * Gelöscht werden: Fächer, Untergruppen, Chats, Nachrichten, Profilangaben, Prompts, Anbieter samt
 * Schlüsseln und Einstellungen, alle Dateien in `assets`, `workspaces`, `logs` und die Sicherungen in
 * `backups` (sie enthalten ebenfalls die alten Inhalte). Danach wird die Datenbank verdichtet, damit
 * gelöschter Inhalt nicht in freien Seiten oder im Protokoll der Datenbank liegen bleibt.
 */
export class DataEraser {
  constructor(
    private readonly deps: {
      database: DatabaseHandle;
      paths: DataPaths;
      secrets: SecretStore;
      chats: ChatService;
    },
  ) {}

  async eraseAll(): Promise<void> {
    const { database, paths, secrets, chats } = this.deps;

    // Laufende Antworten zuerst beenden, damit sie nichts mehr in die Datenbank schreiben.
    await chats.stopAll();

    for (const secret of await secrets.list()) await secrets.delete(secret.name);

    database.sqlite.transaction(() => {
      for (const table of [
        'messages',
        'chats',
        'subject_groups',
        'subjects',
        'providers',
        'settings',
        'profile',
      ]) {
        database.sqlite.prepare(`delete from ${table}`).run();
      }
    })();

    for (const dir of [paths.assets, paths.workspaces, paths.logs, paths.backups]) {
      for (const name of readdirSync(dir))
        rmSync(join(dir, name), { recursive: true, force: true });
    }

    // Das WAL-Protokoll leeren und freie Seiten zurückgeben (mit `secure_delete` überschrieben).
    database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    database.sqlite.exec('VACUUM');
    database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }
}
