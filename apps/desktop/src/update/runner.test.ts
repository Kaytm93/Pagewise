import { describe, expect, it } from 'vitest';
import { cleanLine, LineSplitter, spawnRunner } from './runner';

const ESC = String.fromCharCode(27);

describe('Zeilen aus fremder Ausgabe', () => {
  it('entfernt Farbcodes und Steuerzeichen und kürzt überlange Zeilen', () => {
    expect(cleanLine(`${ESC}[31mrot${ESC}[0m  `)).toBe('rot');
    expect(cleanLine('a\u0000b\u0007c')).toBe('abc');
    expect(cleanLine('x'.repeat(1000)).length).toBeLessThan(410);
  });

  it('setzt Zeilen über Stückgrenzen zusammen und behandelt auch \\r als Zeilenende', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('eins\nzw')).toEqual(['eins']);
    expect(splitter.push('ei\r\ndrei\rvier')).toEqual(['zwei', 'drei']);
    expect(splitter.flush()).toEqual(['vier']);
    expect(splitter.flush()).toEqual([]);
  });
});

describe('Programme starten', () => {
  const env = { PATH: process.env.PATH ?? '' };
  const run = (script: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) => {
    const lines: string[] = [];
    return spawnRunner()(process.execPath, ['-e', script], {
      env,
      timeoutMs: options.timeoutMs ?? 20_000,
      signal: options.signal,
      onLine: (line) => lines.push(line),
    }).then((result) => ({ result, lines }));
  };

  it('liefert Ausgabe zeilenweise, Exit-Code und die letzten Zeilen', async () => {
    const { result, lines } = await run("console.log('a'); console.error('b'); process.exit(3)");
    expect(result.code).toBe(3);
    expect(lines.sort()).toEqual(['a', 'b']);
    expect(result.tail.sort()).toEqual(['a', 'b']);
    expect(result).toMatchObject({ spawnFailed: false, timedOut: false, aborted: false });
  });

  it('übergibt nur die angegebene Umgebung', async () => {
    process.env.PAGEWISE_TEST_GEHEIM = 'x';
    try {
      const { lines } = await run('console.log(String(process.env.PAGEWISE_TEST_GEHEIM))');
      expect(lines).toEqual(['undefined']);
    } finally {
      delete process.env.PAGEWISE_TEST_GEHEIM;
    }
  });

  it('meldet ein fehlendes Programm als nicht gestartet', async () => {
    const result = await spawnRunner()('/gibt/es/nicht', [], { env, timeoutMs: 5_000 });
    expect(result.spawnFailed).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it('beendet ein Programm nach dem Zeitlimit', async () => {
    const { result } = await run('setInterval(() => {}, 1000)', { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });

  it('bricht auf Wunsch ab, auch ein schon laufendes Programm', async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 300);
    const { result } = await run('setInterval(() => {}, 1000)', { signal: abort.signal });
    expect(result.aborted).toBe(true);
    const already = new AbortController();
    already.abort();
    const early = await run('console.log("nie")', { signal: already.signal });
    expect(early.result.aborted).toBe(true);
    expect(early.lines).toEqual([]);
  });
});
