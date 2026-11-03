import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SandboxGuard } from '../sandbox/probe';
import { type LimitedSpec, runLimited } from '../sandbox/run-limited';
import { runSandboxed } from '../sandbox/runner';
import { downloadVerified, SetupError } from './download';
import { buildCodeEnv, seedMatplotlibCache } from './env';
import { CHECK_IMPORTS } from './lock';
import {
  DOWNLOAD_HOSTS,
  PBS_RELEASE,
  type PlatformKey,
  PYTHON_BUILDS,
  PYTHON_VERSION,
  type PythonBuild,
} from './pins';
import { lockHash, type PythonRuntime, type ReadyMarker } from './runtime';

/**
 * Richtet das private Python ein (D-079), nur auf Klick der Person:
 *
 * 1. Python-Build laden (feste Adresse, Prüfsumme, nur GitHub-Hosts) und entpacken,
 * 2. Pakete aus dem Lock installieren (`--require-hashes --only-binary=:all: --no-deps --target`),
 * 3. in der Sandbox prüfen: Sperren greifen, alle Module lassen sich importieren.
 *
 * Es ändert nichts am System und nichts außerhalb von `<Datenverzeichnis>/python`. Programme laufen ohne Shell
 * mit eigener Umgebung (kein `process.env`, keine Schlüssel, keine Proxy-Einstellungen). Fehler gehen nur als Code
 * nach außen; die Ausgabe von `pip` und `tar` bleibt im Speicher und wird weder geloggt noch angezeigt.
 */

export type SetupPhase = 'download' | 'extract' | 'packages' | 'check';

export interface SetupStatus {
  state: 'idle' | 'running' | 'ready' | 'error';
  phase: SetupPhase | null;
  /** 0 bis 1, `null` wenn der Fortschritt nicht bekannt ist. */
  progress: number | null;
  /** Fehlercode der letzten Einrichtung. */
  error: string | null;
}

export interface SetupOptions {
  runtime: PythonRuntime;
  guard: SandboxGuard;
  platform: PlatformKey | null;
  lock: string | null;
  build?: PythonBuild;
  allowedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Ersatz für die feste Programmliste, nur in Tests. */
  run?: (spec: LimitedSpec) => ReturnType<typeof runLimited>;
  sandboxRun?: typeof runSandboxed;
  timeZone?: string | undefined;
}

const TOOL_ENV = (home: string, tmp: string): Record<string, string> => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: tmp,
  LANG: 'en_US.UTF-8',
  PIP_CONFIG_FILE: '/dev/null',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_NO_INPUT: '1',
  PIP_NO_CACHE_DIR: '1',
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONNOUSERSITE: '1',
});

export class PythonSetup {
  private current: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private snapshot: SetupStatus = { state: 'idle', phase: null, progress: null, error: null };

  constructor(private readonly options: SetupOptions) {}

  status(): SetupStatus {
    if (this.snapshot.state === 'running') return { ...this.snapshot };
    if (this.options.runtime.state() === 'ready')
      return { state: 'ready', phase: null, progress: null, error: null };
    return { ...this.snapshot, state: this.snapshot.state === 'error' ? 'error' : 'idle' };
  }

  /** Startet die Einrichtung. Läuft schon eine, passiert nichts. Das Ergebnis zeigt `status()`. */
  start(): Promise<void> {
    if (this.current) return this.current;
    this.controller = new AbortController();
    this.snapshot = { state: 'running', phase: 'download', progress: 0, error: null };
    this.current = this.execute(this.controller.signal)
      .then(() => {
        this.snapshot = { state: 'ready', phase: null, progress: null, error: null };
      })
      .catch((error: unknown) => {
        const code = error instanceof SetupError ? error.code : 'setup_failed';
        this.snapshot = { state: 'error', phase: null, progress: null, error: code };
      })
      .finally(() => {
        this.current = null;
        this.controller = null;
      });
    return this.current;
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Entfernt das Python und alle Pakete. Eine laufende Einrichtung wird vorher abgebrochen. */
  async remove(): Promise<void> {
    this.cancel();
    await this.current;
    rmSync(this.options.runtime.layout.root, { recursive: true, force: true });
    this.options.guard.reset();
    this.snapshot = { state: 'idle', phase: null, progress: null, error: null };
  }

  private phase(phase: SetupPhase, progress: number | null): void {
    this.snapshot = { state: 'running', phase, progress, error: null };
  }

  private async execute(signal: AbortSignal): Promise<void> {
    const { platform, lock } = this.options;
    if (!platform) throw new SetupError('unsupported_platform');
    if (!lock) throw new SetupError('no_lock');
    const build = this.options.build ?? PYTHON_BUILDS[platform];
    const layout = this.options.runtime.layout;
    const run = this.options.run ?? runLimited;
    const toolEnv = TOOL_ENV(layout.home, layout.tmp);

    rmSync(layout.root, { recursive: true, force: true });
    for (const dir of [layout.root, layout.home, layout.tmp, layout.site, layout.mpl]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // 1. Download und Entpacken
    const archive = join(layout.tmp, build.file.replace(/[^A-Za-z0-9._-]/g, '_'));
    await downloadVerified({
      url: build.url,
      sha256: build.sha256,
      maxBytes: build.size + 1024 * 1024,
      dest: archive,
      allowedHosts: this.options.allowedHosts ?? DOWNLOAD_HOSTS,
      signal,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      onProgress: (bytes) => this.phase('download', Math.min(0.4, (bytes / build.size) * 0.4)),
    });
    this.phase('extract', 0.4);
    mkdirSync(layout.runtime, { recursive: true, mode: 0o700 });
    const extracted = await run({
      command: '/usr/bin/tar',
      args: ['-xzf', archive, '-C', layout.runtime],
      cwd: layout.tmp,
      env: { PATH: '/usr/bin:/bin' },
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryBytes: 1024 * 1024 * 1024,
      signal,
    });
    rmSync(archive, { force: true });
    if (extracted.reason === 'cancelled') throw new SetupError('cancelled');
    if (extracted.reason !== 'exit' || extracted.code !== 0 || !existsSync(layout.python)) {
      throw new SetupError('extract_failed');
    }

    // 2. Pakete aus dem Lock
    this.phase('packages', 0.5);
    const lockFile = join(layout.tmp, 'requirements.lock');
    writeFileSync(lockFile, lock, { mode: 0o600 });
    const installed = await run({
      command: layout.python,
      args: [
        '-m',
        'pip',
        'install',
        '--require-hashes',
        '--only-binary=:all:',
        '--no-deps',
        '--disable-pip-version-check',
        '--no-input',
        '--no-cache-dir',
        '--target',
        layout.site,
        '-r',
        lockFile,
      ],
      cwd: layout.tmp,
      env: toolEnv,
      timeoutMs: 30 * 60_000,
      maxOutputBytes: 8 * 1024 * 1024,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      watchDir: layout.root,
      maxDirBytes: 4 * 1024 * 1024 * 1024,
      maxDirEntries: 400_000,
      signal,
    });
    if (installed.reason === 'cancelled') throw new SetupError('cancelled');
    if (installed.reason !== 'exit' || installed.code !== 0)
      throw new SetupError('packages_failed');

    // 3. Prüfen: Schriftzwischenspeicher vorbereiten, Sandbox testen, Module importieren
    this.phase('check', 0.9);
    const warm = await run({
      command: layout.python,
      args: ['-s', '-c', 'import matplotlib.font_manager'],
      cwd: layout.tmp,
      env: {
        ...TOOL_ENV(layout.home, layout.tmp),
        PYTHONPATH: layout.site,
        MPLCONFIGDIR: layout.mpl,
        MPLBACKEND: 'Agg',
      },
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      signal,
    });
    if (warm.reason !== 'exit' || warm.code !== 0) throw new SetupError('check_failed');

    this.options.guard.reset();
    // Die Marke wird erst ganz zum Schluss geschrieben; `info()` liefert vorher nichts. Die Pfade bilden wir selbst.
    const readOnly = [join(layout.runtime, 'python'), layout.site];
    const env = buildCodeEnv({
      sitePackages: layout.site,
      workspace: layout.tmp,
      timeZone: this.options.timeZone,
    });
    const sandbox = await this.options.guard.check({ python: layout.python, readOnly, env });
    if (!sandbox.ok) throw new SetupError('sandbox_failed');

    const workspace = join(layout.root, 'check');
    mkdirSync(join(workspace, '.home'), { recursive: true, mode: 0o700 });
    mkdirSync(join(workspace, '.tmp'), { recursive: true, mode: 0o700 });
    seedMatplotlibCache(layout.mpl, workspace);
    const imports = await (this.options.sandboxRun ?? runSandboxed)({
      command: layout.python,
      args: ['-s', '-c', `import ${CHECK_IMPORTS.join(', ')}`],
      cwd: workspace,
      workspace,
      readOnly,
      env: buildCodeEnv({
        sitePackages: layout.site,
        workspace,
        timeZone: this.options.timeZone,
      }),
      timeoutMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      signal,
    });
    rmSync(workspace, { recursive: true, force: true });
    if (imports.reason !== 'exit' || imports.code !== 0) throw new SetupError('check_failed');

    const marker: ReadyMarker = {
      pythonVersion: PYTHON_VERSION,
      release: PBS_RELEASE,
      lockSha256: lockHash(lock),
      installedAt: new Date().toISOString(),
    };
    writeFileSync(layout.marker, JSON.stringify(marker), { mode: 0o600 });
    rmSync(layout.tmp, { recursive: true, force: true });
    rmSync(layout.home, { recursive: true, force: true });
  }
}
