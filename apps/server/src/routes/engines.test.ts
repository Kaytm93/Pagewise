import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session, TEST_PASSCODE } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');

describe('Agent-CLI: Zugänge und Erkennung', () => {
  let harness: Harness;
  let session: Session;
  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  const create = (body: unknown) => session.call('POST', '/api/engines', body);

  it.each([
    ['GET', '/api/engines'],
    ['GET', '/api/engines/cli'],
    ['POST', '/api/engines/detect'],
    ['PUT', '/api/engines/cli-path'],
    ['POST', '/api/engines'],
    ['PATCH', '/api/engines/3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b'],
    ['DELETE', '/api/engines/3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b'],
    ['GET', '/api/assets/3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b/download'],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    expect((await harness.call(method, path)).status).toBe(401);
  });

  it('startet ohne Zugänge und ohne gefundenes Programm und beschreibt die Arten', async () => {
    const reply = await session.call('GET', '/api/engines');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ profiles: [] });
    expect((await session.call('GET', '/api/engines/cli')).body).toEqual({
      cli: { state: 'missing', path: null, version: null, skipped: [], configuredPath: null },
    });
    const kinds = reply.body.kinds as {
      kind: string;
      needsToken: boolean;
      endpoint: string | null;
    }[];
    expect(kinds.map((k) => k.kind)).toEqual([
      'claude-subscription',
      'glm-coding-plan',
      'anthropic-api',
    ]);
    expect(kinds.find((k) => k.kind === 'glm-coding-plan')).toMatchObject({
      needsToken: true,
      endpoint: 'https://api.z.ai/api/anthropic',
      defaultModel: 'glm-5.3-flash',
    });
  });

  describe('Pfad zu claude von Hand eintragen', () => {
    function fakeClaude(dir: string, version = '2.0.7', name = 'claude'): string {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/sh\necho "${version} (Claude Code)"\n`);
      chmodSync(file, 0o755);
      return file;
    }

    it('findet claude über den eingetragenen Pfad, auch außerhalb von PATH und üblichen Orten, und merkt ihn sich', async () => {
      const file = fakeClaude(join(harness.services.paths.root, '..', 'woanders', 'bin'));
      const saved = await session.call('PUT', '/api/engines/cli-path', { path: file });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({
        cli: { state: 'ready', path: file, version: '2.0.7', configuredPath: file },
      });
      expect((await session.call('GET', '/api/engines/cli')).body).toMatchObject({
        cli: { state: 'ready', configuredPath: file },
      });
      // Der Eintrag liegt in den Einstellungen und überlebt einen neuen Detektor.
      expect(harness.services.cliPath.get()).toBe(file);
    });

    it('meldet einen eingetragenen Pfad, der nicht startet, als übersprungen, und räumt mit null auf', async () => {
      const dir = join(harness.services.paths.root, '..', 'kaputt');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'claude');
      writeFileSync(file, '#!/bin/sh\nexit 3\n');
      chmodSync(file, 0o755);
      const saved = await session.call('PUT', '/api/engines/cli-path', { path: file });
      expect(saved.body).toMatchObject({
        cli: { state: 'broken', configuredPath: file, skipped: [{ path: file, reason: 'failed' }] },
      });
      const cleared = await session.call('PUT', '/api/engines/cli-path', { path: null });
      expect(cleared.body).toMatchObject({ cli: { state: 'missing', configuredPath: null } });
      expect(harness.services.cliPath.get()).toBeNull();
    });

    it.each([
      ['relativer Pfad', 'bin/claude'],
      ['Umweg über ..', '/opt/beispiel/../claude'],
      ['andere Datei als claude', '/bin/sh'],
      ['Verzeichnis statt Datei', '/opt/beispiel/claude/'],
      ['Steuerzeichen', '/opt/beispiel/claude\nrm'],
      ['leer', '   '],
      ['zu lang', `/${'a'.repeat(1100)}/claude`],
    ])('lehnt %s ab', async (_name, path) => {
      const reply = await session.call('PUT', '/api/engines/cli-path', { path });
      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: 'invalid_input', field: 'path' });
      expect(harness.services.cliPath.get()).toBeNull();
    });

    it('lehnt fremde Felder und falsche Typen ab', async () => {
      for (const body of [
        {},
        { path: 5 },
        { path: '/x/claude', extra: 1 },
        { pfad: '/x/claude' },
      ]) {
        expect(
          (await session.call('PUT', '/api/engines/cli-path', body)).status,
          JSON.stringify(body),
        ).toBe(400);
      }
    });

    it('wird von „Alles löschen“ entfernt und nutzt die Anmeldung wie alle Engine-Routen', async () => {
      const file = fakeClaude(join(harness.services.paths.root, '..', 'bin2'));
      await session.call('PUT', '/api/engines/cli-path', { path: file });
      expect(harness.services.cliPath.get()).toBe(file);
      const erased = await session.call('POST', '/api/data/erase', { passcode: TEST_PASSCODE });
      expect(erased.status).toBe(204);
      expect(harness.services.cliPath.get()).toBeNull();
    });
  });

  it('erkennt ein vorhandenes Programm erst nach „erneut suchen“', async () => {
    const dir = join(harness.services.paths.root, '..', 'bin');
    mkdirSync(dir, { recursive: true });
    const other = createHarness({ cliDetect: { searchPath: dir, extraDirs: [] } });
    try {
      const otherSession = await other.signIn();
      expect((await otherSession.call('GET', '/api/engines/cli')).body).toMatchObject({
        cli: { state: 'missing' },
      });
      writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho "2.0.1 (Claude Code)"\n');
      chmodSync(join(dir, 'claude'), 0o755);
      // Das Ergebnis ist kurz zwischengespeichert, „erneut suchen“ umgeht das.
      const detected = await otherSession.call('POST', '/api/engines/detect');
      expect(detected.body).toMatchObject({
        cli: { state: 'ready', version: '2.0.1', path: join(dir, 'claude') },
      });
      expect((await otherSession.call('GET', '/api/engines/cli')).body).toMatchObject({
        cli: { state: 'ready' },
      });
    } finally {
      other.close();
    }
  });

  it('legt Zugänge an, zeigt nie den Schlüssel und kennt nur die letzten vier Zeichen', async () => {
    const abo = await create({ kind: 'claude-subscription', name: 'Mein Abo' });
    expect(abo.status).toBe(201);
    expect(abo.body).toMatchObject({ hasToken: false, tokenHint: null, timeoutMinutes: 20 });

    const glm = await create({
      kind: 'glm-coding-plan',
      name: 'GLM',
      token: TOKEN,
      model: 'glm-5.3',
      timeoutMinutes: 30,
    });
    expect(glm.status).toBe(201);
    expect(glm.body).toMatchObject({
      kind: 'glm-coding-plan',
      model: 'glm-5.3',
      timeoutMinutes: 30,
      hasToken: true,
      tokenHint: TOKEN.slice(-4),
    });
    for (const reply of [glm, await session.call('GET', '/api/engines')]) {
      expect(reply.text).not.toContain(TOKEN);
    }
    const list = (await session.call('GET', '/api/engines')).body.profiles as { name: string }[];
    expect(list.map((p) => p.name)).toEqual(['Mein Abo', 'GLM']);
  });

  it.each([
    [
      { kind: 'claude-subscription', name: 'X', token: TOKEN },
      { field: 'token', reason: 'token_not_allowed' },
    ],
    [
      { kind: 'glm-coding-plan', name: 'X' },
      { field: 'token', reason: 'token_required' },
    ],
    [{ kind: 'anthropic-api', name: 'X', token: '   ' }, { field: 'token' }],
  ])('lehnt %j mit 400 ab', async (body, extra) => {
    const reply = await create(body);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ error: 'invalid_input', ...extra });
  });

  it.each([
    [{ kind: 'unbekannt', name: 'X' }, 'kind'],
    [{ kind: 'claude-subscription', name: '' }, 'name'],
    [{ kind: 'claude-subscription', name: 'X', timeoutMinutes: 0 }, 'timeoutMinutes'],
    [{ kind: 'claude-subscription', name: 'X', timeoutMinutes: 121 }, 'timeoutMinutes'],
    [{ kind: 'claude-subscription', name: 'X', timeoutMinutes: 1.5 }, 'timeoutMinutes'],
    [{ kind: 'claude-subscription', name: 'X', model: 'mit Leerzeichen' }, 'model'],
    [{ kind: 'claude-subscription', name: 'X', model: '--flag' }, 'model'],
    [{ kind: 'claude-subscription', name: 'X', zusatz: 1 }, null],
  ])('prüft die Eingabe %j (Feld %s)', async (body, field) => {
    const reply = await create(body);
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_input', field });
  });

  it('meldet doppelte Namen und ändert und löscht Zugänge', async () => {
    const first = await create({ kind: 'claude-subscription', name: 'Mein Abo' });
    expect((await create({ kind: 'claude-subscription', name: 'mein abo' })).status).toBe(409);
    const id = (first.body as { id: string }).id;

    const renamed = await session.call('PATCH', `/api/engines/${id}`, {
      name: 'Anderer Name',
      timeoutMinutes: 5,
    });
    expect(renamed.body).toMatchObject({ name: 'Anderer Name', timeoutMinutes: 5 });
    expect((await session.call('PATCH', `/api/engines/${id}`, {})).status).toBe(400);
    expect((await session.call('PATCH', `/api/engines/${id}`, { token: TOKEN })).status).toBe(400);

    expect((await session.call('DELETE', `/api/engines/${id}`)).status).toBe(204);
    expect((await session.call('DELETE', `/api/engines/${id}`)).status).toBe(404);
    expect((await session.call('PATCH', `/api/engines/${id}`, { name: 'x' })).status).toBe(404);
    expect((await session.call('DELETE', '/api/engines/kein-uuid')).status).toBe(404);
  });

  it('löscht beim Entfernen auch den Schlüssel', async () => {
    const glm = await create({ kind: 'glm-coding-plan', name: 'GLM', token: TOKEN });
    expect(await harness.services.secrets.list()).toHaveLength(1);
    await session.call('DELETE', `/api/engines/${(glm.body as { id: string }).id}`);
    expect(await harness.services.secrets.list()).toEqual([]);
  });
});

describe('Agent-CLI-Zugang bei Fach und Chat', () => {
  let harness: Harness;
  let session: Session;
  let subjectId: string;
  let engineId: string;
  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
    subjectId = (
      (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body as {
        id: string;
      }
    ).id;
    engineId = (
      (await session.call('POST', '/api/engines', { kind: 'claude-subscription', name: 'Abo' }))
        .body as {
        id: string;
      }
    ).id;
  });
  afterEach(() => harness.close());

  const addProvider = async () => {
    const reply = await session.call('POST', '/api/providers', {
      name: 'Anbieter',
      baseUrl: 'https://anbieter.example.test/v1',
      apiKey: ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-'),
      models: [{ id: 'modell-a' }],
    });
    return (reply.body as { id: string }).id;
  };

  it('setzt den Zugang eines Fachs und hebt dabei dessen Modellwahl auf (und umgekehrt)', async () => {
    const providerId = await addProvider();
    const withModel = await session.call('PUT', `/api/subjects/${subjectId}/model`, {
      model: { providerId, model: 'modell-a' },
    });
    expect(withModel.body).toMatchObject({
      model: { providerId, model: 'modell-a' },
      engineProfileId: null,
    });

    const withEngine = await session.call('PUT', `/api/subjects/${subjectId}/engine`, {
      engineProfileId: engineId,
    });
    expect(withEngine.status).toBe(200);
    expect(withEngine.body).toMatchObject({ engineProfileId: engineId, model: null });

    const back = await session.call('PUT', `/api/subjects/${subjectId}/model`, {
      model: { providerId, model: 'modell-a' },
    });
    expect(back.body).toMatchObject({
      engineProfileId: null,
      model: { providerId, model: 'modell-a' },
    });

    expect(
      (await session.call('PUT', `/api/subjects/${subjectId}/engine`, { engineProfileId: null }))
        .body,
    ).toMatchObject({
      engineProfileId: null,
    });
  });

  it('lehnt unbekannte Zugänge ab', async () => {
    const reply = await session.call('PUT', `/api/subjects/${subjectId}/engine`, {
      engineProfileId: '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b',
    });
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_input', field: 'engineProfileId' });
    expect(
      (await session.call('PUT', '/api/subjects/kein-uuid/engine', { engineProfileId: null }))
        .status,
    ).toBe(404);
  });

  it('setzt den Zugang eines Chats, hebt dessen Modell auf und verlangt einen von beiden', async () => {
    const providerId = await addProvider();
    const chat = (await session.call('POST', '/api/chats', { subjectId })).body as { id: string };
    const withEngine = await session.call('PATCH', `/api/chats/${chat.id}`, {
      engineProfileId: engineId,
    });
    expect(withEngine.body).toMatchObject({ engineProfileId: engineId, model: null });

    const withModel = await session.call('PATCH', `/api/chats/${chat.id}`, {
      model: { providerId, model: 'modell-a' },
    });
    expect(withModel.body).toMatchObject({
      engineProfileId: null,
      model: { providerId, model: 'modell-a' },
    });

    // Beides auf einmal ist unklar und wird abgelehnt.
    const both = await session.call('PATCH', `/api/chats/${chat.id}`, {
      engineProfileId: engineId,
      model: { providerId, model: 'modell-a' },
    });
    expect(both.status).toBe(400);
    const unknown = await session.call('PATCH', `/api/chats/${chat.id}`, {
      engineProfileId: '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b',
    });
    expect(unknown.body).toEqual({ error: 'invalid_input', field: 'engineProfileId' });
  });

  it('lässt Fach und Chat auf ihr Modell zurückfallen, wenn der Zugang gelöscht wird', async () => {
    const chat = (await session.call('POST', '/api/chats', { subjectId })).body as { id: string };
    await session.call('PUT', `/api/subjects/${subjectId}/engine`, { engineProfileId: engineId });
    await session.call('PATCH', `/api/chats/${chat.id}`, { engineProfileId: engineId });
    await session.call('DELETE', `/api/engines/${engineId}`);
    const subjects = (await session.call('GET', '/api/subjects')).body.subjects as {
      engineProfileId: string | null;
    }[];
    expect(subjects[0]?.engineProfileId).toBeNull();
    expect((await session.call('GET', `/api/chats/${chat.id}`)).body).toMatchObject({
      engineProfileId: null,
    });
  });
});
