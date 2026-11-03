import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LimitedSpec, runLimited, treeStats } from './run-limited';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pagewise-limited-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const node = (code: string, extra: Partial<LimitedSpec> = {}): LimitedSpec => ({
  command: process.execPath,
  args: ['-e', code],
  cwd: dir,
  env: { PATH: '/usr/bin:/bin' },
  timeoutMs: 10_000,
  maxOutputBytes: 1024 * 1024,
  maxMemoryBytes: 2 * 1024 * 1024 * 1024,
  killGraceMs: 200,
  watchIntervalMs: 50,
  ...extra,
});

describe('runLimited', () => {
  it('liefert Ausgabe und Austrittscode', async () => {
    const result = await runLimited(
      node('console.log("hallo"); console.error("fehler"); process.exit(3)'),
    );
    expect(result).toMatchObject({
      reason: 'exit',
      code: 3,
      stdout: 'hallo\n',
      stderr: 'fehler\n',
    });
  });

  it('übernimmt nichts aus der Umgebung des Servers', async () => {
    process.env.PAGEWISE_TEST_SECRET = 'geheim';
    try {
      const result = await runLimited(
        node('console.log(Object.keys(process.env).sort().join(","))'),
      );
      // macOS fügt `__CF_USER_TEXT_ENCODING` selbst hinzu; alles andere müsste vom Server stammen.
      const keys = result.stdout
        .trim()
        .split(',')
        .filter((key) => !key.startsWith('__CF'));
      expect(keys).toEqual(['PATH']);
    } finally {
      delete process.env.PAGEWISE_TEST_SECRET;
    }
  });

  it('reicht Argumente wörtlich weiter, ohne Shell', async () => {
    const result = await runLimited({
      ...node(''),
      args: [
        '-e',
        'console.log(process.argv.slice(1).join("|"))',
        '$(echo x)',
        ';',
        '&& id',
        '`id`',
      ],
    });
    expect(result.stdout.trim()).toBe('$(echo x)|;|&& id|`id`');
  });

  it('beendet nach dem Zeitlimit', async () => {
    const result = await runLimited(node('setInterval(() => {}, 1000)', { timeoutMs: 300 }));
    expect(result.reason).toBe('timeout');
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it('beendet bei zu viel Ausgabe und behält nur einen Anfang', async () => {
    const result = await runLimited(
      node('const b = "x".repeat(65536); setInterval(() => process.stdout.write(b), 1)', {
        maxOutputBytes: 256 * 1024,
        keepBytes: 1024,
      }),
    );
    expect(result.reason).toBe('output_limit');
    expect(result.outputTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });

  it('behält vom Fehlerstrom das Ende', async () => {
    const result = await runLimited(
      node('console.error("a".repeat(5000)); console.error("ENDE")', { keepBytes: 100 }),
    );
    expect(result.stderr.endsWith('ENDE\n')).toBe(true);
    expect(result.stderr.length).toBeLessThanOrEqual(100);
    expect(result.outputTruncated).toBe(true);
  });

  it('beendet bei zu viel Speicher', async () => {
    const result = await runLimited(
      node('const keep = []; setInterval(() => keep.push(Buffer.alloc(32 * 1024 * 1024, 1)), 20)', {
        maxMemoryBytes: 200 * 1024 * 1024,
        timeoutMs: 20_000,
      }),
    );
    expect(result.reason).toBe('memory_limit');
  });

  it('beendet, wenn der Arbeitsordner zu groß wird', async () => {
    const result = await runLimited(
      node(
        'const fs = require("fs"); let i = 0; setInterval(() => fs.writeFileSync("f" + i++ + ".bin", Buffer.alloc(1024 * 1024, 1)), 10)',
        { watchDir: dir, maxDirBytes: 8 * 1024 * 1024, timeoutMs: 20_000 },
      ),
    );
    expect(result.reason).toBe('disk_limit');
  });

  it('beendet, wenn zu viele Dateien entstehen', async () => {
    const result = await runLimited(
      node(
        'const fs = require("fs"); let i = 0; setInterval(() => { for (let k = 0; k < 50; k++) fs.writeFileSync("f" + i++ + ".txt", "x") }, 10)',
        { watchDir: dir, maxDirBytes: 1e9, maxDirEntries: 300, timeoutMs: 20_000 },
      ),
    );
    expect(result.reason).toBe('disk_limit');
  });

  it('bricht ab, wenn die Person „Stopp“ drückt', async () => {
    const controller = new AbortController();
    const pending = runLimited(node('setInterval(() => {}, 1000)', { signal: controller.signal }));
    setTimeout(() => controller.abort(), 150);
    const result = await pending;
    expect(result.reason).toBe('cancelled');
  });

  it('startet gar nicht, wenn schon abgebrochen wurde', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runLimited(node('console.log("läuft")', { signal: controller.signal }));
    expect(result).toMatchObject({ reason: 'cancelled', stdout: '' });
  });

  it('beendet die ganze Prozessgruppe, auch Kindprozesse', async () => {
    const marker = join(dir, 'kind.pid');
    const child = `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`;
    const parent = `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "ignore" }); setInterval(() => {}, 1000)`;
    const result = await runLimited(node(parent, { timeoutMs: 800 }));
    expect(result.reason).toBe('timeout');
    const { readFileSync } = await import('node:fs');
    const pid = Number(readFileSync(marker, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('meldet ein fehlendes Programm als spawn_failed', async () => {
    const result = await runLimited({ ...node(''), command: join(dir, 'gibt-es-nicht') });
    expect(result.reason).toBe('spawn_failed');
  });
});

describe('treeStats', () => {
  it('zählt Bytes und Einträge, auch versteckte', () => {
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a', 'x.bin'), Buffer.alloc(100));
    writeFileSync(join(dir, '.hidden'), Buffer.alloc(50));
    expect(treeStats(dir, 100)).toEqual({ bytes: 150, entries: 3 });
  });

  it('bricht bei zu vielen Einträgen ab', () => {
    for (let i = 0; i < 20; i += 1) writeFileSync(join(dir, `f${i}`), 'x');
    expect(treeStats(dir, 5).entries).toBeGreaterThan(5);
  });
});
