import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleServer } from '../scripts/bundle';
import { LOCK_FILE } from './instance-lock';
import { FAKE_INDEX } from './test-resources';

// Das Bundle ist die Form, in der die Mac-App den Server mitliefert (utilityProcess, ohne node_modules und ohne
// Repo-Aufbau). Der Test baut es in einen fremden Ordner und startet es dort, wie es auch auf dem Mac läuft.

const PASSCODE = 'ein erfundener Beispiel-Passcode';
const SETUP_CODE = /Einrichtungscode: ([A-Z0-9]{5}-[A-Z0-9]{5})/;

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function launch(bundleDir: string, cwd: string, env: Record<string, string>): Started {
  // Nur eine Allowlist als Umgebung, wie in der Mac-App: nichts aus der Umgebung des Tests.
  const child = spawn(process.execPath, [join(bundleDir, 'pagewise-server.mjs')], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    text += chunk;
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    text += chunk;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => resolve(code)),
  );
  return { child, output: () => text, exited };
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  ms = 15_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Zeitüberschreitung: ${what}`);
}

describe('gebündelter Server (läuft aus einem fremden Ordner)', () => {
  let base: string;
  let bundleDir: string;
  let foreignCwd: string;
  const started: Started[] = [];

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-bundle-'));
    const web = join(base, 'oberflaeche');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), FAKE_INDEX);
    writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log("beispiel");\n');
    bundleDir = join(base, 'Pagewise-Server');
    await bundleServer({ outDir: bundleDir, webDist: web });
    foreignCwd = join(base, 'irgendwo-anders');
    mkdirSync(foreignCwd);
  }, 60_000);

  afterAll(async () => {
    for (const run of started) {
      run.child.kill('SIGKILL');
      await run.exited;
    }
    rmSync(base, { recursive: true, force: true });
  });

  async function run(
    dataDir: string,
    port: number,
    extra: Record<string, string> = {},
  ): Promise<Started> {
    const server = launch(bundleDir, foreignCwd, {
      PAGEWISE_DATA_DIR: dataDir,
      PAGEWISE_PORT: String(port),
      ...extra,
    });
    started.push(server);
    return server;
  }

  it('enthält alles Nötige: Bundle, Binärdatei von better-sqlite3, Migrationen, Katalog, Prompts, Oberfläche', () => {
    for (const path of [
      'pagewise-server.mjs',
      'pagewise-embedded.mjs',
      'better_sqlite3.node',
      'package.json',
      'drizzle/meta/_journal.json',
      'config/subject-catalog.json',
      'prompts/defaults/standard.md',
      'web/index.html',
    ]) {
      expect(existsSync(join(bundleDir, path)), path).toBe(true);
    }
    // Das Bundle braucht kein node_modules und keinen Quelltext des Repos.
    const code = readFileSync(join(bundleDir, 'pagewise-server.mjs'), 'utf8');
    expect(code).not.toMatch(/from ['"]better-sqlite3['"]/);
    expect(existsSync(join(bundleDir, 'node_modules'))).toBe(false);
  });

  it('startet, beantwortet /api/health und besteht den Ablauf Einrichtung, Anmeldung, Vorlagen, Fach, Standard-Prompt', async () => {
    const dataDir = join(base, 'daten-1');
    const port = await freePort();
    const server = await run(dataDir, port);
    const url = `http://127.0.0.1:${port}`;
    await waitFor(() => SETUP_CODE.test(server.output()), 'Start');

    const health = await bodyOf<unknown>(await fetch(`${url}/api/health`));
    expect(health).toEqual({
      status: 'ok',
      version: JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8')).version,
    });
    expect(await (await fetch(`${url}/`)).text()).toBe(FAKE_INDEX);
    const asset = await fetch(`${url}/assets/app-abc123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${url}/api/nichts`)).status).toBe(404);

    const code = SETUP_CODE.exec(server.output())?.[1];
    const setup = await fetch(`${url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupCode: code, passcode: PASSCODE }),
    });
    expect(setup.status).toBe(201);
    const csrf = String((await bodyOf<{ csrfToken: string }>(setup)).csrfToken);
    const cookie = (setup.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
    const auth = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };

    const templates = await bodyOf<{ subjects: unknown[] }>(
      await fetch(`${url}/api/subjects/templates`, { headers: auth }),
    );
    expect(templates.subjects.length).toBeGreaterThan(50);
    const subject = await fetch(`${url}/api/subjects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Chemie', templateKey: 'chemie' }),
    });
    expect(subject.status).toBe(201);
    const { id } = await bodyOf<{ id: string }>(subject);
    const prompt = await fetch(`${url}/api/prompts/subjects/${id}`, { headers: auth });
    expect(JSON.stringify(await bodyOf<unknown>(prompt)).length).toBeGreaterThan(300);

    // Ohne Anmeldung gibt es nichts, auch nicht im gebündelten Server.
    expect((await fetch(`${url}/api/subjects`)).status).toBe(401);
    expect(existsSync(join(dataDir, 'pagewise.db'))).toBe(true);
    // Der Einrichtungscode steht nach der Einrichtung in keiner Datei des Datenverzeichnisses.
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(true);
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).not.toContain(String(code));

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    // Geordnetes Beenden: Sperre weg.
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  }, 60_000);

  it('weist einen zweiten Start auf denselben Daten und einen belegten Port mit klarer Meldung ab', async () => {
    const dataDir = join(base, 'daten-2');
    const port = await freePort();
    const first = await run(dataDir, port);
    await waitFor(() => SETUP_CODE.test(first.output()), 'Start');

    const sameData = await run(dataDir, await freePort());
    expect(await sameData.exited).toBe(1);
    expect(sameData.output()).toContain('Pagewise startet nicht.');
    expect(sameData.output()).toContain('läuft bereits');

    const samePort = await run(join(base, 'daten-3'), port);
    expect(await samePort.exited).toBe(1);
    expect(samePort.output()).toMatch(/Port \d+ auf 127\.0\.0\.1 ist belegt/);

    first.child.kill('SIGTERM');
    expect(await first.exited).toBe(0);
  }, 60_000);

  it('nimmt PAGEWISE_RESOURCES_DIR vor dem Ordner des Bundles', async () => {
    const other = join(base, 'andere-ressourcen');
    mkdirSync(other);
    const dataDir = join(base, 'daten-4');
    const port = await freePort();
    // Ein leerer Ressourcenordner hat keine Migrationen: der Start scheitert, statt still den Ordner des Bundles zu nehmen.
    const server = await run(dataDir, port, { PAGEWISE_RESOURCES_DIR: other });
    expect(await server.exited).toBe(1);
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  }, 60_000);
});
