import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuildInfo } from './build-info';
import {
  builtAppPath,
  cleanSubject,
  type PrepareHooks,
  type StepId,
  UpdateError,
  UpdateService,
  type UpdateServiceDeps,
  updatePaths,
} from './service';
import { fakeRunner, MemoryFs, type RecordedCall, type Script, SHA_A, SHA_B } from './test-support';

const HOME = '/Users/beispiel';
const GIT = '/usr/bin/git';
const NODE = `${HOME}/.nvm/versions/node/v22.1.0/bin/node`;
const PNPM = `${HOME}/.nvm/versions/node/v22.1.0/lib/node_modules/pnpm/bin/pnpm.cjs`;
const URL_ = 'https://example.org/Pagewise.git';
const ROOT = `${HOME}/Library/Caches/pagewise-update`;
const PATHS = updatePaths(ROOT);
const BUNDLE = `${HOME}/Applications/Pagewise.app`;
const EXEC = `${BUNDLE}/Contents/MacOS/Pagewise`;
const BUILT = builtAppPath(PATHS.repo, 'arm64');

const INFO: BuildInfo = {
  commit: SHA_A,
  commitDate: '2026-10-01T12:00:00Z',
  builtAt: '2026-10-01T12:05:00Z',
  dirty: false,
  arch: 'arm64',
  toolchain: { node: NODE, pnpm: PNPM, path: [`${HOME}/.nvm/versions/node/v22.1.0/bin`] },
};

function setup(
  options: {
    script?: Script;
    info?: BuildInfo;
    deps?: Partial<UpdateServiceDeps>;
    source?: NodeJS.ProcessEnv;
  } = {},
) {
  const fs = new MemoryFs();
  fs.addExecutable(GIT).addExecutable(NODE).addFile(PNPM).addDir(BUNDLE);
  const { runner, calls } = fakeRunner((call) => options.script?.(call));
  const service = new UpdateService({
    runner,
    fs,
    source: options.source ?? { HOME },
    home: HOME,
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    execPath: EXEC,
    buildInfo: options.info ?? INFO,
    paths: PATHS,
    repoUrl: URL_,
    branch: 'main',
    now: () => new Date('2026-10-17T10:00:00Z'),
    ...options.deps,
  });
  return { service, fs, calls };
}

const gitCalls = (calls: RecordedCall[], verb: string) =>
  calls.filter((call) => call.command === GIT && call.args[0] === verb);

/** Drehbuch eines gelungenen Vorbereitens. `fs` bekommt, was die echten Programme anlegen würden. */
function happyScript(fs: () => MemoryFs, overrides: Script = () => undefined): Script {
  return (call) => {
    const override = overrides(call);
    if (override) return override;
    const { command, args } = call;
    if (command === GIT) {
      if (args[0] === 'clone') fs().addDir(join(PATHS.repo, '.git'));
      if (args[0] === 'rev-parse') return { tail: [SHA_B] };
      if (args[0] === 'config') return { tail: [URL_] };
      return undefined;
    }
    if (args.includes('app:mac')) {
      fs()
        .addDir(BUILT)
        .addFile(
          join(BUILT, 'Contents', 'Resources', 'build-info.json'),
          JSON.stringify({ ...INFO, commit: SHA_B }),
        );
      return undefined;
    }
    if (args[0] === '--smoke-test') return { tail: ['Rauchtest bestanden'] };
    return undefined;
  };
}

function hooks(): {
  hooks: PrepareHooks;
  steps: StepId[];
  lines: string[];
  abort: AbortController;
} {
  const steps: StepId[] = [];
  const lines: string[] = [];
  const abort = new AbortController();
  return {
    hooks: { signal: abort.signal, step: (id) => steps.push(id), line: (text) => lines.push(text) },
    steps,
    lines,
    abort,
  };
}

describe('Update: Unterstützung', () => {
  it('geht nur für eine gepackte App auf dem Mac in einem beschreibbaren Ordner', () => {
    expect(setup().service.support()).toEqual({ ok: true, bundle: BUNDLE });
    expect(setup({ deps: { platform: 'linux' } }).service.support()).toEqual({
      ok: false,
      reason: 'platform',
    });
    expect(setup({ deps: { isPackaged: false } }).service.support()).toEqual({
      ok: false,
      reason: 'dev',
    });
    expect(
      setup({ deps: { execPath: '/Users/beispiel/electron/dist/Electron' } }).service.support(),
    ).toEqual({ ok: false, reason: 'bundle' });
    expect(
      setup({
        deps: {
          execPath:
            '/private/var/folders/x/AppTranslocation/Y/d/Pagewise.app/Contents/MacOS/Pagewise',
        },
      }).service.support(),
    ).toEqual({ ok: false, reason: 'translocated' });
  });

  it('meldet einen Ordner ohne Schreibrechte', () => {
    const { service, fs } = setup();
    fs.unwritable.add(`${HOME}/Applications`);
    expect(service.support()).toEqual({ ok: false, reason: 'not-writable' });
    const second = setup();
    second.fs.unwritable.add(BUNDLE);
    expect(second.service.support()).toEqual({ ok: false, reason: 'not-writable' });
  });
});

describe('Update: Nachsehen', () => {
  const remote =
    (sha: string): Script =>
    (call) =>
      call.args[0] === 'ls-remote' ? { tail: [`${sha}\trefs/heads/main`] } : undefined;

  it('fragt nur per ls-remote nach und erkennt „aktuell“', async () => {
    const { service, calls } = setup({ script: remote(SHA_A) });
    const result = await service.check();
    expect(result).toMatchObject({ remote: SHA_A, upToDate: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(GIT);
    expect(calls[0]?.args).toEqual(['ls-remote', '--exit-code', URL_, 'refs/heads/main']);
  });

  it('erkennt eine neuere Fassung, ohne zu laden, solange es keinen Arbeitsordner gibt', async () => {
    const { service, calls } = setup({ script: remote(SHA_B) });
    const result = await service.check();
    expect(result).toMatchObject({
      remote: SHA_B,
      upToDate: false,
      changes: [],
      changeCount: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('listet die Änderungen, wenn ein Arbeitsordner da ist', async () => {
    const { service, fs, calls } = setup({
      script: (call) => {
        if (call.args[0] === 'ls-remote') return { tail: [`${SHA_B}\trefs/heads/main`] };
        if (call.args[0] === 'rev-list') return { tail: ['3'] };
        if (call.args[0] === 'log')
          return { tail: ['fix: Eins', 'feat: Zwei\u0007', 'docs: Drei'] };
        if (call.args[0] === 'show') return { tail: ['2026-10-16T09:00:00+02:00'] };
        return undefined;
      },
    });
    fs.addDir(join(PATHS.repo, '.git'));
    const result = await service.check();
    expect(result).toEqual({
      remote: SHA_B,
      upToDate: false,
      changes: ['fix: Eins', 'feat: Zwei', 'docs: Drei'],
      changeCount: 3,
      remoteDate: '2026-10-16T09:00:00+02:00',
    });
    expect(gitCalls(calls, 'fetch')).toHaveLength(1);
    expect(gitCalls(calls, 'rev-list')[0]?.args).toEqual([
      'rev-list',
      '--count',
      `${SHA_A}..${SHA_B}`,
    ]);
  });

  it('hält die installierte Fassung für aktuell, wenn sie schon alles aus main enthält', async () => {
    const { service, fs } = setup({
      script: (call) => {
        if (call.args[0] === 'ls-remote') return { tail: [`${SHA_B}\trefs/heads/main`] };
        if (call.args[0] === 'rev-list') return { tail: ['0'] };
        return undefined;
      },
    });
    fs.addDir(join(PATHS.repo, '.git'));
    expect(await service.check()).toMatchObject({ upToDate: true, changeCount: 0 });
  });

  it('unterscheidet Netzfehler von anderen Fehlern und fehlendem git', async () => {
    const network = setup({
      script: () => ({
        code: 128,
        tail: ['fatal: unable to access: Could not resolve host: github.com'],
      }),
    });
    await expect(network.service.check()).rejects.toMatchObject({ code: 'network' });
    const timeout = setup({ script: () => ({ code: null, timedOut: true }) });
    await expect(timeout.service.check()).rejects.toMatchObject({ code: 'network' });
    const other = setup({ script: () => ({ code: 128, tail: ['fatal: etwas anderes'] }) });
    await expect(other.service.check()).rejects.toMatchObject({ code: 'git-failed' });
    const noRef = setup({ script: () => ({ code: 2 }) });
    await expect(noRef.service.check()).rejects.toBeInstanceOf(UpdateError);
    const noGit = setup();
    noGit.fs.executables.delete(GIT);
    await expect(noGit.service.check()).rejects.toMatchObject({ code: 'no-git' });
  });

  it('übernimmt keine Steuerzeichen und keine überlangen Zeilen aus Commit-Texten', () => {
    expect(cleanSubject('a\u001b[31mb\u0000c')).toBe('a [31mb c');
    expect(cleanSubject('x'.repeat(500)).length).toBeLessThan(170);
  });
});

describe('Update: Vorbereiten', () => {
  it('holt, installiert, baut und prüft in dieser Reihenfolge und legt ready.json an', async () => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({ script: happyScript(() => holder.fs as MemoryFs) });
    holder.fs = ctx.fs;
    const h = hooks();
    const ready = await ctx.service.prepare(h.hooks);

    expect(ready).toEqual({
      commit: SHA_B,
      commitDate: INFO.commitDate,
      appPath: BUILT,
      builtAt: '2026-10-17T10:00:00.000Z',
    });
    expect(h.steps).toEqual(['fetch', 'install', 'build', 'verify']);
    expect(ctx.calls.map((c) => `${c.command.split('/').at(-1)} ${c.args.join(' ')}`)).toEqual([
      `git clone --single-branch --branch main --no-tags ${URL_} ${PATHS.repo}`,
      'git fetch --no-tags origin main',
      'git rev-parse FETCH_HEAD',
      `git checkout --force --detach ${SHA_B}`,
      'git clean -fd',
      `node ${PNPM} install --frozen-lockfile`,
      `node ${PNPM} app:mac --no-install --arch arm64`,
      `codesign --verify --deep --strict ${BUILT}`,
      'Pagewise --smoke-test',
    ]);
    expect(JSON.parse(ctx.fs.files.get(PATHS.ready) ?? '{}')).toMatchObject({ commit: SHA_B });
    expect(ctx.fs.files.get(PATHS.log)).toContain('Update bereit.');
  });

  it('nutzt einen vorhandenen Arbeitsordner und baut nur aus der geholten Fassung', async () => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({ script: happyScript(() => holder.fs as MemoryFs) });
    holder.fs = ctx.fs;
    ctx.fs.addDir(join(PATHS.repo, '.git'));
    await ctx.service.prepare(hooks().hooks);
    expect(gitCalls(ctx.calls, 'clone')).toHaveLength(0);
    expect(gitCalls(ctx.calls, 'fetch')).toHaveLength(1);
    // Alte Bauergebnisse werden vor dem Bauen entfernt.
    expect(ctx.fs.removed).toContain(join(PATHS.repo, 'apps', 'desktop', 'out'));
  });

  it('legt den Arbeitsordner neu an, wenn er woandershin zeigt', async () => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({
      script: happyScript(
        () => holder.fs as MemoryFs,
        (call) =>
          call.args[0] === 'config' ? { tail: ['https://example.org/anderes.git'] } : undefined,
      ),
    });
    holder.fs = ctx.fs;
    ctx.fs.addDir(join(PATHS.repo, '.git'));
    await ctx.service.prepare(hooks().hooks);
    expect(ctx.fs.removed).toContain(PATHS.repo);
    expect(gitCalls(ctx.calls, 'clone')).toHaveLength(1);
  });

  it('gibt dem Programm nur eine knappe Umgebung ohne Schlüssel und mit dem Werkzeug-PATH', async () => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({
      script: happyScript(() => holder.fs as MemoryFs),
      source: {
        HOME,
        HTTPS_PROXY: 'http://proxy.example.org:8080',
        ANTHROPIC_API_KEY: 'geheim',
        GITHUB_TOKEN: 'geheim',
        NODE_OPTIONS: '--require /boese.js',
        DYLD_INSERT_LIBRARIES: '/boese.dylib',
      },
    });
    holder.fs = ctx.fs;
    await ctx.service.prepare(hooks().hooks);
    for (const call of ctx.calls) {
      const env = call.options.env;
      expect(Object.keys(env).filter((k) => /KEY|TOKEN|SECRET|NODE_OPTIONS|DYLD/.test(k))).toEqual(
        [],
      );
    }
    const pnpm = ctx.calls.find((c) => c.args.includes('app:mac'));
    expect(pnpm?.options.env.HTTPS_PROXY).toBe('http://proxy.example.org:8080');
    expect(pnpm?.options.env.CI).toBe('true');
    expect(pnpm?.options.env.PATH?.split(':')[0]).toBe(`${HOME}/.nvm/versions/node/v22.1.0/bin`);
    expect(pnpm?.options.cwd).toBe(PATHS.repo);
    // Der Rauchtest bekommt noch weniger.
    const smoke = ctx.calls.find((c) => c.args[0] === '--smoke-test');
    expect(Object.keys(smoke?.options.env ?? {}).sort()).toEqual(['HOME', 'PATH']);
  });

  it('versucht die Installation einmal mit frischem node_modules, bevor sie scheitert', async () => {
    const holder: { fs?: MemoryFs } = {};
    let installs = 0;
    const ctx = setup({
      script: happyScript(
        () => holder.fs as MemoryFs,
        (call) => {
          if (call.args.includes('install')) {
            installs += 1;
            return installs === 1
              ? { code: 1, tail: ['ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY'] }
              : undefined;
          }
          return undefined;
        },
      ),
    });
    holder.fs = ctx.fs;
    await ctx.service.prepare(hooks().hooks);
    expect(installs).toBe(2);
    expect(ctx.fs.removed).toContain(join(PATHS.repo, 'node_modules'));
  });

  it.each([
    [
      'install-failed',
      (call: RecordedCall) =>
        call.args.includes('install') ? { code: 1, tail: ['kaputt'] } : undefined,
    ],
    [
      'build-failed',
      (call: RecordedCall) =>
        call.args.includes('app:mac') ? { code: 1, tail: ['Fehler beim Bauen'] } : undefined,
    ],
    [
      'verify-failed',
      (call: RecordedCall) => (call.command === '/usr/bin/codesign' ? { code: 1 } : undefined),
    ],
    [
      'smoke-failed',
      (call: RecordedCall) =>
        call.args[0] === '--smoke-test'
          ? { code: 1, tail: ['Rauchtest fehlgeschlagen: x'] }
          : undefined,
    ],
    [
      'network',
      (call: RecordedCall) =>
        call.args[0] === 'fetch'
          ? { code: 128, tail: ['fatal: Could not resolve host'] }
          : undefined,
    ],
    ['git-failed', (call: RecordedCall) => (call.args[0] === 'checkout' ? { code: 1 } : undefined)],
  ] as const)('meldet %s und legt nichts als „bereit“ ab', async (code, fail) => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({ script: happyScript(() => holder.fs as MemoryFs, fail) });
    holder.fs = ctx.fs;
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({ code });
    expect(ctx.fs.files.has(PATHS.ready)).toBe(false);
    // Die laufende App wurde nie angefasst.
    expect(ctx.fs.removed.filter((p) => p.startsWith(BUNDLE))).toEqual([]);
  });

  it('lehnt eine gebaute App ab, die nicht aus der geholten Fassung stammt', async () => {
    const holder: { fs?: MemoryFs } = {};
    const ctx = setup({
      script: happyScript(
        () => holder.fs as MemoryFs,
        (call) => {
          if (call.args.includes('app:mac')) {
            holder.fs
              ?.addDir(BUILT)
              .addFile(
                join(BUILT, 'Contents', 'Resources', 'build-info.json'),
                JSON.stringify({ ...INFO, commit: SHA_A }),
              );
            return { tail: [] };
          }
          return undefined;
        },
      ),
    });
    holder.fs = ctx.fs;
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({
      code: 'verify-failed',
    });
  });

  it('bricht bei zu wenig Speicher vor dem ersten Befehl ab', async () => {
    const ctx = setup();
    ctx.fs.free = 500 * 1024 ** 2;
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({ code: 'disk-space' });
    expect(ctx.calls).toHaveLength(0);
  });

  it('meldet fehlende Werkzeuge klar und startet nichts', async () => {
    const ctx = setup({ info: { ...INFO, toolchain: null } });
    ctx.fs.executables.delete(NODE);
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({ code: 'no-tools' });
    expect(ctx.calls).toHaveLength(0);
  });

  it('verweigert sich in einer Entwicklungsfassung', async () => {
    const ctx = setup({ deps: { isPackaged: false } });
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({ code: 'unsupported' });
    expect(ctx.calls).toHaveLength(0);
  });

  it('bricht ab, wenn die Aufgabe abgebrochen wird', async () => {
    const ctx = setup({ script: () => ({ aborted: true, code: null }) });
    await expect(ctx.service.prepare(hooks().hooks)).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('Update: bereitliegende Fassung und Übergabe', () => {
  const writeReady = (fs: MemoryFs, overrides: object = {}) =>
    fs.addFile(
      PATHS.ready,
      JSON.stringify({
        commit: SHA_B,
        commitDate: null,
        appPath: BUILT,
        builtAt: 'x',
        ...overrides,
      }),
    );

  it('findet eine bereitgelegte Fassung wieder, solange die App noch da ist', () => {
    const { service, fs } = setup();
    expect(service.loadReady()).toBeNull();
    writeReady(fs);
    expect(service.loadReady()).toBeNull(); // App fehlt
    fs.addDir(BUILT);
    expect(service.loadReady()?.commit).toBe(SHA_B);
    expect(service.loadReady(SHA_B)?.commit).toBe(SHA_B);
    expect(service.loadReady(SHA_A)).toBeNull();
  });

  it('räumt die Marke weg, wenn diese Fassung schon installiert ist', () => {
    const { service, fs } = setup({ info: { ...INFO, commit: SHA_B } });
    fs.addDir(BUILT);
    writeReady(fs);
    expect(service.loadReady()).toBeNull();
    expect(fs.files.has(PATHS.ready)).toBe(false);
  });

  it('vertraut keinem fremden Pfad und keinem kaputten Inhalt', () => {
    const { service, fs } = setup();
    fs.addDir('/tmp/boese.app');
    writeReady(fs, { appPath: '/tmp/boese.app' });
    expect(service.loadReady()).toBeNull();
    writeReady(fs, { commit: 'zzz' });
    expect(service.loadReady()).toBeNull();
    fs.addFile(PATHS.ready, 'kein json');
    expect(service.loadReady()).toBeNull();
  });

  it('baut den Befehl für den Helfer aus festen Teilen', () => {
    const { service, fs } = setup();
    fs.addDir(BUILT).addFile(join(PATHS.repo, 'scripts', 'apply-update.mjs'));
    const spec = service.handoff(
      { commit: SHA_B, commitDate: null, appPath: BUILT, builtAt: '' },
      4242,
    );
    expect(spec.command).toBe(NODE);
    expect(spec.args).toEqual([
      join(PATHS.repo, 'scripts', 'apply-update.mjs'),
      '--pid',
      '4242',
      '--built',
      BUILT,
      '--dest',
      BUNDLE,
      '--backup',
      PATHS.backup,
      '--result',
      PATHS.result,
    ]);
    expect(Object.keys(spec.env).sort()).toEqual(['HOME', 'PATH']);
  });

  it('übergibt nichts, wenn Helfer oder App fehlen oder die App sich nicht ersetzen kann', () => {
    const { service, fs } = setup();
    const ready = { commit: SHA_B, commitDate: null, appPath: BUILT, builtAt: '' };
    expect(() => service.handoff(ready, 1)).toThrowError(UpdateError);
    fs.addDir(BUILT).addFile(join(PATHS.repo, 'scripts', 'apply-update.mjs'));
    fs.unwritable.add(BUNDLE);
    expect(() => service.handoff(ready, 1)).toThrowError(UpdateError);
  });

  it('liest und löscht das Ergebnis des Helfers', () => {
    const { service, fs } = setup();
    expect(service.readResult()).toBeNull();
    fs.addFile(PATHS.result, JSON.stringify({ ok: true, message: 'Aktualisiert.', at: 'jetzt' }));
    expect(service.readResult()).toEqual({ ok: true, message: 'Aktualisiert.', at: 'jetzt' });
    service.clearResult();
    expect(service.readResult()).toBeNull();
    fs.addFile(PATHS.result, '{"ok":"ja"}');
    expect(service.readResult()).toBeNull();
  });
});
