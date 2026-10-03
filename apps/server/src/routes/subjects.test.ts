import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROOT } from '../paths';
import { createHarness, type Harness, type Session } from '../test-harness';

interface Group {
  id: string;
  name: string;
  kind: string | null;
  position: number;
}
interface Subject {
  id: string;
  name: string;
  teacher: string | null;
  hoursPerWeek: number | null;
  icon: string | null;
  position: number;
  groups: Group[];
}

describe('Fächer und Untergruppen', () => {
  let harness: Harness;
  let session: Session;
  const unknownId = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';

  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  async function list(): Promise<Subject[]> {
    return (await session.call('GET', '/api/subjects')).body.subjects as Subject[];
  }
  async function addSubject(name: string): Promise<Subject> {
    const reply = await session.call('POST', '/api/subjects', { name });
    expect(reply.status).toBe(201);
    return reply.body as unknown as Subject;
  }
  async function addGroup(subjectId: string, name: string): Promise<Group> {
    const reply = await session.call('POST', `/api/subjects/${subjectId}/groups`, { name });
    expect(reply.status).toBe(201);
    return reply.body as unknown as Group;
  }

  it.each([
    ['GET', '/api/subjects'],
    ['POST', '/api/subjects'],
    ['PATCH', `/api/subjects/${unknownId}`],
    ['DELETE', `/api/subjects/${unknownId}`],
    ['POST', `/api/subjects/${unknownId}/groups`],
    ['PATCH', `/api/groups/${unknownId}`],
    ['DELETE', `/api/groups/${unknownId}`],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: { name: 'Beispiel' } });
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ error: 'unauthorized' });
  });

  it('startet leer, ohne vorbelegte Fächer', async () => {
    expect(await list()).toEqual([]);
  });

  describe('Fächer', () => {
    it('legt Fächer getrimmt an und behält die Reihenfolge', async () => {
      const first = await addSubject('  Beispielfach A  ');
      const second = await addSubject('Beispielfach B');
      expect(first).toMatchObject({ name: 'Beispielfach A', position: 0, groups: [] });
      expect(second.position).toBe(1);
      expect((await list()).map((s) => s.name)).toEqual(['Beispielfach A', 'Beispielfach B']);
    });

    it('lehnt doppelte Namen ab, auch bei anderer Groß-/Kleinschreibung und mit Umlauten', async () => {
      await addSubject('Beispielfach');
      await addSubject('Übungsfach');
      for (const name of [
        'beispielfach',
        'BEISPIELFACH',
        '  Beispielfach ',
        'übungsfach',
        'ÜBUNGSFACH',
      ]) {
        const reply = await session.call('POST', '/api/subjects', { name });
        expect(reply.status).toBe(409);
        expect(reply.body).toEqual({ error: 'name_taken' });
      }
      expect(await list()).toHaveLength(2);
    });

    it.each([
      [{ name: '' }, 'name'],
      [{ name: '    ' }, 'name'],
      [{ name: 'x'.repeat(81) }, 'name'],
      [{ name: 'zwei\nZeilen' }, 'name'],
      [{ name: 'a\u0000b' }, 'name'],
      [{ name: 42 }, 'name'],
      [{}, 'name'],
      [{ name: 'Beispielfach', extra: true }, null],
    ])('lehnt die Eingabe %j mit 400 ab', async (body, field) => {
      const reply = await session.call('POST', '/api/subjects', body);
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field });
    });

    it('benennt um, auch nur in der Schreibweise des eigenen Namens', async () => {
      const subject = await addSubject('Beispielfach');
      const renamed = await session.call('PATCH', `/api/subjects/${subject.id}`, {
        name: 'BEISPIELFACH',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('BEISPIELFACH');
    });

    it('verbietet das Umbenennen auf den Namen eines anderen Fachs', async () => {
      await addSubject('Beispielfach A');
      const b = await addSubject('Beispielfach B');
      const reply = await session.call('PATCH', `/api/subjects/${b.id}`, {
        name: 'beispielfach a',
      });
      expect(reply.status).toBe(409);
      expect((await list()).map((s) => s.name)).toEqual(['Beispielfach A', 'Beispielfach B']);
    });

    it('antwortet bei unbekannten oder ungültigen IDs mit 404', async () => {
      for (const id of [unknownId, 'kein-uuid', '1', '../../etc']) {
        const encoded = encodeURIComponent(id);
        expect(
          (await session.call('PATCH', `/api/subjects/${encoded}`, { name: 'X' })).status,
        ).toBe(404);
        expect((await session.call('DELETE', `/api/subjects/${encoded}`)).status).toBe(404);
        expect(
          (await session.call('POST', `/api/subjects/${encoded}/groups`, { name: 'X' })).status,
        ).toBe(404);
      }
    });

    it('löscht ein Fach samt Untergruppen und lässt andere Fächer in Ruhe', async () => {
      const a = await addSubject('Beispielfach A');
      const b = await addSubject('Beispielfach B');
      await addGroup(a.id, 'Thema 1');
      await addGroup(b.id, 'Thema 1');

      const reply = await session.call('DELETE', `/api/subjects/${a.id}`);
      expect(reply.status).toBe(204);

      const rest = await list();
      expect(rest.map((s) => s.name)).toEqual(['Beispielfach B']);
      expect(rest[0]?.groups.map((g) => g.name)).toEqual(['Thema 1']);
    });

    it('verlangt das CSRF-Token', async () => {
      const reply = await harness.call('POST', '/api/subjects', {
        cookie: session.cookie,
        body: { name: 'Beispielfach' },
      });
      expect(reply.status).toBe(403);
      expect(await list()).toEqual([]);
    });
  });

  describe('Untergruppen', () => {
    it('legt Untergruppen in der Reihenfolge ihrer Anlage an', async () => {
      const subject = await addSubject('Beispielfach');
      const a = await addGroup(subject.id, 'Beispiel-Untergruppe A');
      const b = await addGroup(subject.id, 'Beispiel-Untergruppe B');
      expect([a.position, b.position]).toEqual([0, 1]);
      expect((await list())[0]?.groups.map((g) => g.name)).toEqual([
        'Beispiel-Untergruppe A',
        'Beispiel-Untergruppe B',
      ]);
    });

    it('erlaubt gleiche Namen in verschiedenen Fächern, aber nicht im selben', async () => {
      const a = await addSubject('Beispielfach A');
      const b = await addSubject('Beispielfach B');
      await addGroup(a.id, 'Thema');
      await addGroup(b.id, 'Thema');

      const duplicate = await session.call('POST', `/api/subjects/${a.id}/groups`, {
        name: 'THEMA',
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toEqual({ error: 'name_taken' });
    });

    it('antwortet für ein unbekanntes Fach mit 404', async () => {
      const reply = await session.call('POST', `/api/subjects/${unknownId}/groups`, {
        name: 'Thema',
      });
      expect(reply.status).toBe(404);
    });

    it('benennt um und löscht', async () => {
      const subject = await addSubject('Beispielfach');
      const group = await addGroup(subject.id, 'Thema');
      await addGroup(subject.id, 'Anderes Thema');

      const renamed = await session.call('PATCH', `/api/groups/${group.id}`, {
        name: 'Neues Thema',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Neues Thema');

      const clash = await session.call('PATCH', `/api/groups/${group.id}`, {
        name: 'anderes thema',
      });
      expect(clash.status).toBe(409);

      expect((await session.call('DELETE', `/api/groups/${group.id}`)).status).toBe(204);
      expect((await session.call('DELETE', `/api/groups/${group.id}`)).status).toBe(404);
      expect((await list())[0]?.groups.map((g) => g.name)).toEqual(['Anderes Thema']);
    });

    it('lehnt ungültige Namen und IDs ab', async () => {
      const subject = await addSubject('Beispielfach');
      const group = await addGroup(subject.id, 'Thema');
      const bad = await session.call('PATCH', `/api/groups/${group.id}`, { name: '' });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: 'invalid_input', field: 'name' });
      expect((await session.call('PATCH', '/api/groups/kein-uuid', { name: 'X' })).status).toBe(
        404,
      );
    });
  });

  describe('Angaben zum Fach', () => {
    it('speichert Lehrkraft, Wochenstunden und Icon, alles optional', async () => {
      const plain = await addSubject('Beispielfach A');
      expect(plain).toMatchObject({ teacher: null, hoursPerWeek: null, icon: null });

      const reply = await session.call('POST', '/api/subjects', {
        name: 'Beispielfach B',
        teacher: '  Beispiel-Lehrkraft ',
        hoursPerWeek: 3,
        icon: 'book',
      });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({
        teacher: 'Beispiel-Lehrkraft',
        hoursPerWeek: 3,
        icon: 'book',
      });
    });

    it('ändert einzelne Angaben und lässt den Rest unberührt', async () => {
      const subject = await addSubject('Beispielfach');
      const first = await session.call('PATCH', `/api/subjects/${subject.id}`, {
        teacher: 'Beispiel-Lehrkraft',
        hoursPerWeek: 4,
      });
      expect(first.body).toMatchObject({
        name: 'Beispielfach',
        teacher: 'Beispiel-Lehrkraft',
        hoursPerWeek: 4,
      });

      const second = await session.call('PATCH', `/api/subjects/${subject.id}`, {
        teacher: '',
        hoursPerWeek: null,
      });
      expect(second.body).toMatchObject({
        name: 'Beispielfach',
        teacher: null,
        hoursPerWeek: null,
      });
    });

    it.each([
      ['hoursPerWeek', 0],
      ['hoursPerWeek', 41],
      ['hoursPerWeek', 2.5],
      ['hoursPerWeek', '3'],
      ['icon', 'Book'],
      ['icon', '<img>'],
      ['teacher', 'x'.repeat(81)],
    ])('lehnt %s = %j ab', async (field, value) => {
      const reply = await session.call('POST', '/api/subjects', {
        name: 'Beispielfach',
        [field]: value,
      });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field });
    });

    it('lehnt eine leere Änderung ab', async () => {
      const subject = await addSubject('Beispielfach');
      const reply = await session.call('PATCH', `/api/subjects/${subject.id}`, {});
      expect(reply.status).toBe(400);
    });

    it('speichert die Art einer Untergruppe', async () => {
      const subject = await addSubject('Beispielfach');
      const created = await session.call('POST', `/api/subjects/${subject.id}/groups`, {
        name: 'Beispiel-Thema',
        kind: 'Beispielart',
      });
      expect(created.body).toMatchObject({ name: 'Beispiel-Thema', kind: 'Beispielart' });

      const cleared = await session.call('PATCH', `/api/groups/${created.body.id}`, { kind: '' });
      expect(cleared.body).toMatchObject({ name: 'Beispiel-Thema', kind: null });
    });
  });

  describe('Vorlagen', () => {
    it('liefert ohne Katalogdatei eine leere Liste', async () => {
      const reply = await session.call('GET', '/api/subjects/templates');
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ categories: [], subjects: [] });
    });

    it('liefert den mitgelieferten Katalog mit Kategorien und Schlüsseln und legt nichts an', async () => {
      const catalogHarness = createHarness({
        catalogFile: join(APP_ROOT, 'config', 'subject-catalog.json'),
      });
      try {
        const catalogSession = await catalogHarness.signIn();
        const reply = await catalogSession.call('GET', '/api/subjects/templates');
        expect(reply.status).toBe(200);
        const subjects = reply.body.subjects as { key: string; name: string; category: string }[];
        const categories = reply.body.categories as { id: string; name: string }[];
        expect(subjects.length).toBeGreaterThanOrEqual(60);
        for (const name of ['Chemie', 'Biologie', 'Latein', 'Französisch', 'Griechisch']) {
          expect(subjects.map((s) => s.name)).toContain(name);
        }
        expect(categories.map((c) => c.id)).toContain(subjects[0]?.category);
        const listed = (await catalogSession.call('GET', '/api/subjects')).body;
        expect(listed.subjects).toEqual([]);
      } finally {
        catalogHarness.close();
      }
    });

    it('legt ein Fach mit Schlüssel der Vorlage an und lehnt unbekannte Schlüssel ab', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pagewise-katalog-'));
      const file = join(dir, 'katalog.json');
      writeFileSync(
        file,
        JSON.stringify({
          version: 2,
          categories: [{ id: 'beispiele', name: 'Beispiele' }],
          subjects: [{ key: 'beispiel-a', name: 'Beispielfach A', category: 'beispiele' }],
        }),
      );
      const catalogHarness = createHarness({ catalogFile: file });
      try {
        const catalogSession = await catalogHarness.signIn();
        const created = await catalogSession.call('POST', '/api/subjects', {
          name: 'Beispielfach A',
          templateKey: 'beispiel-a',
        });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ templateKey: 'beispiel-a', kind: 'subject' });
        for (const templateKey of ['unbekannt', 'Ungültig!', 'standard']) {
          const rejected = await catalogSession.call('POST', '/api/subjects', {
            name: 'Anderes Fach',
            templateKey,
          });
          expect(rejected.status).toBe(400);
          expect(rejected.body).toEqual({ error: 'invalid_input', field: 'templateKey' });
        }
      } finally {
        catalogHarness.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('verlangt eine Anmeldung', async () => {
      const reply = await harness.call('GET', '/api/subjects/templates');
      expect(reply.status).toBe(401);
    });
  });

  describe('Import', () => {
    const json = (subjects: unknown[]) => JSON.stringify({ version: 1, subjects });
    const upload = (format: 'json' | 'csv', content: string) =>
      session.call('POST', '/api/subjects/import', { format, content });

    it('legt Fächer aus JSON an, mit und ohne Lehrkraft und Stunden', async () => {
      const reply = await upload(
        'json',
        json([
          { name: 'Beispielfach A' },
          { name: 'Beispielfach B', teacher: 'Beispiel-Lehrkraft', hours_per_week: 3 },
        ]),
      );
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ created: 2, skipped: 0, invalid: 0 });
      const subjects = await list();
      expect(subjects.map((s) => [s.name, s.teacher, s.hoursPerWeek])).toEqual([
        ['Beispielfach A', null, null],
        ['Beispielfach B', 'Beispiel-Lehrkraft', 3],
      ]);
      expect((reply.body.subjects as Subject[]).map((s) => s.name)).toEqual([
        'Beispielfach A',
        'Beispielfach B',
      ]);
    });

    it('liest CSV mit Anführungszeichen, Komma im Feld, Windows-Zeilenenden und BOM', async () => {
      const csv = [
        '﻿name,teacher,hours_per_week',
        'Beispielfach A,,',
        '"Beispielfach, B","Beispiel ""Lehrkraft""",3',
        '',
      ].join('\r\n');
      const reply = await upload('csv', csv);
      expect(reply.body).toMatchObject({ created: 2, skipped: 0, invalid: 0 });
      const subjects = await list();
      expect(subjects.map((s) => [s.name, s.teacher, s.hoursPerWeek])).toEqual([
        ['Beispielfach A', null, null],
        ['Beispielfach, B', 'Beispiel "Lehrkraft"', 3],
      ]);
    });

    it('überspringt Vorhandenes und zählt Ungültiges, ohne abzubrechen', async () => {
      await addSubject('Beispielfach A');
      const reply = await upload(
        'json',
        json([
          { name: 'beispielfach a' },
          { name: 'Beispielfach B' },
          { name: 'Beispielfach B' },
          { name: '' },
          { name: 'Beispielfach C', hours_per_week: 99 },
          'kein Objekt',
          null,
        ]),
      );
      expect(reply.body).toMatchObject({ created: 1, skipped: 2, invalid: 4 });
      expect((await list()).map((s) => s.name)).toEqual(['Beispielfach A', 'Beispielfach B']);
    });

    it('übernimmt nur bekannte Felder, nie fremde Schlüssel', async () => {
      const reply = await upload(
        'json',
        json([{ name: 'Beispielfach', prompt: 'ein erfundener Prompt', icon: 'x', id: 'abc' }]),
      );
      expect(reply.body).toMatchObject({ created: 1 });
      const [subject] = await list();
      expect(subject).toMatchObject({ name: 'Beispielfach', icon: null });
      expect(subject?.id).not.toBe('abc');
    });

    it('ist bei erneutem Import harmlos', async () => {
      const content = json([{ name: 'Beispielfach A' }, { name: 'Beispielfach B' }]);
      await upload('json', content);
      const again = await upload('json', content);
      expect(again.body).toMatchObject({ created: 0, skipped: 2 });
      expect(await list()).toHaveLength(2);
    });

    it.each([
      ['json', 'kein JSON', 'invalid_format'],
      ['json', '[]', 'invalid_format'],
      ['json', JSON.stringify({ version: 2, subjects: [{ name: 'X' }] }), 'invalid_format'],
      ['json', JSON.stringify({ version: 1, subjects: [] }), 'empty'],
      ['csv', 'teacher\nBeispiel', 'invalid_format'],
      ['csv', 'name\n"offen', 'invalid_format'],
      ['csv', 'name\n', 'empty'],
    ] as const)('lehnt %s-Inhalt %j mit Grund %s ab', async (format, content, reason) => {
      const reply = await upload(format, content);
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'content', reason });
      expect(await list()).toEqual([]);
    });

    it('lehnt mehr als 200 Einträge ab', async () => {
      const many = Array.from({ length: 201 }, (_, i) => ({ name: `Beispielfach ${i}` }));
      const reply = await upload('json', json(many));
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'content', reason: 'too_many' });
      expect(await list()).toEqual([]);
    });

    it('nimmt Dateien über 16 KiB an, aber keine über der Grenze', async () => {
      const medium = Array.from({ length: 200 }, (_, i) => ({
        name: `Beispielfach ${i}`,
        teacher: 'x'.repeat(40),
      }));
      const ok = await upload('json', json(medium));
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ created: 200 });

      const tooBig = await upload('json', 'x'.repeat(256 * 1024 + 1));
      expect(tooBig.status).toBe(400);
      const huge = await upload('json', 'x'.repeat(600 * 1024));
      expect(huge.status).toBe(413);
    });

    it('lässt die kleine Grenze für andere Routen bestehen', async () => {
      const reply = await session.call('POST', '/api/subjects', { name: 'x'.repeat(20 * 1024) });
      expect(reply.status).toBe(413);
    });

    it('gibt den Inhalt in Fehlerantworten nie zurück', async () => {
      const reply = await upload('json', '{"version":1,"subjects":[{"name":"geheimer Inhalt"');
      expect(reply.status).toBe(400);
      expect(reply.text).not.toContain('geheimer');
    });

    it('verlangt eine Anmeldung', async () => {
      const reply = await harness.call('POST', '/api/subjects/import', {
        body: { format: 'json', content: json([{ name: 'X' }]) },
      });
      expect(reply.status).toBe(401);
    });
  });

  it('gibt in Fehlerantworten nie die Eingabe zurück', async () => {
    // Ein Zeilenumbruch mitten im Namen ist ungültig (am Rand würde er abgeschnitten).
    const reply = await session.call('POST', '/api/subjects', { name: 'geheimer\nFachname' });
    expect(reply.status).toBe(400);
    expect(reply.text).not.toContain('geheimer');
    expect(reply.text).not.toContain('Fachname');
  });

  describe('eingebautes Fach „Standard“ (fachunabhängiger Chat)', () => {
    interface DefaultSubject extends Subject {
      kind: 'default' | 'subject';
      templateKey: string | null;
    }
    async function defaultSubject(): Promise<DefaultSubject> {
      return (await session.call('GET', '/api/subjects')).body.defaultSubject as DefaultSubject;
    }

    it('ist von Anfang an da, gehört nicht zur Liste der Fächer und wird nicht doppelt angelegt', async () => {
      const first = await defaultSubject();
      expect(first).toMatchObject({ name: 'Standard', kind: 'default', templateKey: 'standard' });
      expect(await list()).toEqual([]);
      expect((await defaultSubject()).id).toBe(first.id);
      const rows = harness.services.database.sqlite
        .prepare("select count(*) as n from subjects where kind = 'default'")
        .get() as { n: number };
      expect(rows.n).toBe(1);
    });

    it('lässt sich weder löschen noch ändern', async () => {
      const subject = await defaultSubject();
      const removed = await session.call('DELETE', `/api/subjects/${subject.id}`);
      expect(removed.status).toBe(409);
      expect(removed.body).toEqual({ error: 'builtin' });
      for (const patch of [
        { name: 'Anders' },
        { icon: 'book' },
        { teacher: 'Beispiel-Lehrkraft' },
      ]) {
        const changed = await session.call('PATCH', `/api/subjects/${subject.id}`, patch);
        expect(changed.status).toBe(409);
        expect(changed.body).toEqual({ error: 'builtin' });
      }
      expect((await defaultSubject()).name).toBe('Standard');
    });

    it('hat einen reservierten Namen: kein Fach darf so heißen oder so umbenannt werden', async () => {
      for (const name of ['Standard', 'standard', 'STANDARD', '  Standard  ']) {
        const created = await session.call('POST', '/api/subjects', { name });
        expect(created.status).toBe(409);
        expect(created.body).toEqual({ error: 'name_reserved' });
      }
      const other = await addSubject('Beispielfach');
      const renamed = await session.call('PATCH', `/api/subjects/${other.id}`, {
        name: 'Standard',
      });
      expect(renamed.status).toBe(409);
      expect(renamed.body).toEqual({ error: 'name_reserved' });
      expect(await list()).toHaveLength(1);
    });

    it('wird beim Import und aus Vorlagen nie als normales Fach angelegt', async () => {
      const imported = await session.call('POST', '/api/subjects/import', {
        format: 'csv',
        content: 'name\nStandard\nBeispielfach\n',
      });
      expect(imported.status).toBe(200);
      expect(imported.body).toMatchObject({ created: 1, skipped: 1 });
    });

    it('trägt Untergruppen und Chats wie jedes Fach', async () => {
      const subject = await defaultSubject();
      const group = await addGroup(subject.id, 'Beispiel-Thema');
      expect(group.name).toBe('Beispiel-Thema');
      const chat = await session.call('POST', '/api/chats', { subjectId: subject.id });
      expect(chat.status).toBe(201);
      expect((await defaultSubject()).groups).toHaveLength(1);
    });

    it('macht Platz, wenn ein Fach des Nutzers schon „Standard“ heißt (Daten aus früheren Versionen)', async () => {
      const { sqlite } = harness.services.database;
      sqlite.prepare("delete from subjects where kind = 'default'").run();
      sqlite
        .prepare(
          "insert into subjects (id, name, created_at, updated_at) values (?, 'Standard', 0, 0)",
        )
        .run('11111111-1111-4111-8111-111111111111');
      const restored = await defaultSubject();
      expect(restored).toMatchObject({ name: 'Standard', kind: 'default' });
      const names = (await list()).map((s) => s.name);
      expect(names).toEqual(['Standard (eigenes Fach)']);
    });
  });
});
