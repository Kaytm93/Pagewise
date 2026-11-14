import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseHandle, migrateDatabase, openDatabase } from '../db/client';
import { chats, messages, notes, settings, subjectGroups, subjects } from '../db/schema';
import {
  DEDUPE_BACKUP_PREFIX,
  DEDUPE_MARKER_KEY,
  dedupeChatNotesOnce,
  duplicatesToRemove,
  verifyBackup,
} from './notes-dedupe';

/**
 * Die einmalige Bereinigung doppelter Hefteinträge aus dem Chat (D-122) an einer eigenen, temporären
 * Datenbank. Alle Daten sind erfunden; nichts berührt ein Datenverzeichnis außerhalb von `tmpdir()`.
 */
describe('Einmalige Bereinigung doppelter Hefteinträge aus dem Chat (D-122)', () => {
  let base: string;
  let backupDir: string;
  let handle: DatabaseHandle;
  let subjectId: string;
  let chatId: string;
  let messageId: string;
  const logged: string[] = [];
  const log = (message: string) => {
    logged.push(message);
  };
  const now = () => new Date('2026-11-12T10:00:00.000Z');

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    backupDir = join(base, 'backups');
    mkdirSync(backupDir, { mode: 0o700 });
    handle = openDatabase(join(base, 'test.db'));
    migrateDatabase(handle);
    logged.length = 0;
    subjectId = handle.db.insert(subjects).values({ name: 'Beispielfach' }).returning().get().id;
    chatId = handle.db.insert(chats).values({ subjectId }).returning().get().id;
    messageId = handle.db
      .insert(messages)
      .values({ chatId, seq: 1, role: 'assistant', content: 'Antwort', status: 'complete' })
      .returning()
      .get().id;
  });
  afterEach(() => {
    handle.close();
    rmSync(base, { recursive: true, force: true });
  });

  /** Ein Eintrag „aus dem Chat“, wie ihn alte Fassungen angelegt haben; `createdAt` steuert das Alter. */
  function fromChat(
    extra: Partial<typeof notes.$inferInsert> & { createdAt: Date },
  ): typeof notes.$inferSelect {
    return handle.db
      .insert(notes)
      .values({
        subjectId,
        title: 'Antwort',
        markdown: 'Antwort',
        sourceChatId: chatId,
        sourceMessageId: messageId,
        updatedAt: extra.createdAt,
        ...extra,
      })
      .returning()
      .get();
  }
  const at = (minutes: number) => new Date(now().getTime() + minutes * 60_000);
  const ids = () =>
    handle.db
      .select({ id: notes.id })
      .from(notes)
      .all()
      .map((row) => row.id)
      .sort();
  const marker = () =>
    handle.db.select().from(settings).where(eq(settings.key, DEDUPE_MARKER_KEY)).get();
  const backups = () =>
    readdirSync(backupDir).filter((name) => name.startsWith(DEDUPE_BACKUP_PREFIX));

  it('entfernt wortgleiche Doppel und behält den ältesten Eintrag', () => {
    const oldest = fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    fromChat({ createdAt: at(2) });
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 2 });
    expect(ids()).toEqual([oldest.id]);
    expect(marker()).toBeDefined();
    expect(JSON.parse(marker()?.value ?? '{}')).toMatchObject({ removed: 2 });
  });

  it('lässt bearbeitete Einträge stehen: anderer Text, Titel, Stichwörter, Anheftung oder Untergruppe', () => {
    const groupId = handle.db
      .insert(subjectGroups)
      .values({ subjectId, name: 'Beispiel-Gruppe' })
      .returning()
      .get().id;
    const original = fromChat({ createdAt: at(0) });
    const edited = [
      fromChat({ createdAt: at(1), markdown: 'Antwort\n\nEigene Ergänzung.' }),
      fromChat({ createdAt: at(2), title: 'Eigener Titel' }),
      fromChat({ createdAt: at(3), tags: '["Beispiel"]' }),
      fromChat({ createdAt: at(4), pinned: true }),
      fromChat({ createdAt: at(5), groupId }),
    ];
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 0, backup: null });
    expect(ids()).toEqual([original.id, ...edited.map((row) => row.id)].sort());
    // Ohne Löschung keine Sicherung, aber die Markierung: nie wieder suchen.
    expect(backups()).toEqual([]);
    expect(marker()).toBeDefined();
  });

  it('lässt einzelne Einträge, Einträge ohne Herkunft und aus gelöschten Chats in Ruhe', () => {
    const single = fromChat({ createdAt: at(0) });
    const other = handle.db
      .insert(messages)
      .values({ chatId, seq: 2, role: 'assistant', content: 'Andere Antwort', status: 'complete' })
      .returning()
      .get().id;
    const otherSingle = fromChat({ createdAt: at(1), sourceMessageId: other });
    // Zwei wortgleiche Einträge von Hand (keine Herkunft) und zwei aus einem gelöschten Chat (Herkunft weg).
    const manual = [
      fromChat({ createdAt: at(2), sourceChatId: null, sourceMessageId: null }),
      fromChat({ createdAt: at(3), sourceChatId: null, sourceMessageId: null }),
      fromChat({ createdAt: at(4), sourceChatId: null }),
      fromChat({ createdAt: at(5), sourceChatId: null }),
    ];
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 0 });
    expect(ids()).toEqual([single.id, otherSingle.id, ...manual.map((row) => row.id)].sort());
  });

  it('trennt Gruppen nach Nachricht und Fach und behandelt mehrere Gruppen in einem Lauf', () => {
    const otherSubject = handle.db
      .insert(subjects)
      .values({ name: 'Beispielfach B' })
      .returning()
      .get().id;
    const otherChat = handle.db
      .insert(chats)
      .values({ subjectId: otherSubject })
      .returning()
      .get().id;
    const otherMessage = handle.db
      .insert(messages)
      .values({
        chatId: otherChat,
        seq: 1,
        role: 'assistant',
        content: 'Antwort',
        status: 'complete',
      })
      .returning()
      .get().id;
    const a1 = fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    const b1 = fromChat({
      createdAt: at(2),
      subjectId: otherSubject,
      sourceChatId: otherChat,
      sourceMessageId: otherMessage,
    });
    fromChat({
      createdAt: at(3),
      subjectId: otherSubject,
      sourceChatId: otherChat,
      sourceMessageId: otherMessage,
    });
    fromChat({
      createdAt: at(4),
      subjectId: otherSubject,
      sourceChatId: otherChat,
      sourceMessageId: otherMessage,
    });
    // Gleicher Chat und gleiche Nachricht, aber ein anderes Fach (von Hand verschoben): eigene Gruppe, einzeln.
    const moved = fromChat({ createdAt: at(5), subjectId: otherSubject });
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 3 });
    expect(ids()).toEqual([a1.id, b1.id, moved.id].sort());
  });

  it('behält statt des ältesten den Eintrag, auf den ein Text zeigt', () => {
    fromChat({ createdAt: at(0) });
    const linked = fromChat({ createdAt: at(1) });
    fromChat({ createdAt: at(2) });
    // Ein anderer Hefteintrag verlinkt den zweiten Eintrag.
    handle.db
      .insert(notes)
      .values({
        subjectId,
        title: 'Verweis',
        markdown: `Siehe /subjects/${subjectId}/notes/${linked.id}`,
      })
      .run();
    expect(duplicatesToRemove(handle)).toHaveLength(2);
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 2 });
    expect(ids()).toContain(linked.id);
    expect(ids()).toHaveLength(2);
  });

  it('legt vor dem Löschen eine lesbare Sicherung mit Rechten 600 an, die alle Einträge noch enthält', () => {
    fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    const result = dedupeChatNotesOnce(handle, { backupDir, now, log });
    expect(result).toMatchObject({ status: 'done', removed: 1 });
    expect(backups()).toEqual([`${DEDUPE_BACKUP_PREFIX}2026-11-12T10-00-00-000Z.db`]);
    const file = join(backupDir, backups()[0] ?? '');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const copy = new Sqlite(file, { readonly: true });
    expect(copy.prepare('select count(*) as n from notes').get()).toEqual({ n: 2 });
    copy.close();
    expect(JSON.parse(marker()?.value ?? '{}')).toMatchObject({ removed: 1, backup: backups()[0] });
  });

  it('löscht nichts und setzt keine Markierung, wenn die Sicherung scheitert; der Aufruf wirft nicht', () => {
    fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    const before = ids();
    const missing = join(base, 'gibt-es-nicht');
    expect(dedupeChatNotesOnce(handle, { backupDir: missing, now, log })).toEqual({
      status: 'backup_failed',
    });
    expect(ids()).toEqual(before);
    expect(marker()).toBeUndefined();
    expect(logged.join('\n')).toContain('nichts gelöscht');
    // Ohne Sicherungsordner ebenso.
    expect(dedupeChatNotesOnce(handle, { backupDir: null, now, log })).toEqual({
      status: 'backup_failed',
    });
    expect(ids()).toEqual(before);
    // Beim nächsten Start mit erreichbarem Ordner klappt es.
    expect(dedupeChatNotesOnce(handle, { backupDir, now, log })).toMatchObject({
      status: 'done',
      removed: 1,
    });
  });

  it('findet Verweise in einem Durchlauf wie LIKE: Groß und Klein, mehrere je Text, Hex-Ziffern direkt davor', () => {
    const answer = (seq: number) =>
      handle.db
        .insert(messages)
        .values({ chatId, seq, role: 'assistant', content: `Antwort ${seq}`, status: 'complete' })
        .returning()
        .get().id;
    const pair = (minutes: number, sourceMessageId: string) => [
      fromChat({ createdAt: at(minutes), sourceMessageId }),
      fromChat({ createdAt: at(minutes + 1), sourceMessageId }),
    ];
    const [a1, a2] = pair(0, answer(2));
    const [b1, b2] = pair(2, answer(3));
    const [c1, c2] = pair(4, answer(4));
    const [d1, d2] = pair(6, answer(5));
    // Ein Chat-Text nennt a2 in Großbuchstaben und b2 gleich danach; ein Hefteintrag nennt c2 so, dass davor
    // Hex-Ziffern in UUID-Gliederung stehen (ein nicht überlappender Suchlauf verschluckte den Anfang von c2).
    handle.db
      .insert(messages)
      .values({
        chatId,
        seq: 6,
        role: 'user',
        content: `Siehe ${a2?.id.toUpperCase()},${b2?.id}`,
        status: 'complete',
      })
      .run();
    fromChat({
      createdAt: at(20),
      sourceChatId: null,
      markdown: `Verweis 11111111-2222-3333-4444-5555${c2?.id}`,
    });
    expect(duplicatesToRemove(handle).sort()).toEqual([a1?.id, b1?.id, c1?.id, d2?.id].sort());
    expect(d1).toBeDefined();
  });

  it('kennt auch IDs ohne UUID-Form (Teilstring, wie LIKE)', () => {
    const plainOld = fromChat({ createdAt: at(0), id: 'alt-1' });
    const plainNew = fromChat({ createdAt: at(1), id: 'neu-2' });
    handle.db
      .insert(messages)
      .values({ chatId, seq: 2, role: 'user', content: 'Link auf NEU-2 hier', status: 'complete' })
      .run();
    expect(duplicatesToRemove(handle)).toEqual([plainOld.id]);
    expect(plainNew.id).toBe('neu-2');
  });

  it('prüft die Sicherung: quick_check, Zahl der Einträge; sonst nichts löschen', () => {
    fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    // verifyBackup selbst: unlesbare Datei, falsche Zeilenzahl, gute Datei.
    const garbage = join(base, 'kaputt.db');
    writeFileSync(garbage, 'kein SQLite');
    expect(verifyBackup(garbage, 2)).toBeTruthy();
    expect(verifyBackup(join(base, 'fehlt.db'), 2)).toBeTruthy();
    handle.sqlite.prepare('VACUUM INTO ?').run(join(base, 'gut.db'));
    expect(verifyBackup(join(base, 'gut.db'), 3)).toContain('2 statt 3');
    expect(verifyBackup(join(base, 'gut.db'), 2)).toBeNull();
    // Scheitert die Prüfung, bleibt alles stehen; danach klappt es mit der echten Prüfung.
    const before = ids();
    const verify = (file: string, expected: number) => `Probe ${expected} ${file.length > 0}`;
    expect(dedupeChatNotesOnce(handle, { backupDir, now, log, verify })).toEqual({
      status: 'backup_failed',
    });
    expect(ids()).toEqual(before);
    expect(marker()).toBeUndefined();
    expect(logged.join('\n')).toContain('nicht in Ordnung');
    expect(logged.join('\n')).not.toContain(base);
    expect(dedupeChatNotesOnce(handle, { backupDir: join(base, 'anderer'), now, log })).toEqual({
      status: 'backup_failed',
    });
    expect(logged.at(-1)).not.toContain(base);
    mkdirSync(join(base, 'anderer'));
    expect(
      dedupeChatNotesOnce(handle, { backupDir: join(base, 'anderer'), now, log }),
    ).toMatchObject({ status: 'done', removed: 1 });
  });

  it('läuft nur einmal: der zweite Start ändert nichts, auch wenn neue Doppel liegen', () => {
    fromChat({ createdAt: at(0) });
    fromChat({ createdAt: at(1) });
    expect(dedupeChatNotesOnce(handle, { backupDir, now, log })).toMatchObject({
      status: 'done',
      removed: 1,
    });
    // Später angelegte Doppel (etwa von Hand eingespielt) bleiben: die Aufgabe ist erledigt.
    fromChat({ createdAt: at(10) });
    fromChat({ createdAt: at(11) });
    const before = ids();
    expect(dedupeChatNotesOnce(handle, { backupDir, now, log })).toEqual({ status: 'skipped' });
    expect(ids()).toEqual(before);
    expect(backups()).toHaveLength(1);
  });

  it('setzt auf einer leeren Datenbank nur die Markierung', () => {
    handle.db.delete(notes).run();
    expect(dedupeChatNotesOnce(handle, { backupDir, now, log })).toEqual({
      status: 'done',
      removed: 0,
      backup: null,
    });
    expect(backups()).toEqual([]);
    expect(marker()).toBeDefined();
    expect(logged).toEqual([]);
  });
});
