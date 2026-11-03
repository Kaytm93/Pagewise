import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxGuard } from '../sandbox/probe';
import { type LimitedResult, type LimitedSpec, runLimited } from '../sandbox/run-limited';
import type { SandboxResult } from '../sandbox/runner';
import { downloadVerified } from './download';
import type { PythonBuild } from './pins';
import { lockHash, PythonRuntime } from './runtime';
import { PythonSetup, type SetupStatus } from './setup';

const LOCK = 'beispielpaket==1.0 --hash=sha256:0000\n';
const ok: LimitedResult = {
  reason: 'exit',
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  outputTruncated: false,
  durationMs: 1,
};

let base: string;
let server: Server;
let origin: string;
let payload: Buffer;
let build: PythonBuild;
let handler: (url: string) => {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer;
  delayMs?: number;
};

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-setup-'));
  const content = join(base, 'content');
  mkdirSync(join(content, 'python', 'bin'), { recursive: true });
  writeFileSync(join(content, 'python', 'bin', 'python3'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  execFileSync('/usr/bin/tar', ['-czf', join(base, 'py.tar.gz'), '-C', content, 'python']);
  payload = readFileSync(join(base, 'py.tar.gz'));
  handler = () => ({ status: 200, body: payload });
  server = createServer((request, response) => {
    const answer = handler(request.url ?? '/');
    setTimeout(() => {
      response.writeHead(answer.status, {
        ...(answer.body ? { 'content-length': String(answer.body.length) } : {}),
        ...answer.headers,
      });
      response.end(answer.body);
    }, answer.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  build = {
    file: 'py.tar.gz',
    url: `${origin}/py.tar.gz`,
    sha256: createHash('sha256').update(payload).digest('hex'),
    size: payload.length,
  };
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(base, { recursive: true, force: true });
});

function setup(overrides: Partial<ConstructorParameters<typeof PythonSetup>[0]> = {}) {
  const dataDir = join(base, 'data');
  mkdirSync(dataDir, { recursive: true });
  const runtime = new PythonRuntime(dataDir, () => LOCK, 'darwin-arm64');
  const calls: LimitedSpec[] = [];
  const guard = {
    reset: vi.fn(),
    check: vi.fn(async () => ({ ok: true, failed: [] as string[] })),
  } as unknown as SandboxGuard;
  const sandboxRun = vi.fn(async (): Promise<SandboxResult> => ({ ...ok }));
  const instance = new PythonSetup({
    runtime,
    guard,
    platform: 'darwin-arm64',
    lock: LOCK,
    build,
    allowedHosts: ['127.0.0.1'],
    sandboxRun,
    run: async (spec) => {
      calls.push(spec);
      if (spec.command === '/usr/bin/tar') return runLimited(spec);
      if (spec.args.includes('pip')) {
        mkdirSync(join(runtime.layout.site, 'beispielpaket'), { recursive: true });
        return { ...ok };
      }
      return { ...ok };
    },
    ...overrides,
  });
  return { instance, runtime, calls, guard, sandboxRun, dataDir };
}

const finished = async (instance: PythonSetup): Promise<SetupStatus> => {
  await instance.start();
  return instance.status();
};

describe('PythonSetup', () => {
  it('richtet ein, schreibt die Marke und räumt auf', async () => {
    const { instance, runtime, calls, guard } = setup();
    const status = await finished(instance);
    expect(status).toMatchObject({ state: 'ready', error: null });
    expect(runtime.state()).toBe('ready');
    const marker = JSON.parse(readFileSync(runtime.layout.marker, 'utf8'));
    expect(marker.lockSha256).toBe(lockHash(LOCK));
    expect(existsSync(runtime.layout.tmp)).toBe(false);
    expect(existsSync(runtime.layout.home)).toBe(false);
    expect(existsSync(runtime.layout.python)).toBe(true);
    expect(guard.check).toHaveBeenCalledOnce();
    expect(runtime.info()?.readOnly).toHaveLength(2);
    const pip = calls.find((call) => call.args.includes('pip'));
    expect(pip?.args).toEqual(
      expect.arrayContaining(['--require-hashes', '--only-binary=:all:', '--no-deps', '--target']),
    );
  });

  it('gibt pip nichts aus der Umgebung des Servers mit', async () => {
    process.env.PAGEWISE_TEST_GEHEIM = 'sk-nicht-weitergeben';
    try {
      const { instance, calls } = setup();
      await finished(instance);
      for (const call of calls) {
        expect(Object.keys(call.env)).not.toContain('PAGEWISE_TEST_GEHEIM');
        expect(call.env.HOME).not.toBe(process.env.HOME);
      }
      const pip = calls.find((call) => call.args.includes('pip'));
      expect(pip?.env.PIP_CONFIG_FILE).toBe('/dev/null');
    } finally {
      delete process.env.PAGEWISE_TEST_GEHEIM;
    }
  });

  it('lehnt eine Datei mit falscher Prüfsumme ab und hinterlässt nichts', async () => {
    const { instance, runtime } = setup({ build: { ...build, sha256: '0'.repeat(64) } });
    expect(await finished(instance)).toMatchObject({ state: 'error', error: 'checksum_mismatch' });
    expect(runtime.state()).toBe('missing');
    expect(existsSync(runtime.layout.python)).toBe(false);
  });

  it('lädt nur von erlaubten Hosts', async () => {
    const { instance } = setup({ allowedHosts: ['github.com'] });
    expect(await finished(instance)).toMatchObject({ error: 'host_not_allowed' });
  });

  it('folgt Weiterleitungen nicht zu fremden Hosts', async () => {
    handler = () => ({ status: 302, headers: { location: 'https://fremd.example/py.tar.gz' } });
    const { instance } = setup();
    expect(await finished(instance)).toMatchObject({ error: 'host_not_allowed' });
  });

  it('folgt Weiterleitungen zu erlaubten Hosts', async () => {
    let hits = 0;
    handler = (url) => {
      hits += 1;
      return url === '/py.tar.gz'
        ? { status: 302, headers: { location: '/zweit.tar.gz' } }
        : { status: 200, body: payload };
    };
    const { instance } = setup();
    expect(await finished(instance)).toMatchObject({ state: 'ready' });
    expect(hits).toBe(2);
  });

  it('bricht ab, wenn die Datei größer ist als erwartet', async () => {
    handler = () => ({ status: 200, body: Buffer.alloc(build.size + 2 * 1024 * 1024, 1) });
    const { instance } = setup();
    expect(await finished(instance)).toMatchObject({ error: 'too_large' });
  });

  it('meldet fehlgeschlagene Paketinstallation nur als Code', async () => {
    const { instance } = setup({
      run: async (spec) => {
        if (spec.command === '/usr/bin/tar') return runLimited(spec);
        return { ...ok, code: 1, stderr: 'SECRET-AUSGABE von pip' };
      },
    });
    const status = await finished(instance);
    expect(status).toMatchObject({ state: 'error', error: 'packages_failed' });
    expect(JSON.stringify(status)).not.toContain('SECRET');
  });

  it('richtet nichts ein, wenn die Sandbox nicht sperrt', async () => {
    const guard = { reset: vi.fn(), check: vi.fn(async () => ({ ok: false, failed: ['net'] })) };
    const { instance, runtime } = setup({ guard: guard as unknown as SandboxGuard });
    expect(await finished(instance)).toMatchObject({ error: 'sandbox_failed' });
    expect(runtime.state()).toBe('missing');
  });

  it('meldet einen Importfehler als check_failed', async () => {
    const { instance } = setup({ sandboxRun: async () => ({ ...ok, code: 1 }) as SandboxResult });
    expect(await finished(instance)).toMatchObject({ error: 'check_failed' });
  });

  it('braucht Lock und unterstützte Plattform', async () => {
    expect(await finished(setup({ lock: null }).instance)).toMatchObject({ error: 'no_lock' });
    expect(await finished(setup({ platform: null }).instance)).toMatchObject({
      error: 'unsupported_platform',
    });
  });

  it('lässt sich abbrechen', async () => {
    handler = () => ({ status: 200, body: payload, delayMs: 2_000 });
    const { instance } = setup();
    const pending = instance.start();
    setTimeout(() => instance.cancel(), 100);
    await pending;
    expect(instance.status()).toMatchObject({ state: 'error', error: 'cancelled' });
  });

  it('startet nicht zweimal gleichzeitig', async () => {
    const { instance } = setup();
    expect(instance.start()).toBe(instance.start());
    await instance.start();
  });

  it('erkennt einen veralteten Lock', async () => {
    const { instance, runtime, dataDir } = setup();
    await finished(instance);
    const newer = new PythonRuntime(
      dataDir,
      () => `${LOCK}anderes==2.0 --hash=sha256:1111\n`,
      'darwin-arm64',
    );
    expect(runtime.state()).toBe('ready');
    expect(newer.state()).toBe('outdated');
    expect(newer.info()).toBeNull();
  });

  it('entfernt alles auf Wunsch', async () => {
    const { instance, runtime } = setup();
    await finished(instance);
    await instance.remove();
    expect(existsSync(runtime.layout.root)).toBe(false);
    expect(instance.status().state).toBe('idle');
  });
});

describe('downloadVerified', () => {
  it('lehnt http zu fremden Hosts und unsinnige Adressen ab', async () => {
    const options = {
      sha256: '0',
      maxBytes: 10,
      dest: join(base, 'x'),
      allowedHosts: ['example.com'],
    };
    await expect(
      downloadVerified({ ...options, url: 'http://example.com/x' }),
    ).rejects.toMatchObject({ code: 'bad_url' });
    await expect(downloadVerified({ ...options, url: 'kein url' })).rejects.toMatchObject({
      code: 'bad_url',
    });
    await expect(downloadVerified({ ...options, url: 'file:///etc/passwd' })).rejects.toMatchObject(
      { code: 'bad_url' },
    );
  });
});
