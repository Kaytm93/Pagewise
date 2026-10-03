import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';

interface Group {
  id: string;
  name: string;
  position: number;
}
interface Subject {
  id: string;
  name: string;
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

  it('gibt in Fehlerantworten nie die Eingabe zurück', async () => {
    // Ein Zeilenumbruch mitten im Namen ist ungültig (am Rand würde er abgeschnitten).
    const reply = await session.call('POST', '/api/subjects', { name: 'geheimer\nFachname' });
    expect(reply.status).toBe(400);
    expect(reply.text).not.toContain('geheimer');
    expect(reply.text).not.toContain('Fachname');
  });
});
