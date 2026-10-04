import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exams, timetableEntries } from '../db/schema';
import { createHarness, type Harness, type Session } from '../test-harness';

const unknownId = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';

interface Entry {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  subjectId: string | null;
  room: string | null;
  note: string | null;
  week: string;
}
interface Exam {
  id: string;
  subjectId: string;
  kind: string;
  title: string | null;
  date: string;
  time: string | null;
  topics: string | null;
  notes: string | null;
}

describe('Stundenplan und Tests', () => {
  let harness: Harness;
  let session: Session;
  let subjectId: string;

  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
    subjectId = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
      .id as string;
  });
  afterEach(() => harness.close());

  const lesson = (extra: Record<string, unknown> = {}) => ({
    weekday: 1,
    startTime: '08:00',
    endTime: '08:45',
    subjectId,
    ...extra,
  });
  const exam = (extra: Record<string, unknown> = {}) => ({
    subjectId,
    kind: 'Schulaufgabe',
    date: '2026-10-08',
    ...extra,
  });

  it.each([
    ['GET', '/api/timetable'],
    ['POST', '/api/timetable'],
    ['PUT', '/api/timetable/week'],
    ['PATCH', `/api/timetable/${unknownId}`],
    ['DELETE', `/api/timetable/${unknownId}`],
    ['GET', '/api/exams'],
    ['POST', '/api/exams'],
    ['PATCH', `/api/exams/${unknownId}`],
    ['DELETE', `/api/exams/${unknownId}`],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: {} });
    expect(reply.status).toBe(401);
  });

  describe('Stundenplan', () => {
    it('startet leer und legt Stunden an, sortiert nach Tag und Beginn', async () => {
      expect((await session.call('GET', '/api/timetable')).body).toEqual({
        entries: [],
        weekAnchor: null,
      });
      await session.call(
        'POST',
        '/api/timetable',
        lesson({ weekday: 2, startTime: '09:00', endTime: '09:45' }),
      );
      await session.call(
        'POST',
        '/api/timetable',
        lesson({ startTime: '10:00', endTime: '10:45' }),
      );
      const second = await session.call(
        'POST',
        '/api/timetable',
        lesson({ room: ' Raum 12 ', note: ' Labor ', week: 'a' }),
      );
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ room: 'Raum 12', note: 'Labor', week: 'a', weekday: 1 });
      const list = (await session.call('GET', '/api/timetable')).body.entries as Entry[];
      expect(list.map((e) => [e.weekday, e.startTime])).toEqual([
        [1, '08:00'],
        [1, '10:00'],
        [2, '09:00'],
      ]);
    });

    it('nimmt Stunden ohne Fach, Raum und Notiz an (Voreinstellung: jede Woche)', async () => {
      const reply = await session.call('POST', '/api/timetable', {
        weekday: 5,
        startTime: '13:00',
        endTime: '13:45',
      });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ subjectId: null, room: null, note: null, week: 'all' });
    });

    it('lehnt ungültige Angaben mit Feldnamen ab, ohne die Eingabe zu wiederholen', async () => {
      const cases: [Record<string, unknown>, string | null][] = [
        [lesson({ weekday: 0 }), 'weekday'],
        [lesson({ weekday: 8 }), 'weekday'],
        [lesson({ weekday: 1.5 }), 'weekday'],
        [lesson({ startTime: '8:00' }), 'startTime'],
        [lesson({ endTime: '24:00' }), 'endTime'],
        [lesson({ week: 'c' }), 'week'],
        [lesson({ room: 'x'.repeat(41) }), 'room'],
        [lesson({ note: 'x'.repeat(201) }), 'note'],
        [lesson({ room: 'Raum\n12' }), 'room'],
        [lesson({ subjectId: 'kein-uuid' }), 'subjectId'],
        [lesson({ fremd: 1 }), null],
      ];
      for (const [body, field] of cases) {
        const reply = await session.call('POST', '/api/timetable', body);
        expect(reply.status, JSON.stringify(body)).toBe(400);
        expect(reply.body.error).toBe('invalid_input');
        if (field) expect(reply.body.field).toBe(field);
        expect(reply.text).not.toContain('Labor');
      }
    });

    it('verlangt ein Ende nach dem Beginn', async () => {
      for (const [start, end] of [
        ['08:00', '08:00'],
        ['09:00', '08:00'],
      ] as const) {
        const reply = await session.call(
          'POST',
          '/api/timetable',
          lesson({ startTime: start, endTime: end }),
        );
        expect(reply.status).toBe(400);
        expect(reply.body).toEqual({
          error: 'invalid_input',
          field: 'endTime',
          reason: 'before_start',
        });
      }
    });

    it('erlaubt Überschneidungen (die Oberfläche warnt)', async () => {
      await session.call('POST', '/api/timetable', lesson());
      const overlap = await session.call(
        'POST',
        '/api/timetable',
        lesson({ startTime: '08:30', endTime: '09:15' }),
      );
      expect(overlap.status).toBe(201);
    });

    it('nimmt nur Fächer des Nutzers: unbekannt und das eingebaute „Standard“ werden abgelehnt', async () => {
      const unknown = await session.call(
        'POST',
        '/api/timetable',
        lesson({ subjectId: unknownId }),
      );
      expect(unknown.body).toEqual({ error: 'invalid_input', field: 'subjectId' });
      const standard = (await session.call('GET', '/api/subjects')).body.defaultSubject as {
        id: string;
      };
      const builtin = await session.call(
        'POST',
        '/api/timetable',
        lesson({ subjectId: standard.id }),
      );
      expect(builtin.status).toBe(400);
    });

    it('ändert einzelne Angaben, prüft die Zeiten zusammen und leert Raum und Notiz mit null', async () => {
      const created = (
        await session.call('POST', '/api/timetable', lesson({ room: 'R1', note: 'N' }))
      ).body as unknown as Entry;
      const patched = await session.call('PATCH', `/api/timetable/${created.id}`, {
        endTime: '09:30',
        room: null,
      });
      expect(patched.body).toMatchObject({
        endTime: '09:30',
        room: null,
        note: 'N',
        startTime: '08:00',
      });
      // Neuer Beginn nach dem bisherigen Ende ist ungültig.
      const bad = await session.call('PATCH', `/api/timetable/${created.id}`, {
        startTime: '10:00',
      });
      expect(bad.body).toEqual({
        error: 'invalid_input',
        field: 'endTime',
        reason: 'before_start',
      });
      expect((await session.call('PATCH', `/api/timetable/${created.id}`, {})).status).toBe(400);
      expect(
        (await session.call('PATCH', `/api/timetable/${unknownId}`, { room: 'x' })).status,
      ).toBe(404);
      expect((await session.call('PATCH', '/api/timetable/kein-uuid', { room: 'x' })).status).toBe(
        404,
      );
    });

    it('löscht eine Stunde', async () => {
      const created = (await session.call('POST', '/api/timetable', lesson()))
        .body as unknown as Entry;
      expect((await session.call('DELETE', `/api/timetable/${created.id}`)).status).toBe(204);
      expect((await session.call('DELETE', `/api/timetable/${created.id}`)).status).toBe(404);
    });

    it('lässt Stunden stehen, wenn das Fach gelöscht wird (ohne Fach)', async () => {
      const created = (await session.call('POST', '/api/timetable', lesson()))
        .body as unknown as Entry;
      expect((await session.call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(204);
      const list = (await session.call('GET', '/api/timetable')).body.entries as Entry[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: created.id, subjectId: null });
    });

    it('begrenzt die Zahl der Stunden', async () => {
      const { db } = harness.services.database;
      db.insert(timetableEntries)
        .values(
          Array.from({ length: 500 }, () => ({ weekday: 1, startTime: '08:00', endTime: '08:45' })),
        )
        .run();
      const reply = await session.call('POST', '/api/timetable', lesson());
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'too_many' });
    });

    it('merkt sich, welche Wochenart die aktuelle Woche hat, und hebt das wieder auf', async () => {
      // Der Donnerstag der Woche zählt: gespeichert wird ihr Montag.
      const set = await session.call('PUT', '/api/timetable/week', {
        anchor: { date: '2026-10-08', week: 'b' },
      });
      expect(set.body).toEqual({ weekAnchor: { monday: '2026-10-05', week: 'b' } });
      expect((await session.call('GET', '/api/timetable')).body.weekAnchor).toEqual({
        monday: '2026-10-05',
        week: 'b',
      });
      expect((await session.call('PUT', '/api/timetable/week', { anchor: null })).body).toEqual({
        weekAnchor: null,
      });
      expect((await session.call('GET', '/api/timetable')).body.weekAnchor).toBeNull();
      const bad = await session.call('PUT', '/api/timetable/week', {
        anchor: { date: '2026-02-30', week: 'a' },
      });
      expect(bad.status).toBe(400);
      expect(
        (
          await session.call('PUT', '/api/timetable/week', {
            anchor: { date: '2026-10-08', week: 'c' },
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('Tests', () => {
    it('legt Einträge an, sortiert nach Datum und Uhrzeit und filtert', async () => {
      const other = (await session.call('POST', '/api/subjects', { name: 'Beispielfach B' })).body
        .id as string;
      await session.call('POST', '/api/exams', exam({ date: '2026-10-20', kind: 'Test' }));
      await session.call(
        'POST',
        '/api/exams',
        exam({ date: '2026-10-08', time: '10:00', title: ' Kapitel 3 ', topics: 'Eins\r\nZwei' }),
      );
      await session.call(
        'POST',
        '/api/exams',
        exam({ date: '2026-10-08', kind: 'Ex', subjectId: other }),
      );
      const all = (await session.call('GET', '/api/exams')).body.exams as Exam[];
      expect(all.map((e) => [e.date, e.time, e.kind])).toEqual([
        ['2026-10-08', null, 'Ex'],
        ['2026-10-08', '10:00', 'Schulaufgabe'],
        ['2026-10-20', null, 'Test'],
      ]);
      expect(all[1]).toMatchObject({ title: 'Kapitel 3', topics: 'Eins\nZwei' });

      const from = (await session.call('GET', '/api/exams?from=2026-10-09')).body.exams as Exam[];
      expect(from.map((e) => e.date)).toEqual(['2026-10-20']);
      const range = (await session.call('GET', '/api/exams?from=2026-10-08&to=2026-10-08')).body
        .exams as Exam[];
      expect(range).toHaveLength(2);
      const bySubject = (await session.call('GET', `/api/exams?subjectId=${other}`)).body
        .exams as Exam[];
      expect(bySubject.map((e) => e.kind)).toEqual(['Ex']);
    });

    it('lehnt ungültige Angaben ab', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [exam({ kind: '' }), 'kind'],
        [exam({ kind: 'x'.repeat(41) }), 'kind'],
        [exam({ date: '2026-02-30' }), 'date'],
        [exam({ date: '08.10.2026' }), 'date'],
        [exam({ time: '25:00' }), 'time'],
        [exam({ title: 'x'.repeat(121) }), 'title'],
        [exam({ topics: 'x'.repeat(2001) }), 'topics'],
        [exam({ subjectId: 'kein-uuid' }), 'subjectId'],
        [{ kind: 'Test', date: '2026-10-08' }, 'subjectId'],
      ];
      for (const [body, field] of cases) {
        const reply = await session.call('POST', '/api/exams', body);
        expect(reply.status, JSON.stringify(body)).toBe(400);
        expect(reply.body).toMatchObject({ error: 'invalid_input', field });
      }
      expect(
        (await session.call('POST', '/api/exams', exam({ subjectId: unknownId }))).body,
      ).toEqual({
        error: 'invalid_input',
        field: 'subjectId',
      });
      expect((await session.call('GET', '/api/exams?from=morgen')).status).toBe(400);
    });

    it('ändert und löscht Einträge', async () => {
      const created = (await session.call('POST', '/api/exams', exam({ topics: 'Alt' })))
        .body as unknown as Exam;
      const patched = await session.call('PATCH', `/api/exams/${created.id}`, {
        date: '2026-10-15',
        time: '08:00',
        topics: null,
      });
      expect(patched.body).toMatchObject({
        date: '2026-10-15',
        time: '08:00',
        topics: null,
        kind: 'Schulaufgabe',
      });
      expect(
        (await session.call('PATCH', `/api/exams/${created.id}`, { time: null })).body,
      ).toMatchObject({ time: null });
      expect(
        (await session.call('PATCH', `/api/exams/${created.id}`, { date: '2026-13-01' })).status,
      ).toBe(400);
      expect((await session.call('PATCH', `/api/exams/${created.id}`, {})).status).toBe(400);
      expect(
        (await session.call('PATCH', `/api/exams/${unknownId}`, { kind: 'Test' })).status,
      ).toBe(404);
      expect((await session.call('DELETE', `/api/exams/${created.id}`)).status).toBe(204);
      expect((await session.call('DELETE', `/api/exams/${created.id}`)).status).toBe(404);
    });

    it('verschwindet mit dem Fach', async () => {
      await session.call('POST', '/api/exams', exam());
      expect((await session.call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(204);
      expect((await session.call('GET', '/api/exams')).body.exams).toEqual([]);
    });

    it('begrenzt die Zahl der Einträge', async () => {
      const { db } = harness.services.database;
      db.insert(exams)
        .values(
          Array.from({ length: 2000 }, () => ({ subjectId, kind: 'Test', date: '2026-10-08' })),
        )
        .run();
      const reply = await session.call('POST', '/api/exams', exam());
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'too_many' });
    });
  });

  it('„Alles löschen“ leert Stundenplan, Tests und die Wochenart', async () => {
    await session.call('POST', '/api/timetable', lesson());
    await session.call('POST', '/api/exams', exam());
    await session.call('PUT', '/api/timetable/week', { anchor: { date: '2026-10-08', week: 'a' } });
    await harness.services.eraser.eraseAll();
    const { sqlite } = harness.services.database;
    expect(sqlite.prepare('select count(*) as n from timetable_entries').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('select count(*) as n from exams').get()).toEqual({ n: 0 });
    expect(
      sqlite.prepare("select count(*) as n from settings where key like 'timetable.%'").get(),
    ).toEqual({ n: 0 });
  });
});
