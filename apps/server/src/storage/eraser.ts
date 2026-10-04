import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatService } from '../chats/service';
import type { DatabaseHandle } from '../db/client';
import { ensureDefaultSubject } from '../domain/subjects';
import type { DataPaths } from './data-paths';
import type { SecretStore } from './secret-store';

/**
 * „Alles löschen“: entfernt alle Inhalte, die Pagewise für dich gespeichert hat. Passcode und Anmeldung
 * bleiben, damit du Pagewise danach sofort neu einrichten kannst (Onboarding startet wieder).
 *
 * Gelöscht werden: Fächer, Untergruppen, Chats, Nachrichten, Profilangaben, Prompts, Anbieter samt
 * Schlüsseln und Einstellungen, alle Dateien in `assets`, `workspaces`, `engine` (Sitzungen der Agenten), `logs` und die Sicherungen in
 * `backups` (sie enthalten ebenfalls die alten Inhalte). Danach wird die Datenbank verdichtet, damit
 * gelöschter Inhalt nicht in freien Seiten oder im Protokoll der Datenbank liegen bleibt.
 *
 * Die Tabellen werden nicht aufgezählt, sondern aus der Datenbank gelesen: Alles außer Anmeldung und
 * Migrationsprotokoll wird geleert. So bleibt keine künftige Tabelle (Stundenplan, Tests …) übrig. Das
 * eingebaute Fach „Standard“ enthält nichts vom Nutzer und wird danach frisch angelegt.
 */
/** Tabellen, die „Alles löschen“ stehen lässt: Passcode und Sitzungen sowie das Protokoll der Migrationen. */
const KEPT_TABLES = new Set(['auth_credentials', 'sessions', '__drizzle_migrations']);

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
      const tables = database.sqlite
        .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
        .all() as { name: string }[];
      for (const { name } of tables) {
        if (KEPT_TABLES.has(name)) continue;
        // Namen stammen aus der Datenbank selbst, nie aus einer Eingabe.
        database.sqlite.prepare(`delete from "${name.replaceAll('"', '""')}"`).run();
      }
    })();
    ensureDefaultSubject(database.db);

    for (const dir of [paths.assets, paths.workspaces, paths.logs, paths.backups]) {
      for (const name of readdirSync(dir))
        rmSync(join(dir, name), { recursive: true, force: true });
    }
    // Eigene Konfigurationen und Sitzungen der Agenten (enthalten Verläufe der Chats).
    rmSync(join(paths.root, 'engine'), { recursive: true, force: true });

    // Das WAL-Protokoll leeren und freie Seiten zurückgeben (mit `secure_delete` überschrieben).
    database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    database.sqlite.exec('VACUUM');
    database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }
}
