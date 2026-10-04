import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from './config';
import { DataDirError } from './data-dir';
import { InstanceLockError, LOCK_FILE } from './instance-lock';
import { PortInUseError, type RunningServer, startServer } from './server';
import { FAKE_INDEX, makeResourceDir } from './test-resources';

type Json = Record<string, unknown> & { subjects: unknown[]; id: string; csrfToken: string };

const FAST = { scryptParams: { N: 16, r: 8, p: 1 } } as const;

describe('startServer', () => {
  let base: string;
  let resourcesDir: string;
  let dataDir: string;
  const running: RunningServer[] = [];
  const blockers: Server[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-server-'));
    resourcesDir = makeResourceDir(join(base, 'fremde-ressourcen'));
    dataDir = join(base, 'daten');
  });

  afterEach(async () => {
    for (const server of running.splice(0)) await server.stop({ timeoutMs: 1_000 });
    for (const blocker of blockers.splice(0)) blocker.close();
    rmSync(base, { recursive: true, force: true });
  });

  async function start(extra: Parameters<typeof startServer>[0] = {}): Promise<RunningServer> {
    const server = await startServer({
      env: {},
      port: 0,
      dataDir,
      resourcesDir,
      services: FAST,
      ...extra,
    });
    running.push(server);
    return server;
  }

  async function json(
    url: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers }> {
    const response = await fetch(url, init);
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
    };
  }

  it('läuft mit einem fremden Ressourcenordner (Oberfläche, Version, Katalog, Standard-Prompts, Migrationen)', async () => {
    const server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.resources.root).toBe(resourcesDir);

    const health = await json(`${server.url}/api/health`);
    expect(health.body).toEqual({ status: 'ok', version: '9.9.9' });

    // Oberfläche aus dem fremden Ordner, mit absolutem Pfad (unabhängig vom Arbeitsverzeichnis).
    const page = await fetch(`${server.url}/`);
    expect(await page.text()).toBe(FAKE_INDEX);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${server.url}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    // Einseiten-App: unbekannte Pfade liefern die Startseite, unbekannte API-Pfade 404.
    expect(await (await fetch(`${server.url}/subjects/irgendwas`)).text()).toBe(FAKE_INDEX);
    expect((await fetch(`${server.url}/api/gibt-es-nicht`)).status).toBe(404);

    // Migrationen und Katalog kommen aus dem Ressourcenordner: Einrichten, Vorlagen laden, Standard-Prompt lesen.
    const code = server.setupCode();
    expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const setup = await json(`${server.url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupCode: code, passcode: 'ein erfundener Beispiel-Passcode' }),
    });
    expect(setup.status).toBe(201);
    const cookie = (setup.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
    const auth = {
      cookie,
      'x-csrf-token': String(setup.body.csrfToken),
      'content-type': 'application/json',
    };
    const templates = await json(`${server.url}/api/subjects/templates`, { headers: auth });
    expect(templates.body.subjects.length).toBeGreaterThan(50);
    const subject = await json(`${server.url}/api/subjects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Chemie', templateKey: 'chemie' }),
    });
    expect(subject.status).toBe(201);
    const prompt = await json(`${server.url}/api/prompts/subjects/${subject.body.id}`, {
      headers: auth,
    });
    expect(JSON.stringify(prompt.body).length).toBeGreaterThan(300);
    expect(existsSync(join(dataDir, 'pagewise.db'))).toBe(true);
  });

  it('gibt den Einrichtungscode nur über die Bibliothek heraus, nie über HTTP, und danach nicht mehr', async () => {
    const server = await start();
    const code = server.setupCode();
    expect(code).not.toBeNull();
    expect(server.status()).toMatchObject({ setupPending: true, sessions: 0, activeChats: 0 });
    // Kein Endpunkt liefert ihn aus (weder öffentlich noch mit dem Pfad „setup-code“).
    for (const path of [
      '/api/setup-code',
      '/api/auth/setup-code',
      '/api/auth/status',
      '/api/health',
    ]) {
      const reply = await fetch(`${server.url}${path}`);
      expect(await reply.text()).not.toContain(String(code));
    }
    const setup = await json(`${server.url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupCode: code, passcode: 'ein erfundener Beispiel-Passcode' }),
    });
    expect(setup.status).toBe(201);
    expect(server.setupCode()).toBeNull();
    expect(server.status()).toMatchObject({ setupPending: false, sessions: 1 });
  });

  it('meldet einen belegten Port klar, statt auf einen anderen auszuweichen, und räumt auf', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as { port: number }).port));
    });
    await expect(start({ port })).rejects.toBeInstanceOf(PortInUseError);
    await expect(start({ port })).rejects.toThrow(/Port \d+ auf 127\.0\.0\.1 ist belegt/);
    // Sperre freigegeben, Datenbank geschlossen: ein Start auf freiem Port gelingt sofort.
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    const server = await start();
    expect(server.port).not.toBe(port);
  });

  it('erlaubt keinen zweiten Server auf demselben Datenverzeichnis', async () => {
    const first = await start();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(true);
    await expect(start()).rejects.toBeInstanceOf(InstanceLockError);
    await expect(start()).rejects.toThrow(/läuft bereits/);
    // Der erste läuft unbeeinträchtigt weiter.
    expect((await json(`${first.url}/api/health`)).status).toBe(200);
  });

  it('beendet geordnet: Port und Sperre sind danach frei, ein zweites stop() ist harmlos', async () => {
    const first = await start();
    const { port } = first;
    await first.stop();
    await first.stop();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    await expect(fetch(`${first.url}/api/health`)).rejects.toThrow();
    // Gleiches Datenverzeichnis und gleicher Port gehen wieder.
    const again = await start({ port });
    expect(again.port).toBe(port);
    expect(again.status().setupPending).toBe(true);
  });

  it('lehnt ein Datenverzeichnis im Ressourcenordner ab (D-005 gilt für den Anwendungsordner)', async () => {
    await expect(start({ dataDir: join(resourcesDir, 'daten') })).rejects.toBeInstanceOf(
      DataDirError,
    );
    expect(existsSync(join(resourcesDir, 'daten'))).toBe(false);
  });

  it('verlangt einen absoluten Ressourcenpfad und einen gültigen Port', async () => {
    await expect(start({ resourcesDir: 'relativ' })).rejects.toBeInstanceOf(ConfigError);
    await expect(start({ port: 70000 })).rejects.toBeInstanceOf(ConfigError);
  });

  it('bindet nur an Loopback', async () => {
    await expect(start({ env: { PAGEWISE_HOST: '0.0.0.0' } })).rejects.toBeInstanceOf(ConfigError);
  });
});
