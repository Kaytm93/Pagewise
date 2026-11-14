import { basename, dirname, sep } from 'node:path';
import Sqlite from 'better-sqlite3';
import { and, asc, count, eq, isNotNull } from 'drizzle-orm';
import { backupDatabase, type DatabaseHandle } from '../db/client';
import { notes, settings } from '../db/schema';

/**
 * Einmalige Bereinigung doppelter Hefteinträge aus dem Chat (D-122, F-020). Vor D-122 legte jedes
 * „Als Hefteintrag speichern“ einen neuen Eintrag an, auch wenn es zur selben Antwort schon einen gab.
 * Beim ersten Start nach dem Update verschwinden **wortgleiche** Doppel: gleiche Herkunft (Chat und
 * Nachricht), gleiches Fach und gleiche Untergruppe, gleicher Titel, gleicher Text, gleiche Stichwörter,
 * gleiche Anheftung. Von jeder solchen Gruppe bleibt der älteste Eintrag (kleinste Erstellzeit); zeigt
 * ein Text (anderer Hefteintrag, Chat-Nachricht) auf die ID eines Eintrags, bleibt stattdessen dieser.
 * Bearbeitete Einträge (irgendein Feld anders) bleiben alle, ebenso Einträge ohne Herkunft oder aus
 * gelöschten Chats (`source_chat_id` ist dann `null`, die Herkunft nicht mehr feststellbar).
 *
 * Vorher entsteht eine Sicherung (`VACUUM INTO`, neben den Sicherungen vor Migrationen) und wird geprüft
 * (`quick_check`, Zahl der Einträge); scheitert eines davon, wird nichts gelöscht, und der Server startet
 * trotzdem. Lief die Bereinigung einmal durch, merkt sich das eine Markierung in `settings`; danach ist sie
 * wirkungslos (neue Doppel entstehen seit D-122 nicht).
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
  /** Nur für Tests: ersetzt die Prüfung der Sicherung ({@link verifyBackup}). */
  verify?: (file: string, expectedNotes: number) => string | null;
}

export type DedupeResult =
  /** Schon gelaufen, nichts getan. */
  | { status: 'skipped' }
  /** Gelaufen; `removed` Einträge weg, `backup` die Sicherung (`null`, wenn es nichts zu löschen gab). */
  | { status: 'done'; removed: number; backup: string | null }
  /** Sicherung nicht möglich oder nicht in Ordnung: nichts gelöscht, keine Markierung, beim nächsten Start neuer Versuch. */
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

/** Form der IDs, die die App vergibt (`randomUUID`, 36 Zeichen). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Jede Stelle eines Textes, an der ein UUID-förmiges Stück **beginnt**, auch überlappend (Vorausschau), damit
 * kein Stück ein anderes verdeckt (etwa wenn Hex-Ziffern direkt davor stehen). Nur ASCII, wie `LIKE`.
 */
const UUID_AT = /(?=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))/gi;

/**
 * Welche der Kandidaten in einem Text vorkommen (anderer Hefteintrag, Chat-Nachricht): dann zeigt etwas auf den
 * Eintrag. Ergebnis gleich wie `text LIKE '%id%'` je Kandidat (D-122), aber alle Texte werden **einmal** gelesen
 * (zeilenweise), nicht je Kandidat neu. Für UUID-Kandidaten: Jedes Vorkommen einer UUID ist ein UUID-förmiges
 * Stück aus 36 ASCII-Zeichen; `UUID_AT` findet alle solchen Stücke, verglichen wird kleingeschrieben (`LIKE`
 * unterscheidet bei ASCII nicht zwischen Groß und Klein). Kandidaten ohne UUID-Form (nur in Handdaten möglich)
 * prüft weiter die alte `LIKE`-Abfrage, mit `_` und `%` als Platzhalter wie zuvor.
 */
function referencedAmong(sqlite: DatabaseHandle['sqlite'], candidates: Set<string>): Set<string> {
  const found = new Set<string>();
  const byLower = new Map<string, string[]>();
  const plain: string[] = [];
  for (const id of candidates) {
    if (!UUID.test(id)) {
      plain.push(id);
      continue;
    }
    const lower = id.toLowerCase();
    const same = byLower.get(lower);
    if (same) same.push(id);
    else byLower.set(lower, [id]);
  }
  if (byLower.size > 0) {
    const scan = (text: string, self: string | null) => {
      for (const match of text.matchAll(UUID_AT)) {
        for (const id of byLower.get((match[1] ?? '').toLowerCase()) ?? []) {
          if (id !== self) found.add(id);
        }
      }
    };
    const noteRows = sqlite
      .prepare('select id, markdown from notes')
      .iterate() as IterableIterator<{
      id: string;
      markdown: string;
    }>;
    for (const row of noteRows) scan(row.markdown, row.id);
    const messageRows = sqlite
      .prepare('select content from messages')
      .iterate() as IterableIterator<{ content: string }>;
    for (const row of messageRows) scan(row.content, null);
  }
  if (plain.length > 0) {
    const inNote = sqlite.prepare('select 1 from notes where id != ? and markdown like ? limit 1');
    const inMessage = sqlite.prepare('select 1 from messages where content like ? limit 1');
    for (const id of plain) {
      const pattern = `%${id}%`;
      if (inNote.get(id, pattern) !== undefined || inMessage.get(pattern) !== undefined)
        found.add(id);
    }
  }
  return found;
}

/** Welche Einträge entfernt werden: je wortgleicher Gruppe alle außer dem Ältesten bzw. den referenzierten. */
export function duplicatesToRemove(handle: DatabaseHandle): string[] {
  const rows = handle.db
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
  const duplicates = [...groups.values()].filter((group) => group.length > 1);
  const referenced = referencedAmong(
    handle.sqlite,
    new Set(duplicates.flatMap((group) => group.map((row) => row.id))),
  );
  const remove: string[] = [];
  for (const group of duplicates) {
    const linked = group.filter((row) => referenced.has(row.id)).map((row) => row.id);
    const keep = new Set(linked.length > 0 ? linked : [group[0]?.id]);
    for (const row of group) if (!keep.has(row.id)) remove.push(row.id);
  }
  return remove;
}

/**
 * Prüft eine frisch geschriebene Sicherung, bevor etwas gelöscht wird: Datei lesbar, `PRAGMA quick_check`
 * sagt `ok`, und sie enthält so viele Hefteinträge wie die laufende Datenbank. `null` heißt in Ordnung, sonst
 * der Grund (ohne Pfad).
 */
export function verifyBackup(file: string, expectedNotes: number): string | null {
  let copy: Sqlite.Database | null = null;
  try {
    copy = new Sqlite(file, { readonly: true, fileMustExist: true });
    const check = copy.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    if (check.length !== 1 || check[0]?.quick_check !== 'ok') return 'quick_check nicht ok';
    const count = (copy.prepare('select count(*) as n from notes').get() as { n: number }).n;
    if (count !== expectedNotes)
      return `Sicherung hat ${count} statt ${expectedNotes} Hefteinträge`;
    return null;
  } catch (error) {
    return withoutDir(error instanceof Error ? error.message : String(error), dirname(file));
  } finally {
    copy?.close();
  }
}

/**
 * Meldungen nennen von der Sicherung nur den Dateinamen: Der volle Pfad trägt den Benutzernamen
 * (`/Users/<name>/Library/…`). Aus `<dir>/datei.db` wird `datei.db`, ein übriges `<dir>` wird `backups`.
 */
export function withoutDir(text: string, dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  if (trimmed === '') return text;
  return text
    .replaceAll(`${trimmed}${sep}`, '')
    .replaceAll(`${trimmed}/`, '')
    .replaceAll(trimmed, 'backups');
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
    const remove = duplicatesToRemove(handle);
    let backup: string | null = null;
    if (remove.length > 0) {
      if (!options.backupDir) {
        log('Bereinigung doppelter Hefteinträge: kein Sicherungsordner, nichts gelöscht.');
        return { status: 'backup_failed' };
      }
      const backupDir = options.backupDir;
      try {
        backup = backupDatabase(handle.sqlite, backupDir, DEDUPE_BACKUP_PREFIX, now());
      } catch (error) {
        const reason = withoutDir(
          error instanceof Error ? error.message : String(error),
          backupDir,
        );
        log(
          `Bereinigung doppelter Hefteinträge: Sicherung fehlgeschlagen, nichts gelöscht (${reason}).`,
        );
        return { status: 'backup_failed' };
      }
      const total = db.select({ n: count() }).from(notes).get()?.n ?? 0;
      const problem = (options.verify ?? verifyBackup)(backup, total);
      if (problem !== null) {
        log(
          `Bereinigung doppelter Hefteinträge: Sicherung ${basename(backup)} nicht in Ordnung (${problem}), nichts gelöscht.`,
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
    const message = error instanceof Error ? error.message : String(error);
    const reason = options.backupDir ? withoutDir(message, options.backupDir) : message;
    log(`Bereinigung doppelter Hefteinträge fehlgeschlagen, nichts geändert (${reason}).`);
    return { status: 'failed' };
  }
}
