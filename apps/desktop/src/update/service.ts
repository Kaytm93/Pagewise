import { basename, dirname, join } from 'node:path';
import { type BuildInfo, COMMIT_PATTERN, parseBuildInfoText } from './build-info';
import { buildMinimalEnv, buildUpdateEnv } from './env';
import type { UpdateFs } from './fs';
import type { Runner, RunResult } from './runner';
import { resolveTools, type Tools } from './tools';

/**
 * Der Kern des Updates (D-057). Ablauf: bei GitHub nachsehen (`git ls-remote`), die neueste Fassung von `main` in einen
 * eigenen Arbeitsordner holen, dort `pnpm install` und `pnpm app:mac --no-install` ausführen (derselbe Weg wie von
 * Hand im Terminal), die gebaute App prüfen (Signatur, Rauchtest) und bereitlegen. Ersetzt wird die laufende App erst
 * danach und nicht von hier, sondern vom Helfer `scripts/apply-update.mjs`, wenn die App beendet ist.
 *
 * Nichts davon passiert von selbst: Jede Funktion ruft jemand auf, der dafür einen Klick hatte. Programme laufen ohne
 * Shell, mit eigener Umgebung (`env.ts`), und die Quelle ist eine feste Adresse aus `config.ts`.
 */

export type StepId = 'fetch' | 'install' | 'build' | 'verify';
export const STEP_ORDER: readonly StepId[] = ['fetch', 'install', 'build', 'verify'];

export type UpdateErrorCode =
  | 'unsupported'
  | 'no-git'
  | 'no-tools'
  | 'network'
  | 'git-failed'
  | 'install-failed'
  | 'build-failed'
  | 'verify-failed'
  | 'smoke-failed'
  | 'disk-space'
  | 'cancelled'
  | 'not-ready'
  | 'handoff-failed';

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string = code,
    readonly detail: readonly string[] = [],
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

export type UnsupportedReason = 'platform' | 'dev' | 'bundle' | 'translocated' | 'not-writable';

export type Support = { ok: true; bundle: string } | { ok: false; reason: UnsupportedReason };

export interface UpdatePaths {
  root: string;
  repo: string;
  backup: string;
  log: string;
  ready: string;
  result: string;
}

export function updatePaths(root: string): UpdatePaths {
  return {
    root,
    repo: join(root, 'repo'),
    backup: join(root, 'backup', 'Pagewise.app'),
    log: join(root, 'update.log'),
    ready: join(root, 'ready.json'),
    result: join(root, 'result.json'),
  };
}

export interface UpdateServiceDeps {
  runner: Runner;
  fs: UpdateFs;
  /** Umgebung der App (`process.env`); nur eine Auswahl geht an die Programme (`env.ts`). */
  source: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  arch: 'arm64' | 'x64';
  isPackaged: boolean;
  /** Pfad der laufenden Programmdatei (`…/Pagewise.app/Contents/MacOS/Pagewise`). */
  execPath: string;
  buildInfo: BuildInfo;
  paths: UpdatePaths;
  repoUrl: string;
  branch: string;
  now?: () => Date;
}

export interface InstalledInfo {
  commit: string | null;
  commitDate: string | null;
  builtAt: string | null;
  dirty: boolean;
}

export interface CheckResult {
  remote: string;
  upToDate: boolean;
  /** Betreffzeilen der neuen Commits (höchstens {@link MAX_CHANGES}), leer, wenn nicht bekannt. */
  changes: string[];
  /** Anzahl neuer Commits, `null`, wenn nicht bekannt. */
  changeCount: number | null;
  remoteDate: string | null;
}

export interface ReadyUpdate {
  commit: string;
  commitDate: string | null;
  appPath: string;
  builtAt: string;
}

export interface UpdateResult {
  ok: boolean;
  at: string;
  message: string;
}

export interface PrepareHooks {
  signal: AbortSignal;
  step(id: StepId): void;
  line(text: string): void;
}

export const MAX_CHANGES = 12;
/** Mindestens so viel Platz braucht ein Bauen (Electron, Bündel, gepackte App). */
export const MIN_FREE_BYTES = 2 * 1024 ** 3;

const MINUTE = 60_000;
const TIMEOUT = {
  lsRemote: 25_000,
  quick: 30_000,
  network: 5 * MINUTE,
  install: 20 * MINUTE,
  build: 25 * MINUTE,
  codesign: 2 * MINUTE,
  smoke: 3 * MINUTE,
} as const;

const NETWORK_HINTS =
  /could not resolve host|unable to access|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|ssl|tls|operation timed out|early eof|remote end hung up|proxy/i;

/** Betreffzeilen stammen aus dem Netz: Steuerzeichen raus, Länge begrenzen, nur als Text anzeigen. */
export function cleanSubject(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen aus fremdem Text entfernen.
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return plain.length > 160 ? `${plain.slice(0, 160)} …` : plain;
}

export function builtAppPath(repo: string, arch: string): string {
  return join(repo, 'apps', 'desktop', 'out', `Pagewise-darwin-${arch}`, 'Pagewise.app');
}

export class UpdateService {
  private readonly now: () => Date;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get paths(): UpdatePaths {
    return this.deps.paths;
  }

  installed(): InstalledInfo {
    const { commit, commitDate, builtAt, dirty } = this.deps.buildInfo;
    return { commit, commitDate, builtAt, dirty };
  }

  /**
   * Kann sich diese App selbst ersetzen? Nur eine gepackte App auf dem Mac, deren Ordner beschreibbar ist. Eine App
   * aus dem Entwicklungsmodus (`electron .`) oder eine „verschobene“ (App Translocation, schreibgeschützt) kann es nicht.
   */
  support(): Support {
    const { platform, isPackaged, execPath, fs } = this.deps;
    if (platform !== 'darwin') return { ok: false, reason: 'platform' };
    if (!isPackaged) return { ok: false, reason: 'dev' };
    const bundle = dirname(dirname(dirname(execPath)));
    if (!bundle.endsWith('.app') || basename(dirname(execPath)) !== 'MacOS') {
      return { ok: false, reason: 'bundle' };
    }
    if (bundle.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
    if (!fs.isWritable(dirname(bundle)) || !fs.isWritable(bundle)) {
      return { ok: false, reason: 'not-writable' };
    }
    return { ok: true, bundle };
  }

  private tools(): Tools {
    const resolved = resolveTools({
      info: this.deps.buildInfo,
      home: this.deps.home,
      fs: this.deps.fs,
    });
    if (!resolved.ok) throw new UpdateError(resolved.code, resolved.detail);
    return resolved.tools;
  }

  private env(tools: Tools): Record<string, string> {
    return buildUpdateEnv({ source: this.deps.source, pathDirs: tools.pathDirs });
  }

  private log(text: string): void {
    try {
      this.deps.fs.appendText(this.deps.paths.log, `${text}\n`);
    } catch {
      // Das Protokoll ist Komfort.
    }
  }

  // --- Nachsehen ---------------------------------------------------------------------------------

  /** Fragt bei GitHub nach dem Stand von `main` (ein kurzer Aufruf, es wird nichts geladen oder verändert). */
  async check(signal?: AbortSignal): Promise<CheckResult> {
    const tools = this.tools();
    const env = this.env(tools);
    const { runner, repoUrl, branch } = this.deps;

    const listed = await runner(
      tools.git,
      ['ls-remote', '--exit-code', repoUrl, `refs/heads/${branch}`],
      { env, timeoutMs: TIMEOUT.lsRemote, signal },
    );
    if (listed.aborted) throw new UpdateError('cancelled');
    const head = listed.tail
      .map((line) => /^([0-9a-f]{40})\s+refs\/heads\/(.+)$/.exec(line))
      .find((match) => match?.[2] === branch);
    if (listed.code !== 0 || !head?.[1]) {
      throw this.gitFailure(listed, 'Nachsehen bei GitHub');
    }
    const remote = head[1];
    const installed = this.deps.buildInfo.commit;
    if (installed === remote) {
      return { remote, upToDate: true, changes: [], changeCount: 0, remoteDate: null };
    }

    const known = await this.describeChanges(tools, env, installed, remote, signal);
    // Die installierte Fassung enthält schon alles aus `main` (z. B. lokal weitergebaut): nichts zu holen.
    if (known && known.count === 0) {
      return { remote, upToDate: true, changes: [], changeCount: 0, remoteDate: known.date };
    }
    return {
      remote,
      upToDate: false,
      changes: known?.subjects ?? [],
      changeCount: known?.count ?? null,
      remoteDate: known?.date ?? null,
    };
  }

  /** Gibt es schon einen Arbeitsordner, holt `fetch` den Verlauf, und die Liste der Änderungen wird möglich. Fehler sind hier egal. */
  private async describeChanges(
    tools: Tools,
    env: Record<string, string>,
    installed: string | null,
    remote: string,
    signal?: AbortSignal,
  ): Promise<{ subjects: string[]; count: number | null; date: string | null } | null> {
    const { runner, fs, paths, branch } = this.deps;
    if (!fs.exists(join(paths.repo, '.git'))) return null;
    const run = (args: string[], timeoutMs: number): Promise<RunResult> =>
      runner(tools.git, args, { cwd: paths.repo, env, timeoutMs, signal });
    const fetched = await run(['fetch', '--no-tags', '--quiet', 'origin', branch], TIMEOUT.network);
    if (fetched.code !== 0) return null;
    const hasRemote = await run(['cat-file', '-e', `${remote}^{commit}`], TIMEOUT.quick);
    if (hasRemote.code !== 0) return null;
    const date = await run(['show', '-s', '--format=%cI', remote], TIMEOUT.quick);
    const remoteDate = date.code === 0 ? (date.tail.at(-1) ?? null) : null;

    const range =
      installed &&
      (await run(['cat-file', '-e', `${installed}^{commit}`], TIMEOUT.quick)).code === 0
        ? `${installed}..${remote}`
        : null;
    if (!range) {
      const latest = await run(['log', '-n', '5', '--format=%s', remote], TIMEOUT.quick);
      return {
        subjects: latest.code === 0 ? latest.tail.map(cleanSubject) : [],
        count: null,
        date: remoteDate,
      };
    }
    const count = await run(['rev-list', '--count', range], TIMEOUT.quick);
    const subjects = await run(
      ['log', '-n', String(MAX_CHANGES), '--format=%s', range],
      TIMEOUT.quick,
    );
    const parsed = count.code === 0 ? Number.parseInt(count.tail.at(-1) ?? '', 10) : Number.NaN;
    return {
      subjects: subjects.code === 0 ? subjects.tail.map(cleanSubject) : [],
      count: Number.isFinite(parsed) ? parsed : null,
      date: remoteDate,
    };
  }

  private gitFailure(result: RunResult, what: string): UpdateError {
    const text = result.tail.join('\n');
    if (result.spawnFailed) return new UpdateError('no-git', what, result.tail);
    const network = result.timedOut || NETWORK_HINTS.test(text);
    return new UpdateError(network ? 'network' : 'git-failed', what, result.tail);
  }

  // --- Vorbereiten ---------------------------------------------------------------------------------

  /**
   * Holt, installiert, baut und prüft. Am Ende liegt eine fertige, geprüfte `Pagewise.app` im Arbeitsordner bereit.
   * Die laufende App bleibt dabei unberührt; scheitert etwas, ist nichts verändert.
   */
  async prepare(hooks: PrepareHooks): Promise<ReadyUpdate> {
    const support = this.support();
    if (!support.ok) throw new UpdateError('unsupported', support.reason);
    const tools = this.tools();
    const env = this.env(tools);
    const { runner, fs, paths, arch } = this.deps;

    fs.remove(paths.log);
    fs.remove(paths.ready);
    this.log(
      `Update gestartet ${this.now().toISOString()} (Werkzeuge ${tools.remembered ? 'vom Bauen' : 'gefunden'}).`,
    );

    const free = fs.freeBytes(paths.root);
    if (free !== null && free < MIN_FREE_BYTES) {
      throw new UpdateError('disk-space', `${Math.floor(free / 1024 ** 2)} MB frei`);
    }

    const run = async (
      command: string,
      args: readonly string[],
      options: { cwd?: string; timeoutMs: number; env?: Record<string, string> },
    ): Promise<RunResult> => {
      this.log(`$ ${basename(command)} ${args.join(' ')}`);
      const result = await runner(command, args, {
        cwd: options.cwd,
        env: options.env ?? env,
        timeoutMs: options.timeoutMs,
        signal: hooks.signal,
        onLine: (line) => {
          this.log(line);
          hooks.line(line);
        },
      });
      if (result.aborted) throw new UpdateError('cancelled');
      return result;
    };
    const git = (args: readonly string[], timeoutMs = TIMEOUT.network): Promise<RunResult> =>
      run(tools.git, args, { cwd: paths.repo, timeoutMs });
    const pnpm = (args: readonly string[], timeoutMs: number): Promise<RunResult> =>
      run(tools.pnpm.command, [...tools.pnpm.prefix, ...args], { cwd: paths.repo, timeoutMs });

    // 1. Holen
    hooks.step('fetch');
    const target = await this.fetchTarget(tools, run, git);

    // 2. Installieren
    hooks.step('install');
    let install = await pnpm(['install', '--frozen-lockfile'], TIMEOUT.install);
    if (install.code !== 0 && !install.timedOut) {
      // Ein halb kaputter oder von einer anderen pnpm-Fassung angelegter node_modules-Ordner: einmal neu anlegen.
      this.log('Installation gescheitert, node_modules wird neu angelegt.');
      fs.remove(join(paths.repo, 'node_modules'));
      install = await pnpm(['install', '--frozen-lockfile'], TIMEOUT.install);
    }
    if (install.code !== 0) throw new UpdateError('install-failed', 'pnpm install', install.tail);

    // 3. Bauen
    hooks.step('build');
    const built = builtAppPath(paths.repo, arch);
    fs.remove(join(paths.repo, 'apps', 'desktop', 'out'));
    const build = await pnpm(['app:mac', '--no-install', '--arch', arch], TIMEOUT.build);
    if (build.code !== 0 || !fs.exists(built)) {
      throw new UpdateError('build-failed', 'pnpm app:mac', build.tail);
    }

    // 4. Prüfen
    hooks.step('verify');
    const signature = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', built], {
      timeoutMs: TIMEOUT.codesign,
    });
    if (signature.code !== 0) throw new UpdateError('verify-failed', 'codesign', signature.tail);

    const builtInfo = this.readBuiltInfo(built);
    if (builtInfo.commit !== target) {
      throw new UpdateError(
        'verify-failed',
        'Die gebaute App stammt nicht aus der geholten Fassung.',
      );
    }

    const smoke = await run(join(built, 'Contents', 'MacOS', 'Pagewise'), ['--smoke-test'], {
      timeoutMs: TIMEOUT.smoke,
      env: buildMinimalEnv(this.deps.source, tools.pathDirs),
    });
    if (smoke.code !== 0 || !smoke.tail.some((line) => line.includes('Rauchtest bestanden'))) {
      throw new UpdateError('smoke-failed', 'Rauchtest', smoke.tail);
    }

    const ready: ReadyUpdate = {
      commit: target,
      commitDate: builtInfo.commitDate,
      appPath: built,
      builtAt: this.now().toISOString(),
    };
    fs.writeText(paths.ready, `${JSON.stringify(ready)}\n`);
    this.log('Update bereit.');
    return ready;
  }

  private readBuiltInfo(app: string): BuildInfo {
    return parseBuildInfoText(
      this.deps.fs.readText(join(app, 'Contents', 'Resources', 'build-info.json')),
    );
  }

  /** Legt den Arbeitsordner an oder erneuert ihn und stellt `main` ohne Verlauf-Ballast zum Bauen bereit. */
  private async fetchTarget(
    tools: Tools,
    run: (
      command: string,
      args: readonly string[],
      options: { cwd?: string; timeoutMs: number; env?: Record<string, string> },
    ) => Promise<RunResult>,
    git: (args: readonly string[], timeoutMs?: number) => Promise<RunResult>,
  ): Promise<string> {
    const { fs, paths, repoUrl, branch } = this.deps;

    if (fs.exists(join(paths.repo, '.git'))) {
      const origin = await git(['config', '--get', 'remote.origin.url'], TIMEOUT.quick);
      // Ein Ordner, der woandershin zeigt oder kaputt ist, wird nicht repariert, sondern neu angelegt.
      if (origin.code !== 0 || origin.tail.at(-1) !== repoUrl) fs.remove(paths.repo);
    } else {
      fs.remove(paths.repo);
    }

    if (!fs.exists(join(paths.repo, '.git'))) {
      fs.mkdir(paths.root);
      const cloned = await run(
        tools.git,
        ['clone', '--single-branch', '--branch', branch, '--no-tags', repoUrl, paths.repo],
        { cwd: paths.root, timeoutMs: TIMEOUT.network },
      );
      if (cloned.code !== 0) {
        fs.remove(paths.repo);
        throw this.gitFailure(cloned, 'Herunterladen von GitHub');
      }
    }

    const fetched = await git(['fetch', '--no-tags', 'origin', branch]);
    if (fetched.code !== 0) throw this.gitFailure(fetched, 'Holen von GitHub');
    const head = await git(['rev-parse', 'FETCH_HEAD'], TIMEOUT.quick);
    const target = head.tail.at(-1) ?? '';
    if (head.code !== 0 || !COMMIT_PATTERN.test(target)) {
      throw new UpdateError('git-failed', 'rev-parse', head.tail);
    }
    const checkout = await git(['checkout', '--force', '--detach', target], TIMEOUT.quick);
    if (checkout.code !== 0) throw new UpdateError('git-failed', 'checkout', checkout.tail);
    // Reste früherer Läufe (nicht eingecheckt, nicht ignoriert) raus; node_modules bleibt (ignoriert).
    await git(['clean', '-fd'], TIMEOUT.quick);
    return target;
  }

  // --- Bereit und Übergabe ---------------------------------------------------------------------------

  /** Liest die bereitgelegte Fassung, wenn es sie noch gibt, zur gesuchten Fassung passt und neuer ist als die laufende. */
  loadReady(expectedCommit?: string): ReadyUpdate | null {
    const { fs, paths, buildInfo } = this.deps;
    const text = fs.readText(paths.ready);
    if (text === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const value = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >;
    const commit = value.commit;
    const appPath = value.appPath;
    if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return null;
    if (typeof appPath !== 'string' || appPath !== builtAppPath(paths.repo, this.deps.arch)) {
      return null;
    }
    if (commit === buildInfo.commit) {
      // Schon installiert (z. B. per Terminal): Die Marke ist erledigt.
      fs.remove(paths.ready);
      return null;
    }
    if (expectedCommit !== undefined && commit !== expectedCommit) return null;
    if (!fs.exists(appPath)) return null;
    return {
      commit,
      commitDate: typeof value.commitDate === 'string' ? value.commitDate : null,
      appPath,
      builtAt: typeof value.builtAt === 'string' ? value.builtAt : '',
    };
  }

  /**
   * Der Befehl, der nach dem Beenden der App die neue Fassung einsetzt und startet. Der Helfer liegt im frisch geholten
   * Arbeitsordner (nicht in der App, die er ersetzt) und läuft mit Node aus den bekannten Werkzeugen.
   */
  handoff(
    ready: ReadyUpdate,
    pid: number,
  ): { command: string; args: string[]; env: Record<string, string> } {
    const support = this.support();
    if (!support.ok) throw new UpdateError('unsupported', support.reason);
    const { fs, paths } = this.deps;
    const tools = this.tools();
    const helper = join(paths.repo, 'scripts', 'apply-update.mjs');
    if (!fs.exists(helper) || !fs.exists(ready.appPath)) {
      throw new UpdateError('not-ready', 'Helfer oder gebaute App fehlen.');
    }
    return {
      command: tools.node,
      args: [
        helper,
        '--pid',
        String(pid),
        '--built',
        ready.appPath,
        '--dest',
        support.bundle,
        '--backup',
        paths.backup,
        '--result',
        paths.result,
      ],
      env: buildMinimalEnv(this.deps.source, tools.pathDirs),
    };
  }

  // --- Ergebnis des letzten Austauschs -------------------------------------------------------------

  readResult(): UpdateResult | null {
    const text = this.deps.fs.readText(this.deps.paths.result);
    if (text === null) return null;
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      if (typeof value.ok !== 'boolean' || typeof value.message !== 'string') return null;
      return {
        ok: value.ok,
        message: cleanSubject(value.message),
        at: typeof value.at === 'string' ? value.at : '',
      };
    } catch {
      return null;
    }
  }

  clearResult(): void {
    this.deps.fs.remove(this.deps.paths.result);
  }
}
