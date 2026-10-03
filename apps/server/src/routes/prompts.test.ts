import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROMPT_MAX_CHARACTERS } from '../http/fields';
import { TECHNICAL_LAYER } from '../prompts/compose';
import { createHarness, type Harness, type Session } from '../test-harness';

describe('Prompt-Schichten', () => {
  let harness: Harness;
  let session: Session;

  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  async function addSubject(name = 'Beispielfach A'): Promise<{ id: string }> {
    const reply = await session.call('POST', '/api/subjects', { name });
    return reply.body as { id: string };
  }
  async function addGroup(subjectId: string, name = 'Beispiel-Thema'): Promise<{ id: string }> {
    const reply = await session.call('POST', `/api/subjects/${subjectId}/groups`, { name });
    return reply.body as { id: string };
  }

  it.each([
    ['GET', '/api/prompts/general'],
    ['PUT', '/api/prompts/general'],
    ['GET', '/api/prompts/variables'],
    ['GET', '/api/prompts/preview'],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, method === 'PUT' ? { body: {} } : {});
    expect(reply.status).toBe(401);
  });

  it('startet ohne jeden Prompt-Text', async () => {
    const subject = await addSubject();
    const group = await addGroup(subject.id);
    expect((await session.call('GET', '/api/prompts/general')).body).toEqual({ text: null });
    // Ohne mitgelieferten Standardtext gibt es auch für das Fach nichts (hier hat das Testsystem keine).
    expect((await session.call('GET', `/api/prompts/subjects/${subject.id}`)).body).toEqual({
      text: null,
      defaultText: null,
      source: 'none',
    });
    expect((await session.call('GET', `/api/prompts/groups/${group.id}`)).body).toEqual({
      text: null,
    });
  });

  it('nennt die erlaubten Variablen', async () => {
    const reply = await session.call('GET', '/api/prompts/variables');
    expect(reply.body).toEqual({
      variables: ['bundesland', 'schulform', 'jahrgangsstufe', 'fach', 'untergruppe'],
    });
  });

  it('speichert und liest den allgemeinen Prompt, vereinheitlicht Zeilenenden und leert mit leerem Text', async () => {
    const saved = await session.call('PUT', '/api/prompts/general', {
      text: 'Zeile 1\r\nZeile 2 {{fach}}\tEnde',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ text: 'Zeile 1\nZeile 2 {{fach}}\tEnde' });
    expect((await session.call('GET', '/api/prompts/general')).body).toEqual(saved.body);

    const cleared = await session.call('PUT', '/api/prompts/general', { text: '  \n ' });
    expect(cleared.body).toEqual({ text: null });
    expect((await session.call('PUT', '/api/prompts/general', { text: null })).body).toEqual({
      text: null,
    });
  });

  it('speichert Fach- und Untergruppen-Prompt getrennt und löscht sie mit ihrem Eintrag', async () => {
    const subject = await addSubject();
    const group = await addGroup(subject.id);
    await session.call('PUT', `/api/prompts/subjects/${subject.id}`, { text: 'Fach-Text' });
    await session.call('PUT', `/api/prompts/groups/${group.id}`, { text: 'Gruppen-Text' });
    expect((await session.call('GET', `/api/prompts/subjects/${subject.id}`)).body).toEqual({
      text: 'Fach-Text',
      defaultText: null,
      source: 'custom',
    });
    expect((await session.call('GET', `/api/prompts/groups/${group.id}`)).body).toEqual({
      text: 'Gruppen-Text',
    });

    await session.call('DELETE', `/api/subjects/${subject.id}`);
    expect((await session.call('GET', `/api/prompts/subjects/${subject.id}`)).status).toBe(404);
    expect((await session.call('GET', `/api/prompts/groups/${group.id}`)).status).toBe(404);
  });

  it('antwortet für unbekannte oder ungültige IDs mit 404', async () => {
    const unknown = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';
    for (const path of [
      `/api/prompts/subjects/${unknown}`,
      '/api/prompts/subjects/kein-uuid',
      `/api/prompts/groups/${unknown}`,
    ]) {
      expect((await session.call('GET', path)).status).toBe(404);
      expect((await session.call('PUT', path, { text: 'x' })).status).toBe(404);
    }
  });

  it.each([
    ['zu lang', 'x'.repeat(PROMPT_MAX_CHARACTERS + 1)],
    ['mit NUL', 'a\u0000b'],
    ['mit Steuerzeichen', 'a\u001bb'],
    ['keine Zeichenkette', 5],
  ])('lehnt einen Prompt %s ab', async (_label, text) => {
    const reply = await session.call('PUT', '/api/prompts/general', { text });
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_input', field: 'text' });
    expect((await session.call('GET', '/api/prompts/general')).body).toEqual({ text: null });
  });

  it('nimmt einen Prompt an der Längengrenze an, auch mit Umlauten', async () => {
    const text = 'ä'.repeat(PROMPT_MAX_CHARACTERS);
    const reply = await session.call('PUT', '/api/prompts/general', { text });
    expect(reply.status).toBe(200);
    expect((reply.body as { text: string }).text).toHaveLength(PROMPT_MAX_CHARACTERS);
  });

  it('lehnt unbekannte Felder und zu große Körper ab', async () => {
    expect(
      (await session.call('PUT', '/api/prompts/general', { text: 'x', extra: 1 })).status,
    ).toBe(400);
    const huge = await session.call('PUT', '/api/prompts/general', { text: 'x'.repeat(200_000) });
    expect(huge.status).toBe(413);
  });

  describe('Vorschau', () => {
    it('besteht ohne eigenen Text nur aus der technischen Schicht', async () => {
      const subject = await addSubject();
      const reply = await session.call('GET', `/api/prompts/preview?subjectId=${subject.id}`);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        system: TECHNICAL_LAYER,
        layers: [{ layer: 0, text: TECHNICAL_LAYER, origin: 'code' }],
        missing: [],
      });
    });

    it('setzt Schichten zusammen und füllt die Variablen aus Profil, Fach und Untergruppe', async () => {
      await session.call('PATCH', '/api/profile', {
        federalState: 'Beispielland',
        schoolType: 'Beispielschule',
        gradeLevel: '11',
      });
      const subject = await addSubject('Beispielfach A');
      const group = await addGroup(subject.id, 'Beispiel-Thema');
      await session.call('PUT', '/api/prompts/general', {
        text: 'Allgemein: {{bundesland}}, {{schulform}}, Stufe {{jahrgangsstufe}}',
      });
      await session.call('PUT', `/api/prompts/subjects/${subject.id}`, { text: 'Fach: {{fach}}' });
      await session.call('PUT', `/api/prompts/groups/${group.id}`, {
        text: 'Thema: {{untergruppe}} in {{fach}}',
      });

      const reply = await session.call(
        'GET',
        `/api/prompts/preview?subjectId=${subject.id}&groupId=${group.id}`,
      );
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        system: [
          TECHNICAL_LAYER,
          'Allgemein: Beispielland, Beispielschule, Stufe 11',
          'Fach: Beispielfach A',
          'Thema: Beispiel-Thema in Beispielfach A',
        ].join('\n\n'),
        layers: [
          { layer: 0, text: TECHNICAL_LAYER, origin: 'code' },
          { layer: 1, text: 'Allgemein: Beispielland, Beispielschule, Stufe 11', origin: 'custom' },
          { layer: 2, text: 'Fach: Beispielfach A', origin: 'custom' },
          { layer: 3, text: 'Thema: Beispiel-Thema in Beispielfach A', origin: 'custom' },
        ],
        missing: [],
      });
    });

    it('meldet Variablen ohne Wert, statt sie leer zu lassen', async () => {
      const subject = await addSubject();
      await session.call('PUT', '/api/prompts/general', { text: 'Land: {{bundesland}}' });
      const reply = await session.call('GET', `/api/prompts/preview?subjectId=${subject.id}`);
      expect(reply.body.missing).toEqual(['bundesland']);
      expect(reply.body.system).toContain('Land: (nicht angegeben)');
    });

    it('lässt den Untergruppen-Zusatz bei einem Chat im Fach ohne Untergruppe weg', async () => {
      const subject = await addSubject();
      const group = await addGroup(subject.id);
      await session.call('PUT', `/api/prompts/groups/${group.id}`, { text: 'Nur Thema' });
      const reply = await session.call('GET', `/api/prompts/preview?subjectId=${subject.id}`);
      expect(reply.body.system).not.toContain('Nur Thema');
    });

    it('lehnt eine Untergruppe eines anderen Fachs ab', async () => {
      const first = await addSubject('Beispielfach A');
      const second = await addSubject('Beispielfach B');
      const foreign = await addGroup(second.id);
      const reply = await session.call(
        'GET',
        `/api/prompts/preview?subjectId=${first.id}&groupId=${foreign.id}`,
      );
      expect(reply.status).toBe(404);
    });

    it('prüft die Parameter', async () => {
      expect((await session.call('GET', '/api/prompts/preview')).body).toEqual({
        error: 'invalid_input',
        field: 'subjectId',
      });
      const subject = await addSubject();
      const reply = await session.call(
        'GET',
        `/api/prompts/preview?subjectId=${subject.id}&groupId=nein`,
      );
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'groupId' });
      const unknown = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';
      expect((await session.call('GET', `/api/prompts/preview?subjectId=${unknown}`)).status).toBe(
        404,
      );
    });
  });

  describe('Standard-Prompts je Fach (D-034)', () => {
    let defaultsHarness: Harness;
    let defaultsSession: Session;
    let dir: string;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'pagewise-defaults-'));
      const catalog = join(dir, 'katalog.json');
      writeFileSync(
        catalog,
        JSON.stringify({
          version: 2,
          categories: [{ id: 'beispiele', name: 'Beispiele' }],
          subjects: [
            {
              key: 'beispiel-a',
              name: 'Beispielfach A',
              category: 'beispiele',
              aliases: ['Fach A'],
            },
            { key: 'beispiel-b', name: 'Beispielfach B', category: 'beispiele' },
          ],
        }),
      );
      const defaults = join(dir, 'standards');
      mkdirSync(defaults);
      writeFileSync(join(defaults, 'beispiel-a.md'), 'Standard A für {{fach}}.\n');
      writeFileSync(join(defaults, '_generic.md'), 'Allgemeiner Standard für {{fach}}.\n');
      writeFileSync(join(defaults, 'standard.md'), 'Standard für den fachlosen Chat.\n');
      defaultsHarness = createHarness({ catalogFile: catalog, defaultsDir: defaults });
      defaultsSession = await defaultsHarness.signIn();
    });
    afterEach(() => {
      defaultsHarness.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const add = async (name: string, templateKey?: string) =>
      (await defaultsSession.call('POST', '/api/subjects', { name, templateKey }))
        .body as unknown as { id: string };
    const read = async (id: string) =>
      (await defaultsSession.call('GET', `/api/prompts/subjects/${id}`)).body;
    const preview = async (id: string) =>
      (await defaultsSession.call('GET', `/api/prompts/preview?subjectId=${id}`)).body as {
        system: string;
        layers: { layer: number; text: string; origin: string }[];
      };

    it('gilt ohne eigenen Text und kommt aus der Vorlage des Fachs', async () => {
      const subject = await add('Eigener Name', 'beispiel-a');
      expect(await read(subject.id)).toEqual({
        text: null,
        defaultText: 'Standard A für {{fach}}.',
        source: 'default',
      });
      const result = await preview(subject.id);
      expect(result.layers.at(-1)).toEqual({
        layer: 2,
        text: 'Standard A für Eigener Name.',
        origin: 'default',
      });
      expect(result.system).toContain('Standard A für Eigener Name.');
    });

    it('greift auch bei einem von Hand getippten Namen oder Suchbegriff', async () => {
      for (const name of ['beispielfach a', 'Fach A']) {
        const subject = await add(name);
        expect((await read(subject.id)) as { source: string }).toMatchObject({
          source: 'default',
          defaultText: 'Standard A für {{fach}}.',
        });
      }
    });

    it('fällt für Fächer ohne eigenen Standardtext auf den allgemeinen Text zurück', async () => {
      const unknown = await add('Ganz Eigenes Fach');
      const known = await add('Beispielfach B', 'beispiel-b');
      for (const subject of [unknown, known]) {
        expect(await read(subject.id)).toMatchObject({
          source: 'default',
          defaultText: 'Allgemeiner Standard für {{fach}}.',
        });
      }
    });

    it('bekommt für das eingebaute Fach „Standard“ den Text `standard`', async () => {
      const list = (await defaultsSession.call('GET', '/api/subjects')).body as {
        defaultSubject: { id: string };
      };
      expect(await read(list.defaultSubject.id)).toMatchObject({
        source: 'default',
        defaultText: 'Standard für den fachlosen Chat.',
      });
    });

    it('wird von einem eigenen Text verdrängt und lässt sich zurücksetzen', async () => {
      const subject = await add('Beispielfach A');
      const saved = await defaultsSession.call('PUT', `/api/prompts/subjects/${subject.id}`, {
        text: 'Mein Text für {{fach}}',
      });
      expect(saved.body).toEqual({
        text: 'Mein Text für {{fach}}',
        defaultText: 'Standard A für {{fach}}.',
        source: 'custom',
      });
      const custom = await preview(subject.id);
      expect(custom.layers.at(-1)).toEqual({
        layer: 2,
        text: 'Mein Text für Beispielfach A',
        origin: 'custom',
      });
      expect(custom.system).not.toContain('Standard A');

      // Ein leerer Text stellt den Standard wieder her.
      const reset = await defaultsSession.call('PUT', `/api/prompts/subjects/${subject.id}`, {
        text: '',
      });
      expect(reset.body).toMatchObject({ text: null, source: 'default' });
      expect((await preview(subject.id)).system).toContain('Standard A für Beispielfach A.');
    });

    it('wirkt auch im Chat: der Anbieter bekommt den Standardtext als System-Prompt', async () => {
      // Der Zusammenbau ist derselbe wie bei der Vorschau (eine Funktion für beide).
      const subject = await add('Beispielfach A');
      const result = await preview(subject.id);
      expect(result.system.split('\n\n')).toContain('Standard A für Beispielfach A.');
    });
  });
});
