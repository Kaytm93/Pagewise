import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';

// Alle Inhalte sind erfunden.
const UNKNOWN_ID = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';

interface FileEntry {
  name: string;
  size: number;
  extension: string;
  mtimeMs: number;
}

describe('GET /api/chats/:id/files', () => {
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

  const newChat = async (): Promise<string> => {
    const reply = await session.call('POST', '/api/chats', { subjectId, groupId: null });
    expect(reply.status).toBe(201);
    return reply.body.id as string;
  };

  /** Legt den Arbeitsordner des Chats an, so wie es Code-Ausführung oder Agentlauf täten. */
  const workspaceOf = (chatId: string): string => harness.services.workspaces.ensure(chatId, null);

  it('listet Dateien des Arbeitsordners mit Name, Größe, Endung und Änderungszeit', async () => {
    const chatId = await newChat();
    const dir = workspaceOf(chatId);
    writeFileSync(join(dir, 'bericht.txt'), 'Beispielinhalt');
    writeFileSync(join(dir, 'bild.png'), Buffer.alloc(64, 1));
    writeFileSync(join(dir, 'ohne-endung'), 'x');
    mkdirSync(join(dir, 'beispiel-ordner'));

    const reply = await session.call('GET', `/api/chats/${chatId}/files`);
    expect(reply.status).toBe(200);
    expect(reply.body.truncated).toBe(false);
    const files = reply.body.files as FileEntry[];
    expect(files.map((file) => file.name)).toEqual(['bericht.txt', 'bild.png', 'ohne-endung']);
    const byName = new Map(files.map((file) => [file.name, file]));
    expect(byName.get('bild.png')).toMatchObject({ extension: 'png', size: 64 });
    expect(byName.get('bericht.txt')).toMatchObject({ extension: 'txt', size: 14 });
    expect(byName.get('ohne-endung')?.extension).toBe('');
    for (const file of files) {
      expect(file.mtimeMs).toBeGreaterThan(0);
      expect(Number.isFinite(file.mtimeMs)).toBe(true);
    }
  });

  it('listet versteckte Einträge nie (auch .run.py, .home, .tmp, .mpl nicht)', async () => {
    const chatId = await newChat();
    const dir = workspaceOf(chatId);
    writeFileSync(join(dir, 'sichtbar.txt'), 'Beispiel');
    for (const hidden of ['.run.py', '.home', '.tmp', '.mpl', '.geheim.txt']) {
      writeFileSync(join(dir, hidden), 'x');
    }
    mkdirSync(join(dir, '.versteckt'));

    const reply = await session.call('GET', `/api/chats/${chatId}/files`);
    expect(reply.status).toBe(200);
    const files = reply.body.files as FileEntry[];
    expect(files.map((file) => file.name)).toEqual(['sichtbar.txt']);
  });

  it('listet nichts aus Nachbar-Ordnern oder Unterordnern, auch bei Verknüpfungen nicht', async () => {
    const chatId = await newChat();
    const dir = workspaceOf(chatId);
    // Datei im Arbeitsordner eines anderen Chats und eine direkt im Datenverzeichnis daneben.
    const foreign = join(harness.services.paths.workspaces, UNKNOWN_ID);
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'fremd.txt'), 'Fremd');
    writeFileSync(join(harness.services.paths.root, 'top-geheim.txt'), 'Geheim');
    writeFileSync(join(dir, 'meins.txt'), 'Meins');
    mkdirSync(join(dir, 'unterordner'));
    writeFileSync(join(dir, 'unterordner', 'tiefer.txt'), 'Tief');
    // Verknüpfung auf die fremde Datei: darf nie als Datei erscheinen.
    try {
      symlinkSync(join(foreign, 'fremd.txt'), join(dir, 'link.txt'));
    } catch {
      // Verknüpfungen sind nicht überall möglich (Windows ohne Rechte); der Rest des Tests bleibt.
    }

    const reply = await session.call('GET', `/api/chats/${chatId}/files`);
    expect(reply.status).toBe(200);
    const files = reply.body.files as FileEntry[];
    expect(files.map((file) => file.name)).toEqual(['meins.txt']);
  });

  it('antwortet 404 für unbekannte oder ungültige Chat-IDs', async () => {
    expect((await session.call('GET', `/api/chats/${UNKNOWN_ID}/files`)).status).toBe(404);
    expect((await session.call('GET', '/api/chats/viel-laenger-als-eine-uuid/files')).status).toBe(
      404,
    );
    expect((await session.call('GET', '/api/chats/../../geheim/files')).status).toBe(404);
  });

  it('antwortet 404, wenn der Chat existiert, aber der Arbeitsordner fehlt', async () => {
    const chatId = await newChat();
    expect((await session.call('GET', `/api/chats/${chatId}/files`)).status).toBe(404);
    writeFileSync(join(workspaceOf(chatId), 'da.txt'), 'x');
    expect((await session.call('GET', `/api/chats/${chatId}/files`)).status).toBe(200);
  });

  it('kürzt bei mehr als 200 Dateien und markiert die Antwort', async () => {
    const chatId = await newChat();
    const dir = workspaceOf(chatId);
    for (let index = 0; index < 205; index += 1) {
      writeFileSync(join(dir, `datei-${String(index).padStart(3, '0')}.txt`), 'x');
    }
    const reply = await session.call('GET', `/api/chats/${chatId}/files`);
    expect(reply.status).toBe(200);
    const files = reply.body.files as FileEntry[];
    expect(files).toHaveLength(200);
    // Deterministische Sortierung: die ersten 200 nach Name.
    expect(files[0]?.name).toBe('datei-000.txt');
    expect(files[199]?.name).toBe('datei-199.txt');
    expect(reply.body.truncated).toBe(true);
  });
});
