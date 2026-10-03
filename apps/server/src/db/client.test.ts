import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseError,
  type DatabaseHandle,
  DEFAULT_MIGRATIONS_FOLDER,
  migrateDatabase,
  openDatabase,
} from './client';
import { profile, providers, settings, subjectGroups, subjects } from './schema';

describe('Datenbank', () => {
  let base: string;
  let handle: DatabaseHandle;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    handle = openDatabase(join(base, 'test.db'));
    migrateDatabase(handle);
  });
  afterEach(() => {
    handle.close();
    rmSync(base, { recursive: true, force: true });
  });

  it('legt die Datei mit Rechten 600 an und aktiviert die Schutzeinstellungen', () => {
    expect(statSync(join(base, 'test.db')).mode & 0o777).toBe(0o600);
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('secure_delete', { simple: true })).toBe(1);
  });

  it('legt die Tabellen an und ist beim zweiten Lauf ein No-op', () => {
    migrateDatabase(handle);
    const tables = handle.sqlite
      .prepare("select name from sqlite_master where type = 'table' and name not like '%drizzle%'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual([
      'auth_credentials',
      'profile',
      'providers',
      'sessions',
      'settings',
      'subject_groups',
      'subjects',
    ]);
  });

  it('startet leer: keine vorbelegten Fächer, kein Profil', () => {
    expect(handle.db.select().from(subjects).all()).toEqual([]);
    expect(handle.db.select().from(subjectGroups).all()).toEqual([]);
    expect(handle.db.select().from(profile).all()).toEqual([]);
  });

  it('startet ohne Anbieter und ohne Einstellungen', () => {
    expect(handle.db.select().from(providers).all()).toEqual([]);
    expect(handle.db.select().from(settings).all()).toEqual([]);
  });

  it('löscht Untergruppen mit ihrem Fach', () => {
    const subject = handle.db.insert(subjects).values({ name: 'Beispielfach' }).returning().get();
    handle.db
      .insert(subjectGroups)
      .values([
        { subjectId: subject.id, name: 'Beispiel-Untergruppe A' },
        { subjectId: subject.id, name: 'Beispiel-Untergruppe B' },
      ])
      .run();
    expect(handle.db.select().from(subjectGroups).all()).toHaveLength(2);

    handle.db.delete(subjects).where(eq(subjects.id, subject.id)).run();
    expect(handle.db.select().from(subjectGroups).all()).toEqual([]);
  });

  it('verweigert Untergruppen ohne existierendes Fach', () => {
    expect(() =>
      handle.db.insert(subjectGroups).values({ subjectId: 'gibt-es-nicht', name: 'Waise' }).run(),
    ).toThrow();
  });

  it('verlangt eindeutige Fachnamen, unabhängig von Groß- und Kleinschreibung', () => {
    handle.db.insert(subjects).values({ name: 'Beispielfach' }).run();
    expect(() => handle.db.insert(subjects).values({ name: 'BEISPIELFACH' }).run()).toThrow();
  });

  it('verlangt eindeutige Untergruppennamen nur innerhalb eines Fachs', () => {
    const a = handle.db.insert(subjects).values({ name: 'Beispielfach A' }).returning().get();
    const b = handle.db.insert(subjects).values({ name: 'Beispielfach B' }).returning().get();
    handle.db.insert(subjectGroups).values({ subjectId: a.id, name: 'Thema' }).run();
    handle.db.insert(subjectGroups).values({ subjectId: b.id, name: 'Thema' }).run();
    expect(() =>
      handle.db.insert(subjectGroups).values({ subjectId: a.id, name: 'THEMA' }).run(),
    ).toThrow();
  });

  it('erlaubt genau eine Profilzeile', () => {
    const row = handle.db.insert(profile).values({ id: 1 }).returning().get();
    expect(row.federalState).toBeNull();
    expect(row.onboardingCompletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(() => handle.db.insert(profile).values({ id: 2 }).run()).toThrow();
  });

  it('setzt updated_at beim Ändern neu', async () => {
    const subject = handle.db.insert(subjects).values({ name: 'Beispielfach' }).returning().get();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = handle.db
      .update(subjects)
      .set({ name: 'Beispielfach neu' })
      .where(eq(subjects.id, subject.id))
      .returning()
      .get();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(subject.updatedAt.getTime());
  });

  it('schließt mehrfach ohne Fehler', () => {
    handle.close();
    expect(() => handle.close()).not.toThrow();
  });
});

describe('Migrationen mit Sicherung', () => {
  let base: string;
  let backupDir: string;
  let migrationsFolder: string;
  let handle: DatabaseHandle;

  /** Kopie der echten Migrationen plus eine zusätzliche, damit es etwas Ausstehendes gibt. */
  function withExtraMigration(): void {
    const journalPath = join(migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1);
    if (!last) throw new Error('Testaufbau: keine Migrationen vorhanden');
    journal.entries.push({
      idx: last.idx + 1,
      version: last.version,
      when: last.when + 1000,
      tag: '0099_test_extra',
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    writeFileSync(
      join(migrationsFolder, '0099_test_extra.sql'),
      'CREATE TABLE `test_extra` (`id` integer PRIMARY KEY NOT NULL);',
    );
  }

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    backupDir = join(base, 'backups');
    mkdirSync(backupDir, { mode: 0o700 });
    migrationsFolder = join(base, 'migrations');
    cpSync(DEFAULT_MIGRATIONS_FOLDER, migrationsFolder, { recursive: true });
    handle = openDatabase(join(base, 'test.db'));
  });
  afterEach(() => {
    handle.close();
    rmSync(base, { recursive: true, force: true });
  });

  it('sichert eine frische Datenbank nicht', () => {
    migrateDatabase(handle, { migrationsFolder, backupDir });
    expect(readdirSync(backupDir)).toEqual([]);
  });

  it('sichert eine bestehende Datenbank vor einer ausstehenden Migration', () => {
    migrateDatabase(handle, { migrationsFolder, backupDir });
    handle.db.insert(subjects).values({ name: 'Beispielfach' }).run();

    withExtraMigration();
    migrateDatabase(handle, {
      migrationsFolder,
      backupDir,
      now: () => new Date('2026-10-03T12:00:00.000Z'),
    });

    const backups = readdirSync(backupDir);
    expect(backups).toEqual(['pagewise-vor-migration-2026-10-03T12-00-00-000Z.db']);
    expect(statSync(join(backupDir, backups[0] ?? '')).mode & 0o777).toBe(0o600);

    // Die Sicherung enthält die Daten von vorher, aber noch nicht die neue Tabelle.
    const copy = new Sqlite(join(backupDir, backups[0] ?? ''), { readonly: true });
    expect(copy.prepare('select name from subjects').all()).toEqual([{ name: 'Beispielfach' }]);
    expect(
      copy.prepare("select 1 from sqlite_master where name = 'test_extra'").get(),
    ).toBeUndefined();
    copy.close();

    // Die Live-Datenbank ist migriert und hat ihre Daten behalten.
    expect(
      handle.sqlite.prepare("select 1 from sqlite_master where name = 'test_extra'").get(),
    ).toBeDefined();
    expect(handle.db.select().from(subjects).all()).toHaveLength(1);
  });

  it('sichert nicht erneut, wenn nichts mehr aussteht', () => {
    migrateDatabase(handle, { migrationsFolder, backupDir });
    withExtraMigration();
    migrateDatabase(handle, { migrationsFolder, backupDir });
    const before = readdirSync(backupDir);
    migrateDatabase(handle, { migrationsFolder, backupDir });
    expect(readdirSync(backupDir)).toEqual(before);
  });

  it('behält nur die letzten fünf Sicherungen', () => {
    migrateDatabase(handle, { migrationsFolder, backupDir });
    for (let day = 1; day <= 7; day++) {
      writeFileSync(join(backupDir, `pagewise-vor-migration-2026-09-0${day}T00-00-00-000Z.db`), '');
    }
    writeFileSync(join(backupDir, 'andere-datei.db'), '');

    withExtraMigration();
    migrateDatabase(handle, {
      migrationsFolder,
      backupDir,
      now: () => new Date('2026-10-03T12:00:00.000Z'),
    });

    const remaining = readdirSync(backupDir).sort();
    expect(remaining).toContain('andere-datei.db');
    expect(remaining.filter((name) => name.startsWith('pagewise-vor-migration-'))).toEqual([
      'pagewise-vor-migration-2026-09-04T00-00-00-000Z.db',
      'pagewise-vor-migration-2026-09-05T00-00-00-000Z.db',
      'pagewise-vor-migration-2026-09-06T00-00-00-000Z.db',
      'pagewise-vor-migration-2026-09-07T00-00-00-000Z.db',
      'pagewise-vor-migration-2026-10-03T12-00-00-000Z.db',
    ]);
  });

  it('läuft ohne Sicherung weiter, wenn kein Sicherungsordner übergeben wird', () => {
    migrateDatabase(handle, { migrationsFolder });
    withExtraMigration();
    expect(() => migrateDatabase(handle, { migrationsFolder })).not.toThrow();
    expect(existsSync(join(base, 'backups', 'x'))).toBe(false);
  });

  it('fasst eine Datenbank einer neueren Version nicht an', () => {
    migrateDatabase(handle, { migrationsFolder, backupDir });
    handle.sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('zukunft', 9_999_999_999_999);

    const error = (() => {
      try {
        migrateDatabase(handle, { migrationsFolder, backupDir });
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error?.message).toContain('neueren');
  });
});
