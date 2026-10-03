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
    expect((await session.call('GET', `/api/prompts/subjects/${subject.id}`)).body).toEqual({
      text: null,
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
        layers: [{ layer: 0, text: TECHNICAL_LAYER }],
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
          { layer: 0, text: TECHNICAL_LAYER },
          { layer: 1, text: 'Allgemein: Beispielland, Beispielschule, Stufe 11' },
          { layer: 2, text: 'Fach: Beispielfach A' },
          { layer: 3, text: 'Thema: Beispiel-Thema in Beispielfach A' },
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
});
