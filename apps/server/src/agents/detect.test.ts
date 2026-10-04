import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliDetector, detectClaude, probeVersion } from './detect';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function script(dir: string, body: string, name = 'claude'): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const good = (version = '2.1.220 (Claude Code)') => `echo "${version}"`;
const broken = 'echo "kaputt" >&2; exit 127';

const noExtra = { extraDirs: [] as string[] };

describe('Erkennung von claude', () => {
  it('nimmt den ersten funktionierenden Kandidaten und merkt sich übersprungene', async () => {
    const first = script(join(base, 'a'), broken);
    const second = script(join(base, 'b'), good());
    script(join(base, 'c'), good('9.9.9'));
    const status = await detectClaude({
      searchPath: ['a', 'b', 'c'].map((d) => join(base, d)).join(delimiter),
      ...noExtra,
    });
    expect(status).toEqual({
      state: 'ready',
      path: second,
      version: '2.1.220',
      skipped: [{ path: first, reason: 'failed' }],
    });
  });

  it('meldet „missing“, wenn es keinen Kandidaten gibt', async () => {
    expect(
      await detectClaude({ searchPath: [join(base, 'leer')].join(delimiter), ...noExtra }),
    ).toEqual({ state: 'missing', skipped: [] });
  });

  it('meldet „broken“, wenn Kandidaten da sind, aber keiner läuft', async () => {
    const one = script(join(base, 'a'), broken);
    const two = script(join(base, 'b'), 'echo "kein Versionstext"');
    const status = await detectClaude({
      searchPath: [join(base, 'a'), join(base, 'b')].join(delimiter),
      ...noExtra,
    });
    expect(status).toEqual({
      state: 'broken',
      skipped: [
        { path: one, reason: 'failed' },
        { path: two, reason: 'bad_output' },
      ],
    });
  });

  it('übergeht Dateien ohne Ausführungsrecht und Ordner', async () => {
    const dir = join(base, 'a');
    mkdirSync(join(dir, 'claude'), { recursive: true });
    mkdirSync(join(base, 'b'));
    writeFileSync(join(base, 'b', 'claude'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o644 });
    expect(
      (
        await detectClaude({
          searchPath: [dir, join(base, 'b')].join(delimiter),
          ...noExtra,
        })
      ).state,
    ).toBe('missing');
  });

  it('prüft denselben Ort (Symlink) nur einmal', async () => {
    const real = script(join(base, 'echt'), broken);
    mkdirSync(join(base, 'link'));
    symlinkSync(real, join(base, 'link', 'claude'));
    const status = await detectClaude({
      searchPath: [join(base, 'echt'), join(base, 'link')].join(delimiter),
      ...noExtra,
    });
    expect(status).toMatchObject({ state: 'broken' });
    expect(status.skipped).toHaveLength(1);
  });

  it('prüft einen ausdrücklich gesetzten Pfad zuerst', async () => {
    const explicit = script(join(base, 'frei'), good('3.0.0'), 'mein-claude');
    script(join(base, 'a'), good('1.0.0'));
    const status = await detectClaude({
      explicitPath: explicit,
      searchPath: join(base, 'a'),
      ...noExtra,
    });
    expect(status).toMatchObject({ state: 'ready', path: explicit, version: '3.0.0' });
  });

  it('sucht auch in üblichen Ordnern außerhalb des Suchpfads', async () => {
    const hidden = script(join(base, 'versteckt'), good());
    const status = await detectClaude({
      searchPath: join(base, 'leer'),
      extraDirs: [join(base, 'versteckt')],
    });
    expect(status).toMatchObject({ state: 'ready', path: hidden });
  });

  it('wertet ein überschrittenes Zeitlimit als Fehler des Kandidaten', async () => {
    script(join(base, 'a'), 'sleep 5');
    const status = await detectClaude({
      searchPath: join(base, 'a'),
      timeoutMs: 150,
      ...noExtra,
    });
    expect(status).toMatchObject({ state: 'broken', skipped: [{ reason: 'timeout' }] });
  });

  it('startet für die Prüfung nur mit knapper Umgebung', async () => {
    process.env.PAGEWISE_TEST_GEHEIM = 'darf-nicht-ankommen';
    try {
      const file = script(
        join(base, 'a'),
        'if [ -n "$PAGEWISE_TEST_GEHEIM" ]; then echo "LEAK"; else echo "1.2.3"; fi',
      );
      const probe = await probeVersion(file);
      expect(probe).toEqual({ ok: true, version: '1.2.3' });
    } finally {
      delete process.env.PAGEWISE_TEST_GEHEIM;
    }
  });

  it('merkt sich das Ergebnis kurz und prüft auf Wunsch neu', async () => {
    let calls = 0;
    let clock = 0;
    const detector = new CliDetector(
      {
        searchPath: join(base, 'a'),
        ...noExtra,
        probe: async () => {
          calls += 1;
          return { ok: true, version: '1.0.0' };
        },
      },
      1_000,
      () => clock,
    );
    script(join(base, 'a'), good());
    await detector.status();
    await detector.status();
    expect(calls).toBe(1);
    clock = 2_000;
    await detector.status();
    expect(calls).toBe(2);
    await detector.status(true);
    expect(calls).toBe(3);
  });

  it('fasst gleichzeitige Prüfungen zusammen', async () => {
    let calls = 0;
    script(join(base, 'a'), good());
    const detector = new CliDetector({
      searchPath: join(base, 'a'),
      ...noExtra,
      probe: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true, version: '1.0.0' };
      },
    });
    await Promise.all([detector.status(), detector.status(true)]);
    expect(calls).toBe(1);
  });
});
