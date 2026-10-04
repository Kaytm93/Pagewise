import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages, notes } from '../db/schema';
import { createHarness, type Harness, type Session } from '../test-harness';

const unknownId = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';

interface Note {
  id: string;
  subjectId: string;
  groupId: string | null;
  title: string;
  markdown?: string;
  pinned: boolean;
  tags: string[];
  excerpt: string;
  sourceChatId: string | null;
}

describe('Hefteinträge', () => {
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

  const note = (extra: Record<string, unknown> = {}) => ({
    subjectId,
    title: 'Beispieleintrag',
    markdown: 'Ein Satz.',
    ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) =>
    (await session.call('POST', '/api/notes', note(extra))).body as unknown as Note;
  const list = async (query: string) =>
    (await session.call('GET', `/api/notes?${query}`)).body.notes as unknown as Note[];
  const group = async (name: string, forSubject = subjectId) =>
    (await session.call('POST', `/api/subjects/${forSubject}/groups`, { name })).body.id as string;

  it.each([
    ['GET', '/api/notes?subjectId=x'],
    ['POST', '/api/notes'],
    ['GET', `/api/notes/${unknownId}`],
    ['PATCH', `/api/notes/${unknownId}`],
    ['DELETE', `/api/notes/${unknownId}`],
    ['POST', `/api/chats/${unknownId}/messages/${unknownId}/note`],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: {} });
    expect(reply.status).toBe(401);
  });

  describe('anlegen, lesen, ändern, löschen', () => {
    it('startet leer und legt einen Eintrag mit Voreinstellungen an', async () => {
      expect(await list(`subjectId=${subjectId}`)).toEqual([]);
      const reply = await session.call('POST', '/api/notes', {
        subjectId,
        title: '  Titel  ',
      });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({
        subjectId,
        groupId: null,
        title: 'Titel',
        markdown: '',
        pinned: false,
        tags: [],
        excerpt: '',
        sourceChatId: null,
      });
    });

    it('liest den ganzen Text einzeln, in Listen nur einen Auszug ohne Blöcke', async () => {
      const text =
        '# Überschrift\n\nErster **Satz** hier.\n\n```graph\n{"functions":["x"]}\n```\n\n$$x^2$$\n\nDanach.';
      const created = await create({ markdown: text });
      const full = (await session.call('GET', `/api/notes/${created.id}`)).body as unknown as Note;
      expect(full.markdown).toBe(text);
      const [entry] = await list(`subjectId=${subjectId}`);
      expect(entry?.markdown).toBeUndefined();
      expect(entry?.excerpt).toBe('Überschrift Erster Satz hier. Danach.');
    });

    it('speichert den Text unverändert, auch Markup und Skripte (bereinigt wird beim Anzeigen)', async () => {
      const hostile =
        '<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))';
      const created = await create({ markdown: hostile });
      expect(
        ((await session.call('GET', `/api/notes/${created.id}`)).body as unknown as Note).markdown,
      ).toBe(hostile);
    });

    it('ändert Felder einzeln und lässt den Rest', async () => {
      const created = await create({ tags: ['a'] });
      const reply = await session.call('PATCH', `/api/notes/${created.id}`, {
        title: 'Neu',
        pinned: true,
        tags: ['Eins', 'eins', 'Zwei'],
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({
        title: 'Neu',
        pinned: true,
        tags: ['Eins', 'Zwei'],
        markdown: 'Ein Satz.',
      });
    });

    it('löscht und meldet danach 404', async () => {
      const created = await create();
      expect((await session.call('DELETE', `/api/notes/${created.id}`)).status).toBe(204);
      expect((await session.call('GET', `/api/notes/${created.id}`)).status).toBe(404);
      expect((await session.call('DELETE', `/api/notes/${created.id}`)).status).toBe(404);
    });

    it('vereinheitlicht Zeilenenden', async () => {
      const created = await create({ markdown: 'a\r\nb\rc' });
      expect(
        ((await session.call('GET', `/api/notes/${created.id}`)).body as unknown as Note).markdown,
      ).toBe('a\nb\nc');
    });
  });

  describe('Prüfung der Eingaben', () => {
    it.each([
      ['fehlender Titel', { title: undefined }, 'title'],
      ['leerer Titel', { title: '   ' }, 'title'],
      ['Titel mit Zeilenumbruch', { title: 'a\nb' }, 'title'],
      ['zu langer Titel', { title: 'x'.repeat(121) }, 'title'],
      ['Steuerzeichen im Text', { markdown: 'a\u0001b' }, 'markdown'],
      ['zu langer Text', { markdown: 'x'.repeat(100_001) }, 'markdown'],
      ['unbekanntes Feld', { extra: 1 }, null],
      ['Stichwort zu lang', { tags: ['x'.repeat(31)] }, 'tags'],
      ['zu viele Stichwörter', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'tags'],
      ['Fach keine ID', { subjectId: 'x' }, 'subjectId'],
    ])('lehnt %s ab', async (_name, extra, field) => {
      const reply = await session.call('POST', '/api/notes', note(extra));
      expect(reply.status).toBe(400);
      expect(reply.body.error).toBe('invalid_input');
      if (field) expect(reply.body.field).toBe(field);
    });

    it('lehnt ein unbekanntes Fach und eine fremde Untergruppe ab', async () => {
      expect(
        (await session.call('POST', '/api/notes', note({ subjectId: unknownId }))).body,
      ).toEqual({
        error: 'invalid_input',
        field: 'subjectId',
      });
      const other = (await session.call('POST', '/api/subjects', { name: 'Beispielfach B' })).body
        .id as string;
      const foreign = await group('Fremd', other);
      expect((await session.call('POST', '/api/notes', note({ groupId: foreign }))).body).toEqual({
        error: 'invalid_input',
        field: 'groupId',
      });
      const own = await create();
      expect(
        (await session.call('PATCH', `/api/notes/${own.id}`, { groupId: foreign })).status,
      ).toBe(400);
    });

    it('lehnt leere Änderungen und falsche IDs ab', async () => {
      const created = await create();
      expect((await session.call('PATCH', `/api/notes/${created.id}`, {})).status).toBe(400);
      expect((await session.call('PATCH', '/api/notes/nicht-gueltig', { title: 'x' })).status).toBe(
        404,
      );
      expect(
        (await session.call('GET', `/api/notes?subjectId=${unknownId}&groupId=x`)).status,
      ).toBe(400);
      expect((await session.call('GET', '/api/notes')).status).toBe(400);
    });

    it('weist zu große Anfragen ab', async () => {
      const reply = await session.call(
        'POST',
        '/api/notes',
        note({ markdown: 'ä'.repeat(300_000) }),
      );
      expect(reply.status).toBe(413);
    });
  });

  describe('Ansichten', () => {
    it('trennt „Allgemein“ und Untergruppen wie bei den Chats', async () => {
      const g = await group('Schulaufgabe');
      await create({ title: 'ohne' });
      await create({ title: 'mit', groupId: g });
      expect((await list(`subjectId=${subjectId}`)).map((n) => n.title)).toEqual(['ohne']);
      expect((await list(`subjectId=${subjectId}&groupId=${g}`)).map((n) => n.title)).toEqual([
        'mit',
      ]);
    });

    it('zeigt Angeheftete zuerst, dann die zuletzt geänderten', async () => {
      const a = await create({ title: 'a' });
      await create({ title: 'b' });
      await create({ title: 'c', pinned: true });
      harness.services.database.sqlite
        .prepare('update notes set updated_at = updated_at + 5000 where id = ?')
        .run(a.id);
      expect((await list(`subjectId=${subjectId}`)).map((n) => n.title)).toEqual(['c', 'a', 'b']);
    });

    it('sucht in Titel und Text, ohne Groß und Klein, Sonderzeichen sind keine Platzhalter', async () => {
      await create({ title: 'Mol und Stoffmenge', markdown: 'n = m / M' });
      await create({ title: 'Anderes', markdown: '100% sicher, a_b' });
      expect((await list(`subjectId=${subjectId}&q=stoffMENGE`)).map((n) => n.title)).toEqual([
        'Mol und Stoffmenge',
      ]);
      expect((await list(`subjectId=${subjectId}&q=m / M`)).length).toBe(1);
      expect(
        (await list(`subjectId=${subjectId}&q=${encodeURIComponent('100%')}`)).map((n) => n.title),
      ).toEqual(['Anderes']);
      expect((await list(`subjectId=${subjectId}&q=${encodeURIComponent('%')}`)).length).toBe(1);
      expect((await list(`subjectId=${subjectId}&q=${encodeURIComponent('_')}`)).length).toBe(1);
      expect((await list(`subjectId=${subjectId}&q=gibtsnicht`)).length).toBe(0);
    });

    it('zeigt Einträge nur im eigenen Fach', async () => {
      const other = (await session.call('POST', '/api/subjects', { name: 'Beispielfach B' })).body
        .id as string;
      await create();
      expect(await list(`subjectId=${other}`)).toEqual([]);
    });

    it('begrenzt die Liste auf 200 Einträge', async () => {
      harness.services.database.db
        .insert(notes)
        .values(Array.from({ length: 250 }, (_, i) => ({ subjectId, title: `n${i}` })))
        .run();
      expect((await list(`subjectId=${subjectId}`)).length).toBe(200);
    });
  });

  describe('Löschen und Grenzen', () => {
    it('Untergruppe löschen lässt den Eintrag im Fach (Allgemein)', async () => {
      const g = await group('Referat');
      const created = await create({ groupId: g });
      expect((await session.call('DELETE', `/api/groups/${g}`)).status).toBe(204);
      expect(
        ((await session.call('GET', `/api/notes/${created.id}`)).body as unknown as Note).groupId,
      ).toBeNull();
      expect((await list(`subjectId=${subjectId}`)).length).toBe(1);
    });

    it('verschwindet mit dem Fach', async () => {
      await create();
      expect((await session.call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(204);
      const { sqlite } = harness.services.database;
      expect(sqlite.prepare('select count(*) as n from notes').get()).toEqual({ n: 0 });
    });

    it('begrenzt die Zahl der Einträge', async () => {
      const { db } = harness.services.database;
      for (let block = 0; block < 10; block += 1) {
        db.insert(notes)
          .values(Array.from({ length: 500 }, () => ({ subjectId, title: 'n' })))
          .run();
      }
      const reply = await session.call('POST', '/api/notes', note());
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'too_many' });
    });

    it('„Alles löschen“ leert die Hefteinträge', async () => {
      await create();
      await harness.services.eraser.eraseAll();
      const { sqlite } = harness.services.database;
      expect(sqlite.prepare('select count(*) as n from notes').get()).toEqual({ n: 0 });
    });

    it('gilt auch für das eingebaute Fach „Standard“', async () => {
      const standard = (await session.call('GET', '/api/subjects')).body.defaultSubject as {
        id: string;
      };
      const reply = await session.call('POST', '/api/notes', note({ subjectId: standard.id }));
      expect(reply.status).toBe(201);
    });
  });

  describe('Antwort aus dem Chat als Hefteintrag', () => {
    async function chatWith(groupId: string | null = null) {
      const chat = (await session.call('POST', '/api/chats', { subjectId, groupId })).body
        .id as string;
      return chat;
    }
    function addMessage(
      chatId: string,
      values: Partial<typeof messages.$inferInsert> & { seq: number },
    ) {
      return harness.services.database.db
        .insert(messages)
        .values({ chatId, role: 'assistant', content: 'Antwort', status: 'complete', ...values })
        .returning()
        .get().id;
    }
    const save = (chatId: string, messageId: string) =>
      session.call('POST', `/api/chats/${chatId}/messages/${messageId}/note`);

    it('übernimmt Text, Fach und Untergruppe vom Chat und merkt sich die Herkunft', async () => {
      const g = await group('Schulaufgabe');
      const chatId = await chatWith(g);
      const content = '# Stoffmenge\n\nn = m / M\n\n```mol\nH2O\n```';
      const messageId = addMessage(chatId, { seq: 1, content });
      const reply = await save(chatId, messageId);
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({
        subjectId,
        groupId: g,
        title: 'Stoffmenge',
        markdown: content,
        sourceChatId: chatId,
      });
    });

    it('nimmt ohne Überschrift die erste Zeile als Titel und entfernt Markdown-Zeichen', async () => {
      const chatId = await chatWith();
      const messageId = addMessage(chatId, {
        seq: 1,
        content: '**Wichtig:** `n` ist die Stoffmenge.',
      });
      expect((await save(chatId, messageId)).body.title).toBe('Wichtig: n ist die Stoffmenge.');
    });

    it('übernimmt angehaltene und unterbrochene Antworten', async () => {
      const chatId = await chatWith();
      expect((await save(chatId, addMessage(chatId, { seq: 1, status: 'stopped' }))).status).toBe(
        201,
      );
      expect(
        (await save(chatId, addMessage(chatId, { seq: 2, status: 'interrupted' }))).status,
      ).toBe(201);
    });

    it.each([
      ['Nachricht des Nutzers', { role: 'user' as const }],
      ['laufende Antwort', { status: 'streaming' as const }],
      ['fehlgeschlagene Antwort', { status: 'error' as const }],
      ['leere Antwort', { content: '  \n ' }],
    ])('lehnt %s ab', async (_name, values) => {
      const chatId = await chatWith();
      const reply = await save(chatId, addMessage(chatId, { seq: 1, ...values }));
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: 'not_savable' });
      expect(
        harness.services.database.sqlite.prepare('select count(*) as n from notes').get(),
      ).toEqual({ n: 0 });
    });

    it('findet unbekannte Chats und Nachrichten nicht, auch nicht über einen fremden Chat', async () => {
      const chatId = await chatWith();
      const other = await chatWith();
      const messageId = addMessage(chatId, { seq: 1 });
      expect((await save(unknownId, messageId)).status).toBe(404);
      expect((await save(chatId, unknownId)).status).toBe(404);
      expect((await save(other, messageId)).status).toBe(404);
      expect((await save('x', 'y')).status).toBe(404);
    });

    it('der Eintrag bleibt, wenn der Chat gelöscht wird (Herkunft entfällt)', async () => {
      const chatId = await chatWith();
      const created = (await save(chatId, addMessage(chatId, { seq: 1 }))).body as unknown as Note;
      expect((await session.call('DELETE', `/api/chats/${chatId}`)).status).toBe(204);
      const after = (await session.call('GET', `/api/notes/${created.id}`)).body as unknown as Note;
      expect(after.sourceChatId).toBeNull();
      expect(after.markdown).toBe('Antwort');
    });

    it('der Server liest den Text selbst: ein Text im Anfragekörper ändert nichts', async () => {
      const chatId = await chatWith();
      const messageId = addMessage(chatId, { seq: 1, content: 'Echter Text' });
      const reply = await session.call('POST', `/api/chats/${chatId}/messages/${messageId}/note`, {
        markdown: 'Untergeschoben',
        title: 'Untergeschoben',
      });
      expect(reply.body).toMatchObject({ markdown: 'Echter Text' });
    });
  });
});
