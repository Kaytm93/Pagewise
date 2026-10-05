import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResourceDir } from '../test-resources';
import { type Channel, runEmbedded } from './embedded';
import type { ServerMessage } from './protocol';

const FAST = { scryptParams: { N: 16, r: 8, p: 1 } } as const;
const PASSCODE = 'ein erfundener Beispiel-Passcode';

/** Ersatz für `process.parentPort`: sammelt Meldungen und lässt den Test Befehle schicken. */
function fakeChannel() {
  const messages: ServerMessage[] = [];
  let handler: ((data: unknown) => void) | null = null;
  const channel: Channel = {
    post: (message) => messages.push(message),
    onMessage: (h) => {
      handler = h;
    },
  };
  let nextId = 1;
  return {
    channel,
    messages,
    send: (data: unknown) => handler?.(data),
    async ask(type: string): Promise<Extract<ServerMessage, { type: 'reply' }>> {
      const id = nextId++;
      handler?.({ id, type });
      await vi.waitFor(() =>
        expect(messages.some((m) => m.type === 'reply' && m.id === id)).toBe(true),
      );
      return messages.find((m) => m.type === 'reply' && m.id === id) as Extract<
        ServerMessage,
        { type: 'reply' }
      >;
    },
    ready: () =>
      messages.filter((m) => m.type === 'ready') as Extract<ServerMessage, { type: 'ready' }>[],
  };
}

describe('eingebetteter Server (Steuerkanal)', () => {
  let base: string;
  let options: Parameters<typeof runEmbedded>[1];
  let dataDir: string;
  const blockers: Server[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-embedded-'));
    // macOS: `/var` ist ein Symlink auf `/private/var` — der Server meldet den aufgelösten Pfad.
    dataDir = join(realpathSync(base), 'daten');
    options = {
      env: {},
      port: 0,
      dataDir,
      resourcesDir: makeResourceDir(join(base, 'res')),
      services: FAST,
    };
  });
  afterEach(() => {
    for (const blocker of blockers.splice(0)) blocker.close();
    rmSync(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function setUp(url: string, code: string): Promise<{ cookie: string; csrf: string }> {
    const reply = await fetch(`${url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupCode: code, passcode: PASSCODE }),
    });
    expect(reply.status).toBe(201);
    return {
      cookie: (reply.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '',
      csrf: String(((await reply.json()) as { csrfToken: string }).csrfToken),
    };
  }

  it('meldet ready, beantwortet Status und Einrichtungscode und gibt nichts auf der Konsole aus', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const out = vi.spyOn(process.stdout, 'write');
    const fake = fakeChannel();
    const { done } = runEmbedded(fake.channel, options);
    await vi.waitFor(() => expect(fake.ready()).toHaveLength(1));
    const ready = fake.ready()[0];
    expect(ready).toMatchObject({ type: 'ready', host: '127.0.0.1', dataDir });

    const status = await fake.ask('status');
    expect(status).toMatchObject({
      ok: true,
      value: { port: ready?.port, activeChats: 0, sessions: 0, setupPending: true },
    });
    const code = await fake.ask('setup-code');
    expect(code.ok && code.value).toMatchObject({
      code: expect.stringMatching(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/),
    });

    // Der Code steht nur im Kanal, nirgends in der Ausgabe (die Mac-App speichert keine Ausgabe des Servers).
    const secret = (
      code.ok && code.value && 'code' in code.value ? code.value.code : null
    ) as string;
    for (const spy of [log, error, out]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    }

    await setUp(`http://127.0.0.1:${ready?.port}`, secret);
    const after = await fake.ask('status');
    expect(after).toMatchObject({ ok: true, value: { sessions: 1, setupPending: false } });
    expect(await fake.ask('setup-code')).toMatchObject({ ok: true, value: { code: null } });

    const stop = await fake.ask('stop');
    expect(stop.ok).toBe(true);
    expect(fake.messages.some((m) => m.type === 'stopped')).toBe(true);
    await done;
    await expect(fetch(`http://127.0.0.1:${ready?.port}/api/health`)).rejects.toThrow();
  });

  it('meldet einen belegten Port als failed mit Erklärung und beendet sich', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as { port: number }).port));
    });
    const fake = fakeChannel();
    const { done } = runEmbedded(fake.channel, { ...options, port });
    await done;
    expect(fake.messages).toEqual([
      { type: 'failed', kind: 'port_in_use', message: expect.stringContaining(`Port ${port}`) },
    ]);
  });

  it('meldet einen zweiten Server auf denselben Daten als instance_running', async () => {
    const first = fakeChannel();
    runEmbedded(first.channel, options);
    await vi.waitFor(() => expect(first.ready()).toHaveLength(1));
    const second = fakeChannel();
    const { done } = runEmbedded(second.channel, options);
    await done;
    expect(second.messages[0]).toMatchObject({ type: 'failed', kind: 'instance_running' });
    await first.ask('stop');
  });

  it('setzt den Passcode zurück: Sitzungen weg, Daten bleiben, neuer Einrichtungscode, Server läuft wieder', async () => {
    const fake = fakeChannel();
    runEmbedded(fake.channel, options);
    await vi.waitFor(() => expect(fake.ready()).toHaveLength(1));
    const first = fake.ready()[0];
    const code = await fake.ask('setup-code');
    const secret = (code.ok && code.value && 'code' in code.value ? code.value.code : '') as string;
    const url = `http://127.0.0.1:${first?.port}`;
    const { cookie, csrf } = await setUp(url, secret);
    const created = await fetch(`${url}/api/subjects`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Beispiel-Fach' }),
    });
    expect(created.status).toBe(201);

    const reset = await fake.ask('reset-passcode');
    expect(reset).toMatchObject({ ok: true, value: null });
    await vi.waitFor(() => expect(fake.ready()).toHaveLength(2));
    const second = fake.ready()[1];
    const newUrl = `http://127.0.0.1:${second?.port}`;
    // Alte Anmeldung ist ungültig, die Einrichtung ist wieder offen.
    expect((await fetch(`${newUrl}/api/subjects`, { headers: { cookie } })).status).toBe(401);
    const again = await fake.ask('setup-code');
    const newCode = (again.ok && again.value && 'code' in again.value ? again.value.code : null) as
      | string
      | null;
    expect(newCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const fresh = await setUp(newUrl, newCode as string);
    const list = (await (
      await fetch(`${newUrl}/api/subjects`, {
        headers: { cookie: fresh.cookie, 'x-csrf-token': fresh.csrf },
      })
    ).json()) as { subjects: { name: string }[] };
    expect(list.subjects.map((s) => s.name)).toEqual(['Beispiel-Fach']);
    await fake.ask('stop');
  });

  it('ignoriert ungültige Nachrichten und lehnt Befehle ab, solange kein Server läuft', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const fake = fakeChannel();
    const { done } = runEmbedded(fake.channel, options);
    await vi.waitFor(() => expect(fake.ready()).toHaveLength(1));
    const before = fake.messages.length;
    fake.send('status');
    fake.send({ type: 'status' });
    fake.send({ id: 99, type: 'rm' });
    fake.send(null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fake.messages).toHaveLength(before);
    await fake.ask('stop');
    await done;
  });
});
