import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessRun, type RunSpec } from './process';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const node = process.execPath;

function spec(script: string, extra: Partial<RunSpec> = {}): RunSpec {
  return {
    command: node,
    args: ['-e', script],
    cwd: base,
    env: { PATH: process.env.PATH ?? '' },
    stdin: '',
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
    maxLineBytes: 64 * 1024,
    killGraceMs: 200,
    ...extra,
  };
}

async function collect(run: ProcessRun): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of run.lines) lines.push(line);
  return lines;
}

describe('ProcessRun', () => {
  it('liefert die Ausgabe zeilenweise, auch eine letzte Zeile ohne Zeilenumbruch, und lässt Leerzeilen weg', async () => {
    const run = new ProcessRun(spec(`process.stdout.write('eins\\n\\n  \\nzwei\\r\\ndrei')`));
    expect(await collect(run)).toEqual(['eins', 'zwei\r', 'drei']);
    expect(await run.ended).toMatchObject({ code: 0, reason: 'exit' });
  });

  it('übergibt den Auftrag über stdin, auch wenn er größer als der Pipe-Puffer ist', async () => {
    const prompt = 'ä'.repeat(200_000);
    const run = new ProcessRun(
      spec(
        `let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>console.log(JSON.stringify({bytes:n})))`,
        { stdin: prompt },
      ),
    );
    expect(await collect(run)).toEqual([JSON.stringify({ bytes: Buffer.byteLength(prompt) })]);
  });

  it('gibt den Auftrag nie als Argument weiter', async () => {
    const run = new ProcessRun(
      spec(`console.log(JSON.stringify(process.argv.slice(1)))`, { stdin: 'geheimer Schulinhalt' }),
    );
    const [line] = await collect(run);
    expect(line).toBe('[]');
    expect(line).not.toContain('geheimer');
  });

  it('übernimmt keine Umgebungsvariablen des Servers', async () => {
    process.env.PAGEWISE_TEST_GEHEIM = 'darf-nicht-ankommen';
    try {
      const run = new ProcessRun(
        spec(
          `console.log(JSON.stringify(Object.keys(process.env).filter(k=>/PAGEWISE|GEHEIM/.test(k))))`,
          {
            env: { PATH: process.env.PATH ?? '', PAGEWISE_ERLAUBT: '1' },
          },
        ),
      );
      expect(await collect(run)).toEqual(['["PAGEWISE_ERLAUBT"]']);
    } finally {
      delete process.env.PAGEWISE_TEST_GEHEIM;
    }
  });

  it('läuft im vorgegebenen Arbeitsverzeichnis', async () => {
    const run = new ProcessRun(spec(`console.log(process.cwd())`));
    const [line] = await collect(run);
    expect(await import('node:fs').then((fs) => fs.realpathSync(line ?? ''))).toBe(
      await import('node:fs').then((fs) => fs.realpathSync(base)),
    );
  });

  it('hält stderr zurück: nie in den Zeilen, nur in stderrTail, und begrenzt', async () => {
    const run = new ProcessRun(
      spec(`process.stderr.write('x'.repeat(100000)+'ENDE');console.log('ok')`),
    );
    expect(await collect(run)).toEqual(['ok']);
    await run.ended;
    expect(run.stderrTail().endsWith('ENDE')).toBe(true);
    expect(run.stderrTail().length).toBeLessThanOrEqual(2 * 16 * 1024 + 64 * 1024);
  });

  it('beendet nach dem Zeitlimit', async () => {
    const run = new ProcessRun(spec(`setInterval(()=>{},1000)`, { timeoutMs: 150 }));
    const end = await run.ended;
    expect(end.reason).toBe('timeout');
    expect(end.signal).toBe('SIGTERM');
  });

  it('bricht auf Wunsch ab', async () => {
    const run = new ProcessRun(spec(`console.log('läuft');setInterval(()=>{},1000)`));
    const iterator = run.lines[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe('läuft');
    run.cancel();
    expect(await run.ended).toMatchObject({ reason: 'cancelled', signal: 'SIGTERM' });
  });

  it('geht die Stufen der Reihe nach durch: erst SIGINT, dann SIGTERM, dann SIGKILL', async () => {
    const script = `
      process.on('SIGINT',()=>console.log('int'));
      process.on('SIGTERM',()=>console.log('term'));
      console.log('bereit');
      setInterval(()=>{},1000);
    `;
    const run = new ProcessRun(
      spec(script, { escalation: ['SIGINT', 'SIGTERM', 'SIGKILL'], killGraceMs: 250 }),
    );
    const iterator = run.lines[Symbol.asyncIterator]();
    await iterator.next();
    run.cancel();
    const seen: string[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      seen.push(next.value);
    }
    expect(seen).toEqual(['int', 'term']);
    expect(await run.ended).toMatchObject({ reason: 'cancelled', signal: 'SIGKILL' });
  });

  it('endet schon bei der ersten Stufe, wenn das Programm darauf hört', async () => {
    const run = new ProcessRun(
      spec(`console.log('bereit');setInterval(()=>{},1000)`, {
        escalation: ['SIGINT', 'SIGTERM', 'SIGKILL'],
        killGraceMs: 5_000,
      }),
    );
    await run.lines[Symbol.asyncIterator]().next();
    const started = Date.now();
    run.cancel();
    expect(await run.ended).toMatchObject({ reason: 'cancelled', signal: 'SIGINT' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('greift hart durch, wenn der Prozess SIGTERM ignoriert', async () => {
    const run = new ProcessRun(
      spec(`process.on('SIGTERM',()=>{});console.log('bereit');setInterval(()=>{},1000)`),
    );
    const iterator = run.lines[Symbol.asyncIterator]();
    await iterator.next();
    run.cancel();
    expect(await run.ended).toMatchObject({ reason: 'cancelled', signal: 'SIGKILL' });
  });

  it('beendet auch Kindprozesse (ganze Prozessgruppe)', async () => {
    const pidFile = join(base, 'kind.pid');
    const script = `
      const { spawn } = require('node:child_process');
      const kid = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));
      console.log('gestartet');
      setInterval(()=>{},1000);
    `;
    const run = new ProcessRun(spec(script));
    const iterator = run.lines[Symbol.asyncIterator]();
    await iterator.next();
    const kidPid = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(kidPid, 0)).not.toThrow();
    run.cancel();
    await run.ended;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(kidPid, 0)).toThrow();
  });

  it('bricht bei zu viel Ausgabe ab', async () => {
    const run = new ProcessRun(
      spec(`for(;;){process.stdout.write('x'.repeat(100)+'\\n')}`, { maxOutputBytes: 5_000 }),
    );
    const lines = await collect(run);
    expect(lines.length).toBeLessThan(80);
    expect((await run.ended).reason).toBe('output_limit');
  });

  it('bricht bei einer zu langen Zeile ab, ohne sie weiterzugeben', async () => {
    const run = new ProcessRun(
      spec(`console.log('kurz');process.stdout.write('y'.repeat(5000));setInterval(()=>{},1000)`, {
        maxLineBytes: 1_000,
      }),
    );
    const lines = await collect(run);
    expect(lines).toEqual(['kurz']);
    expect((await run.ended).reason).toBe('output_limit');
  });

  it('meldet einen Programmstart, der scheitert, und beendet die Zeilen', async () => {
    const run = new ProcessRun({
      ...spec(''),
      command: join(base, 'gibt-es-nicht'),
    });
    expect(await collect(run)).toEqual([]);
    expect(await run.ended).toMatchObject({ code: null, reason: 'spawn_failed' });
  });

  it('meldet den Exit-Code eines Programms, das mit Fehler endet', async () => {
    const run = new ProcessRun(spec(`console.log('x');process.exit(3)`));
    await collect(run);
    expect(await run.ended).toMatchObject({ code: 3, reason: 'exit' });
  });

  it('beschädigt Mehrbyte-Zeichen nicht, die über Blockgrenzen laufen', async () => {
    const text = 'Schöne Grüße ü'.repeat(5000);
    const file = join(base, 'text.txt');
    writeFileSync(file, `${text}\n`);
    const run = new ProcessRun(
      spec(`process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)}))`, {
        maxLineBytes: 1024 * 1024,
      }),
    );
    expect(await collect(run)).toEqual([text]);
    expect(existsSync(file)).toBe(true);
  });
});
