import { basename } from 'node:path';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { backupDatabase, type DatabaseHandle } from '../db/client';
import { messages, notes, settings } from '../db/schema';

/**
 * Einmalige Bereinigung doppelter Hefteinträge aus dem Chat (D-121, F-020). Vor D-121 legte jedes
 * „Als Hefteintrag speichern“ einen neuen Eintrag an, auch wenn es zur selben Antwort schon einen gab.
 * Beim ersten Start nach dem Update verschwinden **wortgleiche** Doppel: gleiche Herkunft (Chat und
 * Nachricht), gleiches Fach und gleiche Untergruppe, gleicher Titel, gleicher Text, gleiche Stichwörter,
 * gleiche Anheftung. Von jeder solchen Gruppe bleibt der älteste Eintrag (kleinste Erstellzeit); zeigt
 * ein Text (anderer Hefteintrag, Chat-Nachricht) auf die ID eines Eintrags, bleibt stattdessen dieser.
 * Bearbeitete Einträge (irgendein Feld anders) bleiben alle, ebenso Einträge ohne Herkunft oder aus
 * gelöschten Chats (`source_chat_id` ist dann `null`, die Herkunft nicht mehr feststellbar).
 *
 * Vorher entsteht eine Sicherung (`VACUUM INTO`, neben den Sicherungen vor Migrationen); scheitert sie,
 * wird nichts gelöscht, und der Server startet trotzdem. Lief die Bereinigung einmal durch, merkt sich
 * das eine Markierung in `settings`; danach ist sie wirkungslos (neue Doppel entstehen seit D-121 nicht).
 */

/** Markierung in `settings`: die Bereinigung ist gelaufen (Wert: Zeitpunkt, Zahl der entfernten Einträge). */
export const DEDUPE_MARKER_KEY = 'notes.dedupe_chat_duplicates';
/** Dateianfang der Sicherung vor der Bereinigung (im Ordner `backups` des Datenverzeichnisses). */
export const DEDUPE_BACKUP_PREFIX = 'pagewise-vor-bereinigung-hefteintraege-';

export interface DedupeOptions {
  /** Ordner für die Sicherung; ohne Angabe oder wenn die Sicherung scheitert, wird nichts gelöscht. */
  backupDir: string | null;
  now?: () => Date;
  /** Protokoll für Menschen; nie Inhalte von Einträgen. Standard: Konsole. */
  log?: (message: string) => void;
}

export type DedupeResult =
  /** Schon gelaufen, nichts getan. */
  | { status: 'skipped' }
  /** Gelaufen; `removed` Einträge weg, `backup` die Sicherung (`null`, wenn es nichts zu löschen gab). */
  | { status: 'done'; removed: number; backup: string | null }
  /** Sicherung nicht möglich: nichts gelöscht, keine Markierung, beim nächsten Start neuer Versuch. */
  | { status: 'backup_failed' }
  /** Unerwarteter Fehler (Transaktion zurückgerollt): nichts gelöscht, keine Markierung. */
  | { status: 'failed' };

/** Was zwei Einträge wortgleich macht: alles außer ID und Zeiten. */
function keyOf(row: typeof notes.$inferSelect): string {
  return JSON.stringify([
    row.sourceChatId,
    row.sourceMessageId,
    row.subjectId,
    row.groupId,
    row.title,
    row.markdown,
    row.pinned,
    row.tags,
  ]);
}

/** Steht die ID in einem Text (anderer Eintrag, Chat-Nachricht)? Dann zeigt etwas auf den Eintrag. */
function isReferenced(db: DatabaseHandle['db'], id: string): boolean {
  const pattern = `%${id}%`;
  const inNote = db
    .select({ id: notes.id })
    .from(notes)
    .where(and(sql`${notes.id} != ${id}`, sql`${notes.markdown} like ${pattern}`))
    .get();
  if (inNote) return true;
  const inMessage = db
    .select({ id: messages.id })
    .from(messages)
    .where(sql`${messages.content} like ${pattern}`)
    .get();
  return inMessage !== undefined;
}

/** Welche Einträge entfernt werden: je wortgleicher Gruppe alle außer dem Ältesten bzw. den referenzierten. */
export function duplicatesToRemove(db: DatabaseHandle['db']): string[] {
  const rows = db
    .select()
    .from(notes)
    .where(and(isNotNull(notes.sourceChatId), isNotNull(notes.sourceMessageId)))
    .orderBy(asc(notes.createdAt), asc(notes.id))
    .all();
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const remove: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const referenced = new Set(
      group.filter((row) => isReferenced(db, row.id)).map((row) => row.id),
    );
    const keep = referenced.size > 0 ? referenced : new Set([group[0]?.id]);
    for (const row of group) if (!keep.has(row.id)) remove.push(row.id);
  }
  return remove;
}

function hasRun(db: DatabaseHandle['db']): boolean {
  return (
    db
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, DEDUPE_MARKER_KEY))
      .get() !== undefined
  );
}

/**
 * Führt die Bereinigung genau einmal aus (siehe oben). Löscht nur nach gelungener Sicherung; Löschen und
 * Markierung stehen in einer Transaktion. Wirft nie: Jeder Fehler landet im Protokoll, der Start geht weiter.
 */
export function dedupeChatNotesOnce(handle: DatabaseHandle, options: DedupeOptions): DedupeResult {
  const log = options.log ?? ((message: string) => console.error(message));
  const now = options.now ?? (() => new Date());
  const { db } = handle;
  try {
    if (hasRun(db)) return { status: 'skipped' };
    const remove = duplicatesToRemove(db);
    let backup: string | null = null;
    if (remove.length > 0) {
      if (!options.backupDir) {
        log('Bereinigung doppelter Hefteinträge: kein Sicherungsordner, nichts gelöscht.');
        return { status: 'backup_failed' };
      }
      try {
        backup = backupDatabase(handle.sqlite, options.backupDir, DEDUPE_BACKUP_PREFIX, now());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(
          `Bereinigung doppelter Hefteinträge: Sicherung fehlgeschlagen, nichts gelöscht (${reason}).`,
        );
        return { status: 'backup_failed' };
      }
    }
    db.transaction((tx) => {
      for (const id of remove) tx.delete(notes).where(eq(notes.id, id)).run();
      tx.insert(settings)
        .values({
          key: DEDUPE_MARKER_KEY,
          value: JSON.stringify({
            at: now().toISOString(),
            removed: remove.length,
            backup: backup ? basename(backup) : null,
          }),
        })
        .run();
    });
    if (remove.length > 0) {
      log(
        `Bereinigung doppelter Hefteinträge: ${remove.length} wortgleiche Doppel entfernt, Sicherung ${basename(backup ?? '')}.`,
      );
    }
    return { status: 'done', removed: remove.length, backup };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`Bereinigung doppelter Hefteinträge fehlgeschlagen, nichts geändert (${reason}).`);
    return { status: 'failed' };
  }
}
