import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertDataDirOutsideRepo,
  DataDirError,
  defaultDataDir,
  prepareDataDir,
  resolveDataDir,
} from './data-dir';

describe('defaultDataDir', () => {
  it('nutzt unter macOS Application Support', () => {
    expect(defaultDataDir({}, 'darwin', '/Users/beispiel')).toBe(
      '/Users/beispiel/Library/Application Support/Pagewise',
    );
  });

  it('nutzt unter Linux XDG_DATA_HOME, sonst ~/.local/share', () => {
    expect(defaultDataDir({ XDG_DATA_HOME: '/srv/daten' }, 'linux', '/home/b')).toBe(
      '/srv/daten/pagewise',
    );
    expect(defaultDataDir({}, 'linux', '/home/b')).toBe('/home/b/.local/share/pagewise');
    expect(defaultDataDir({ XDG_DATA_HOME: 'relativ' }, 'linux', '/home/b')).toBe(
      '/home/b/.local/share/pagewise',
    );
  });
});

describe('resolveDataDir', () => {
  it('bevorzugt PAGEWISE_DATA_DIR und expandiert ~', () => {
    expect(resolveDataDir({ PAGEWISE_DATA_DIR: '/srv/x' }, { home: '/home/b' })).toBe('/srv/x');
    expect(resolveDataDir({ PAGEWISE_DATA_DIR: '~/daten' }, { home: '/home/b' })).toBe(
      '/home/b/daten',
    );
  });

  it('lehnt relative Pfade ab', () => {
    expect(() => resolveDataDir({ PAGEWISE_DATA_DIR: 'data' })).toThrow(DataDirError);
  });
});

describe('Start-Check des Datenverzeichnisses', () => {
  let base: string;
  let repo: string;
  let outside: string;
  let appRoot: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pagewise-datadir-')));
    repo = join(base, 'repo');
    outside = join(base, 'daten');
    appRoot = join(base, 'app');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(appRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('akzeptiert einen Ort außerhalb von Repo und App', () => {
    expect(assertDataDirOutsideRepo(outside, { appRoot })).toBe(outside);
  });

  it('verweigert einen Ort innerhalb eines Git-Arbeitsverzeichnisses', () => {
    expect(() => assertDataDirOutsideRepo(join(repo, 'data'), { appRoot })).toThrow(
      /Git-Arbeitsverzeichnis/,
    );
    expect(() => assertDataDirOutsideRepo(join(repo, 'a', 'b', 'c'), { appRoot })).toThrow(
      DataDirError,
    );
    expect(() => assertDataDirOutsideRepo(repo, { appRoot })).toThrow(DataDirError);
  });

  it('erkennt auch .git als Datei (Worktrees, Submodule)', () => {
    const worktree = join(base, 'worktree');
    mkdirSync(worktree);
    writeFileSync(join(worktree, '.git'), 'gitdir: /irgendwo\n');
    expect(() => assertDataDirOutsideRepo(join(worktree, 'data'), { appRoot })).toThrow(
      DataDirError,
    );
  });

  it('folgt Symlinks, die ins Repo zeigen', () => {
    mkdirSync(join(repo, 'ziel'));
    const link = join(base, 'link');
    symlinkSync(join(repo, 'ziel'), link);
    expect(() => assertDataDirOutsideRepo(join(link, 'daten'), { appRoot })).toThrow(DataDirError);
  });

  it('verweigert den Anwendungsordner auch ohne .git', () => {
    expect(() => assertDataDirOutsideRepo(join(appRoot, 'data'), { appRoot })).toThrow(
      /Anwendungsordner/,
    );
  });

  it('legt das Verzeichnis mit Rechten 700 an', () => {
    const dir = prepareDataDir({ PAGEWISE_DATA_DIR: join(outside, 'neu') }, { appRoot });
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('erzeugt bei einem abgelehnten Start nichts im Repo', () => {
    const target = join(repo, 'data');
    expect(() => prepareDataDir({ PAGEWISE_DATA_DIR: target }, { appRoot })).toThrow(DataDirError);
    expect(existsSync(target)).toBe(false);
  });
});
