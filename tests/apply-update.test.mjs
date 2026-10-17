import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyUpdate,
  parseArgs,
  realDeps,
  UsageError,
  validate,
} from '../scripts/apply-update.mjs';
import { root, runNode } from './helpers.mjs';

describe('apply-update (Befehlszeile)', () => {
  const base = [
    '--pid',
    '4242',
    '--built',
    '/c/repo/apps/desktop/out/Pagewise-darwin-arm64/Pagewise.app',
    '--dest',
    '/Users/b/Applications/Pagewise.app',
    '--backup',
    '/c/backup/Pagewise.app',
    '--result',
    '/c/result.json',
  ];

  it('liest alle Angaben und hat sinnvolle Voreinstellungen', () => {
    expect(parseArgs(base)).toEqual({
      open: true,
      waitSeconds: 90,
      pid: 4242,
      built: '/c/repo/apps/desktop/out/Pagewise-darwin-arm64/Pagewise.app',
      dest: '/Users/b/Applications/Pagewise.app',
      backup: '/c/backup/Pagewise.app',
      result: '/c/result.json',
    });
    expect(parseArgs([...base, '--no-open', '--wait', '5'])).toMatchObject({
      open: false,
      waitSeconds: 5,
    });
  });

  it('lehnt Unbekanntes, Fehlendes und Unsinniges ab', () => {
    expect(() => parseArgs([...base, '--force'])).toThrow(UsageError);
    expect(() => parseArgs(base.slice(2))).toThrow(UsageError); // --pid fehlt
    expect(() => parseArgs(['--pid', 'abc', ...base.slice(2)])).toThrow(UsageError);
    expect(() => parseArgs(['--pid', '0', ...base.slice(2)])).toThrow(UsageError);
    expect(() => parseArgs([...base.slice(0, -1)])).toThrow(UsageError); // --result ohne Wert
  });

  it('prüft die Pfade, bevor irgendetwas verschoben wird', () => {
    const ok = parseArgs(base);
    expect(() => validate(ok)).not.toThrow();
    for (const patch of [
      { dest: 'relativ/Pagewise.app' },
      { dest: '/Users/b/Applications/Pagewise.app/../Anderes.app' },
      { dest: '/Users/b/Applications/Pagewise' },
      { built: '/c/repo/neu' },
      { backup: '/c/anders/Pagewise.app' },
      { backup: '/c/backup/Anders.app' },
      { result: '/c/result.txt' },
      { dest: '/c/repo/apps/Pagewise.app', built: '/c/repo/apps/Pagewise.app/neu.app' },
      { backup: ok.dest, dest: ok.dest },
      { dest: '/c/backup/Pagewise.app' },
    ]) {
      expect(() => validate({ ...ok, ...patch }), JSON.stringify(patch)).toThrow(UsageError);
    }
  });

  it('meldet falsche Aufrufe mit Exit 2 und tut nichts', () => {
    const result = runNode('scripts/apply-update.mjs', ['--unbekannt'], { cwd: root });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unbekannte Option');
  });

  it('der Quelltext benutzt keine Shell und kein Flag, das Abfragen überspringt', () => {
    const source = readFileSync(join(root, 'scripts', 'apply-update.mjs'), 'utf8');
    expect(source).not.toMatch(/shell:\s*true/);
    expect(source).not.toMatch(/\bexec\(|execSync\(/);
    expect(source).not.toMatch(/dangerously|--force-all|skip-permissions/);
  });
});

describe('apply-update (Austausch)', () => {
  let dir;
  let paths;
  let events;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pagewise-apply-'));
    paths = {
      built: join(
        dir,
        'cache',
        'repo',
        'apps',
        'desktop',
        'out',
        'Pagewise-darwin-arm64',
        'Pagewise.app',
      ),
      dest: join(dir, 'Applications', 'Pagewise.app'),
      backup: join(dir, 'cache', 'backup', 'Pagewise.app'),
      result: join(dir, 'cache', 'result.json'),
    };
    mkdirSync(join(dir, 'Applications'), { recursive: true });
    events = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const makeApp = (path, version) => {
    mkdirSync(join(path, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(path, 'Contents', 'Resources'), { recursive: true });
    writeFileSync(join(path, 'Contents', 'MacOS', 'Pagewise'), version);
    writeFileSync(
      join(path, 'Contents', 'Resources', 'build-info.json'),
      JSON.stringify({ commit: version.padEnd(40, '0') }),
    );
  };
  const version = (path) => readFileSync(join(path, 'Contents', 'MacOS', 'Pagewise'), 'utf8');
  const result = () => JSON.parse(readFileSync(paths.result, 'utf8'));
  const options = (extra = {}) => ({ pid: 1, waitSeconds: 5, open: true, ...paths, ...extra });

  /** Echte Dateien in einem Wegwerf-Ordner; Prozess, Zeit, Signatur und „open“ sind gespielt. */
  function deps(extra = {}) {
    let clock = 1_000_000;
    const real = realDeps();
    return {
      ...real,
      platform: 'darwin',
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      isAlive: () => false,
      rename: (from, to) => {
        events.push('rename');
        return real.rename(from, to);
      },
      copy: () => {
        throw new Error('Kopieren nicht erwartet');
      },
      verify: () => events.push('verify'),
      open: () => events.push('open'),
      ...extra,
    };
  }

  it('setzt die neue App ein, sichert die alte und öffnet die neue', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const outcome = await applyUpdate(options(), deps());
    expect(outcome.ok).toBe(true);
    expect(version(paths.dest)).toBe('neu');
    expect(version(paths.backup)).toBe('alt');
    expect(existsSync(paths.built)).toBe(false);
    expect(events).toEqual(['rename', 'rename', 'verify', 'open']);
    expect(result()).toMatchObject({ ok: true, message: 'Aktualisiert auf Fassung neu0000.' });
  });

  it('ersetzt eine ältere Sicherung', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    makeApp(paths.backup, 'uralt');
    await applyUpdate(options(), deps());
    expect(version(paths.backup)).toBe('alt');
  });

  it('wartet, bis die App beendet ist, und ändert vorher nichts', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    let polls = 0;
    await applyUpdate(
      options(),
      deps({
        isAlive: () => {
          polls += 1;
          expect(version(paths.dest)).toBe('alt');
          return polls < 4;
        },
      }),
    );
    expect(polls).toBe(4);
    expect(version(paths.dest)).toBe('neu');
  });

  it('gibt auf, wenn sich die App nicht beendet, und lässt alles wie es ist', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const outcome = await applyUpdate(options({ waitSeconds: 2 }), deps({ isAlive: () => true }));
    expect(outcome.ok).toBe(false);
    expect(version(paths.dest)).toBe('alt');
    expect(version(paths.built)).toBe('neu');
    expect(events).toEqual([]);
    expect(result()).toMatchObject({ ok: false });
  });

  it('stellt die alte App wieder her, wenn die Signatur der neuen nicht stimmt', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const outcome = await applyUpdate(
      options(),
      deps({
        verify: () => {
          throw new Error('invalid signature');
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(version(paths.dest)).toBe('alt');
    expect(result().message).toContain('Signatur');
    // Die alte App wird wieder geöffnet, damit der Server nicht ausbleibt.
    expect(events.at(-1)).toBe('open');
  });

  it('stellt die alte App wieder her, wenn das Einsetzen scheitert', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const real = realDeps();
    let calls = 0;
    const outcome = await applyUpdate(
      options(),
      deps({
        rename: (from, to) => {
          calls += 1;
          if (calls === 2) throw Object.assign(new Error('gesperrt'), { code: 'EACCES' });
          return real.rename(from, to);
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(version(paths.dest)).toBe('alt');
    expect(outcome.message).toContain('EACCES');
  });

  it('ändert nichts, wenn sich die alte App nicht wegräumen lässt (kein Schreibrecht)', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const outcome = await applyUpdate(
      options(),
      deps({
        rename: () => {
          throw Object.assign(new Error('keine Rechte'), { code: 'EACCES' });
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(version(paths.dest)).toBe('alt');
    expect(version(paths.built)).toBe('neu');
  });

  it('kopiert über Datenträger hinweg, wenn Umbenennen nicht geht', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    const real = realDeps();
    const copies = [];
    const outcome = await applyUpdate(
      options(),
      deps({
        rename: () => {
          throw Object.assign(new Error('anderer Datenträger'), { code: 'EXDEV' });
        },
        copy: (from, to) => {
          copies.push([from, to]);
          // `ditto` ersetzt der Test durch Kopieren per Dateisystem.
          mkdirSync(to, { recursive: true });
          makeApp(to, version(from));
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    expect(copies).toHaveLength(2);
    expect(version(paths.dest)).toBe('neu');
    expect(real).toBeDefined();
  });

  it('installiert auch, wenn keine alte App mehr da ist, und lässt „open“ auf Wunsch aus', async () => {
    makeApp(paths.built, 'neu');
    const outcome = await applyUpdate(options({ open: false }), deps());
    expect(outcome.ok).toBe(true);
    expect(version(paths.dest)).toBe('neu');
    expect(events).toEqual(['rename', 'verify']);
  });

  it('bricht ab, wenn die vorbereitete App fehlt', async () => {
    makeApp(paths.dest, 'alt');
    const outcome = await applyUpdate(options(), deps());
    expect(outcome.ok).toBe(false);
    expect(version(paths.dest)).toBe('alt');
    expect(events).toEqual(['open']);
  });

  it('schreibt das Ergebnis vor dem Öffnen, damit die neue App es beim Start findet', async () => {
    makeApp(paths.dest, 'alt');
    makeApp(paths.built, 'neu');
    let seen = null;
    await applyUpdate(
      options(),
      deps({
        open: () => {
          seen = existsSync(paths.result);
        },
      }),
    );
    expect(seen).toBe(true);
  });
});
