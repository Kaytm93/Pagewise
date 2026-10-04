import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../db/schema';
import { createHarness, type Harness, type Session } from '../test-harness';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');
const FAKE = fileURLToPath(new URL('../agents/testing/fake-claude.mjs', import.meta.url));

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '';
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

interface Logged {
  argv: string[];
  cwd: string;
  prompt: string;
  systemPrompt: string | null;
}

describe('Chats mit Agent-CLI', () => {
  let base: string;
  let harness: Harness;
  let session: Session;
  let subjectId: string;
  let profileId: string;
  let logFile: string;

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-agent-'));
    mkdirSync(join(base, 'home'), { recursive: true });
    logFile = join(base, 'aufruf.log');
    chmodSync(FAKE, 0o755);
    await build();
  });
  afterEach(() => {
    harness.close();
    rmSync(base, { recursive: true, force: true });
  });

  async function build(options: { withCli?: boolean } = {}) {
    harness = createHarness({
      cliDetect:
        options.withCli === false
          ? undefined
          : { explicitPath: FAKE, searchPath: join(base, 'leer'), extraDirs: [] },
      agent: {
        env: { PATH: process.env.PATH, HOME: join(base, 'home') },
        realHome: join(base, 'home'),
        extraEnv: { FAKE_CLAUDE_LOG: logFile },
      },
    });
    session = await harness.signIn();
    subjectId = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
      .id as string;
    const profile = await session.call('POST', '/api/engines', {
      kind: 'glm-coding-plan',
      name: 'Beispiel-Zugang',
      token: TOKEN,
    });
    expect(profile.status).toBe(201);
    profileId = profile.body.id as string;
  }

  const logs = (): Logged[] =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Logged)
      : [];

  async function newChat(engine = true, groupId: string | null = null): Promise<string> {
    const reply = await session.call('POST', '/api/chats', { subjectId, groupId });
    const id = reply.body.id as string;
    if (engine) {
      expect(
        (await session.call('PATCH', `/api/chats/${id}`, { engineProfileId: profileId })).status,
      ).toBe(200);
    }
    return id;
  }

  const send = (chatId: string, content: string) =>
    session.call('POST', `/api/chats/${chatId}/messages`, { content });
  const last = (events: SseEvent[]) => events.at(-1) as SseEvent;

  async function detail(chatId: string) {
    const reply = await session.call('GET', `/api/chats/${chatId}`);
    return reply.body as {
      messages: {
        role: string;
        content: string;
        status: string;
        engineProfileId: string | null;
        model: string | null;
        errorCode: string | null;
        activity: { tool: string; target: string | null; state: string }[];
        assets: { id: string; name: string; kind: string; size: number }[];
      }[];
    };
  }

  it('antwortet über den Agenten, speichert Zugang und Modell und startet im Arbeitsordner des Fachs', async () => {
    const chatId = await newChat();
    const reply = await send(chatId, 'Erkläre ein Beispiel');
    const events = parseSse(reply.text);
    expect(events.map((e) => e.event)).toEqual(['start', 'snapshot', 'delta', 'delta', 'done']);
    expect(events[0]?.data).toMatchObject({
      assistantMessage: { status: 'streaming', engineProfileId: profileId },
    });
    expect(last(events).data).toMatchObject({
      message: {
        status: 'complete',
        content: 'Antwort auf: Erkläre ein Beispiel',
        engineProfileId: profileId,
        model: 'glm-5.3-flash',
        errorCode: null,
        activity: [],
        assets: [],
      },
    });
    const [call] = logs();
    expect(call?.cwd.endsWith(`/workspaces/${subjectId}`)).toBe(true);
    // Der Auftrag ist nur die Nachricht der Person, das System-Prompt kommt aus der Datei.
    expect(call?.prompt).toBe('Erkläre ein Beispiel');
    expect(call?.systemPrompt).toContain('## Arbeitsumgebung');
    expect(JSON.stringify(call?.argv)).not.toContain('Erkläre');
    expect((await detail(chatId)).messages[1]).toMatchObject({
      engineProfileId: profileId,
      model: 'glm-5.3-flash',
    });
  });

  it('zeigt Werkzeugaufrufe live und speichert sie mit der Nachricht', async () => {
    const chatId = await newChat();
    const events = parseSse((await send(chatId, 'Mach das [[write:notiz.txt]]')).text);
    const activity = events.filter((e) => e.event === 'activity').map((e) => e.data.entry);
    expect(activity[0]).toMatchObject({ tool: 'Write', target: 'notiz.txt', state: 'running' });
    expect(activity.at(-1)).toMatchObject({ tool: 'Write', state: 'done' });
    expect((await detail(chatId)).messages[1]?.activity).toEqual([
      expect.objectContaining({ tool: 'Write', target: 'notiz.txt', state: 'done' }),
    ]);
  });

  it('übernimmt erzeugte Dateien als Assets und liefert sie als Download aus', async () => {
    const chatId = await newChat();
    const events = parseSse((await send(chatId, 'Erstelle [[write:Bericht.pdf]]')).text);
    const message = last(events).data.message as {
      assets: { id: string; name: string; kind: string }[];
    };
    expect(message.assets).toEqual([expect.objectContaining({ name: 'Bericht.pdf', kind: 'pdf' })]);
    // Nach dem Neuladen sind sie noch da.
    const stored = (await detail(chatId)).messages[1]?.assets ?? [];
    expect(stored.map((a) => a.name)).toEqual(['Bericht.pdf']);
    const download = await session.call('GET', `/api/assets/${stored[0]?.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(download.headers.get('content-disposition')).toContain('attachment');
  });

  it('liefert eine PDF- und eine PPTX-Datei aus einem Auftrag als Downloads (Abnahme 1e)', async () => {
    const chatId = await newChat();
    const events = parseSse(
      (await send(chatId, 'Erstelle beides [[write:Bericht.pdf,Folien.pptx]]')).text,
    );
    const message = last(events).data.message as {
      assets: { id: string; name: string; kind: string }[];
    };
    expect(message.assets.map((a) => [a.name, a.kind])).toEqual([
      ['Bericht.pdf', 'pdf'],
      ['Folien.pptx', 'pptx'],
    ]);
    const types: string[] = [];
    for (const asset of message.assets) {
      const download = await session.call('GET', `/api/assets/${asset.id}/download`);
      expect(download.status).toBe(200);
      types.push(download.headers.get('content-type') ?? '');
    }
    expect(types).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
  });

  it('setzt die Sitzung bei der nächsten Nachricht fort', async () => {
    const chatId = await newChat();
    await send(chatId, 'Erste Frage');
    const [first] = logs();
    expect(first?.argv).not.toContain('--resume');
    await send(chatId, 'Zweite Frage');
    const second = logs()[1];
    expect(second?.argv).toContain('--resume');
    // Mit Sitzung genügt die neue Nachricht, der Verlauf steckt in der Sitzung.
    expect(second?.prompt).toBe('Zweite Frage');
  });

  it('beginnt neu mit dem Verlauf im Auftrag, wenn die Sitzung nicht mehr da ist', async () => {
    const chatId = await newChat();
    await send(chatId, 'Erste Frage');
    const events = parseSse((await send(chatId, 'Nächste Frage [[noresume]]')).text);
    expect(last(events).event).toBe('done');
    const calls = logs();
    expect(calls).toHaveLength(3);
    expect(calls[1]?.argv).toContain('--resume');
    expect(calls[2]?.argv).not.toContain('--resume');
    expect(calls[2]?.prompt).toContain('Bisheriger Verlauf');
    expect(calls[2]?.prompt).toContain('Erste Frage');
    expect(calls[2]?.prompt).toContain('Nächste Frage');
  });

  it('gibt dem Agenten den Verlauf mit, wenn ein Chat erst später zum Agenten wechselt', async () => {
    const chatId = await newChat(false);
    // Ohne Modell und ohne Zugang gibt es keine Antwort, aber die Nachricht steht im Verlauf.
    expect((await send(chatId, 'Frage vor dem Wechsel')).status).toBe(409);
    await session.call('PATCH', `/api/chats/${chatId}`, { engineProfileId: profileId });
    await send(chatId, 'Frage nach dem Wechsel');
    expect(logs()[0]?.prompt).toBe('Frage nach dem Wechsel');
  });

  it('meldet Fehler als Code, nie als Text des Programms', async () => {
    const chatId = await newChat();
    const events = parseSse((await send(chatId, '[[fail]]')).text);
    expect(last(events)).toMatchObject({ event: 'failed', data: { code: 'no_package' } });
    expect(JSON.stringify(events)).not.toContain('Insufficient');
    const auth = parseSse((await send(chatId, '[[auth]]')).text);
    expect(last(auth)).toMatchObject({ event: 'failed', data: { code: 'auth_failed' } });
    expect((await detail(chatId)).messages.at(-1)).toMatchObject({
      status: 'error',
      errorCode: 'auth_failed',
      engineProfileId: profileId,
    });
  });

  it('meldet einen Absturz und eine fehlende Sandbox getrennt', async () => {
    const chatId = await newChat();
    expect(last(parseSse((await send(chatId, '[[crash]]')).text)).data).toMatchObject({
      code: 'agent_failed',
    });
    expect(last(parseSse((await send(chatId, '[[sandboxfail]]')).text)).data).toMatchObject({
      code: 'sandbox_unavailable',
    });
  });

  it('meldet fehlendes Programm', async () => {
    harness.close();
    await build({ withCli: false });
    const chatId = await newChat();
    const events = parseSse((await send(chatId, 'Hallo')).text);
    expect(last(events)).toMatchObject({ event: 'failed', data: { code: 'cli_missing' } });
  });

  it('bricht auf Wunsch ab und behält Teile der Antwort', async () => {
    const chatId = await newChat();
    const pending = send(chatId, '[[slow]]');
    await vi.waitFor(async () => {
      expect((await session.call('GET', `/api/chats/${chatId}`)).body.generating).toBe(true);
      // Warten, bis der Agent angefangen hat.
      expect(logs().length).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await session.call('POST', `/api/chats/${chatId}/stop`)).status).toBe(204);
    const events = parseSse((await pending).text);
    expect(last(events).event).toBe('stopped');
    expect((await detail(chatId)).messages[1]).toMatchObject({ status: 'stopped' });
  });

  it('lässt je Arbeitsordner nur einen Agenten gleichzeitig arbeiten', async () => {
    const first = await newChat();
    const second = await newChat();
    const pending = send(first, '[[slow]]');
    await vi.waitFor(() => expect(logs().length).toBeGreaterThan(0));
    const reply = await send(second, 'Hallo');
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: 'workspace_busy' });
    await session.call('POST', `/api/chats/${first}/stop`);
    await pending;
    // Danach geht es.
    expect(last(parseSse((await send(second, 'Hallo')).text)).event).toBe('done');
  });

  it('wiederholt auf Wunsch mit einem API-Modell statt des Agenten', async () => {
    const chatId = await newChat();
    await send(chatId, '[[fail]]');
    // Kein Modell eingerichtet: „viaApi“ meldet das, statt den Agenten erneut zu starten.
    const reply = await session.call('POST', `/api/chats/${chatId}/retry`, { viaApi: true });
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: 'no_model' });
    expect(logs()).toHaveLength(1);
    // Ohne Angabe wird mit dem Agenten wiederholt.
    const again = await session.call('POST', `/api/chats/${chatId}/retry`);
    expect(again.status).toBe(200);
    expect(logs()).toHaveLength(2);
  });

  it('nimmt den Zugang des Fachs, wenn der Chat nichts eigenes gewählt hat', async () => {
    expect(
      (
        await session.call('PUT', `/api/subjects/${subjectId}/engine`, {
          engineProfileId: profileId,
        })
      ).status,
    ).toBe(200);
    const chatId = await newChat(false);
    expect(last(parseSse((await send(chatId, 'Hallo')).text)).event).toBe('done');
    expect(logs()).toHaveLength(1);
  });

  it('löscht beim Löschen des Chats die erzeugten Dateien', async () => {
    const chatId = await newChat();
    await send(chatId, '[[write:a.pdf]]');
    const asset = (await detail(chatId)).messages[1]?.assets[0];
    const file = join(harness.services.paths.assets, asset?.id ?? 'x');
    expect(existsSync(file)).toBe(true);
    expect((await session.call('DELETE', `/api/chats/${chatId}`)).status).toBe(204);
    await vi.waitFor(() => expect(existsSync(file)).toBe(false));
  });

  it('löscht beim Löschen des Fachs Dateien und Arbeitsordner und beendet laufende Agenten', async () => {
    const chatId = await newChat();
    await send(chatId, '[[write:a.pdf]]');
    const asset = (await detail(chatId)).messages[1]?.assets[0];
    const file = join(harness.services.paths.assets, asset?.id ?? 'x');
    const workspace = join(harness.services.paths.workspaces, subjectId);
    expect(existsSync(file) && existsSync(workspace)).toBe(true);
    const slow = await newChat();
    const pending = send(slow, '[[slow]]');
    await vi.waitFor(() => expect(logs().length).toBeGreaterThan(1));
    expect((await session.call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(workspace)).toBe(false);
    await pending;
  });

  it('löscht beim Löschen einer Untergruppe deren Arbeitsordner und Dateien', async () => {
    const group = (
      await session.call('POST', `/api/subjects/${subjectId}/groups`, { name: 'Unterthema' })
    ).body.id as string;
    const chatId = await newChat(true, group);
    // Ohne einen echten Lauf (der Pfad einer Untergruppe ist tiefer als ein temporärer Ordner erlaubt).
    const { services } = harness;
    const dir = services.workspaces.ensure(subjectId, group);
    const subjectDir = services.workspaces.ensure(subjectId, null);
    writeFileSync(join(dir, 'b.pdf'), 'Beispiel');
    const message = services.database.db
      .insert(messages)
      .values({ chatId, seq: 1, role: 'assistant', content: 'x', status: 'complete' })
      .returning()
      .get();
    const [asset] = await services.assets.takeover(dir, new Map(), {
      chatId,
      messageId: message.id,
    });
    const file = join(services.paths.assets, asset?.id ?? 'x');
    expect(existsSync(file)).toBe(true);
    expect((await session.call('DELETE', `/api/groups/${group}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    // Der Arbeitsordner des Fachs selbst bleibt.
    expect(existsSync(subjectDir)).toBe(true);
  });

  it('„Alles löschen“ entfernt auch Konfigurationen und Sitzungen der Agenten', async () => {
    const chatId = await newChat();
    await send(chatId, '[[write:c.pdf]]');
    const engineDir = join(harness.services.paths.root, 'engine');
    expect(existsSync(engineDir)).toBe(true);
    await harness.services.eraser.eraseAll();
    expect(existsSync(engineDir)).toBe(false);
    expect(readdirOrEmpty(harness.services.paths.assets)).toEqual([]);
    expect(readdirOrEmpty(harness.services.paths.workspaces)).toEqual([]);
  });
});

function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
