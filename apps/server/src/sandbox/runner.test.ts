import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SandboxGuard, selfTest } from './probe';
import { runSandboxed, type SandboxResult, sandboxSupported } from './runner';
import { findTestPython } from './test-python';

/**
 * Ausbruchsversuche gegen die echte Sandbox. Sie laufen nur dort, wo es sie gibt (macOS) und ein Python
 * vorhanden ist. Auf anderen Systemen prüft nur der letzte Test, dass nichts ungeschützt startet.
 */
const python = sandboxSupported() ? findTestPython() : null;
const real = python ? describe : describe.skip;

let root: string;
let workspace: string;
let outside: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pagewise-sbx-')));
  workspace = join(root, 'workspaces', 'w1');
  outside = join(root, 'daten');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync(outside, { recursive: true, mode: 0o700 });
  writeFileSync(join(outside, 'geheim.txt'), 'GEHEIMER-INHALT');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
afterAll(() => undefined);

const env = (): Record<string, string> => ({
  PATH: '/usr/bin:/bin',
  HOME: workspace,
  TMPDIR: workspace,
  LANG: 'en_US.UTF-8',
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONNOUSERSITE: '1',
});

async function run(
  script: string,
  limits: Partial<Parameters<typeof runSandboxed>[0]> = {},
): Promise<SandboxResult> {
  if (!python) throw new Error('kein Python');
  writeFileSync(join(workspace, '.script.py'), script, { mode: 0o600 });
  return runSandboxed({
    command: python.python,
    args: ['-s', '.script.py'],
    cwd: workspace,
    workspace,
    readOnly: python.readOnly,
    env: env(),
    timeoutMs: 15_000,
    maxOutputBytes: 1024 * 1024,
    maxMemoryBytes: 1024 * 1024 * 1024,
    killGraceMs: 200,
    watchIntervalMs: 50,
    ...limits,
  });
}

/** Skript, das mehrere Versuche macht und je Name `blocked` oder `allowed` ausgibt. */
const attempts = (body: string) => `import json, os, socket, subprocess, sys
results = {}
def attempt(name, fn):
    try:
        value = fn()
        results[name] = "allowed"
    except BaseException as error:
        results[name] = "blocked"
${body}
print(json.dumps(results))
`;

async function outcome(script: string): Promise<Record<string, string>> {
  const result = await run(script);
  expect(result.reason, result.stderr).toBe('exit');
  return JSON.parse(result.stdout.trim()) as Record<string, string>;
}

real('Sandbox (macOS)', () => {
  it('besteht den Selbsttest', async () => {
    if (!python) return;
    const check = await selfTest({ python: python.python, readOnly: python.readOnly, env: env() });
    expect(check).toEqual({ ok: true, failed: [] });
  });

  it('SandboxGuard prüft je Python nur einmal', async () => {
    if (!python) return;
    const guard = new SandboxGuard();
    const target = { python: python.python, readOnly: python.readOnly, env: env() };
    const first = guard.check(target);
    expect(guard.check(target)).toBe(first);
    expect((await first).ok).toBe(true);
  });

  it('lässt Schreiben im Arbeitsordner zu und liefert die Datei', async () => {
    const result = await run('open("ergebnis.csv", "w").write("a;b\\n1;2\\n")\nprint("fertig")');
    expect(result).toMatchObject({ reason: 'exit', code: 0, stdout: 'fertig\n' });
    expect(readFileSync(join(workspace, 'ergebnis.csv'), 'utf8')).toBe('a;b\n1;2\n');
  });

  it('lässt Pakete laufen, die beim Import Systemdateien lesen (mimetypes)', async () => {
    // Gefunden bei der echten Einrichtung: python-pptx und reportlab importieren `mimetypes`, das `/etc/apache2/mime.types`
    // liest und bei einem Fehler abbricht.
    const result = await run(
      'import mimetypes\nmimetypes.init()\nprint(mimetypes.guess_type("a.pdf")[0])',
    );
    expect(result).toMatchObject({ reason: 'exit', code: 0, stdout: 'application/pdf\n' });
  });

  it('sperrt das Netz, auch wenn auf dem Port jemand lauscht', async () => {
    let connections = 0;
    const server = createServer(() => {
      connections += 1;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const seen = await outcome(
        attempts(`attempt("tcp", lambda: socket.create_connection(("127.0.0.1", ${port}), 2))
attempt("dns", lambda: socket.getaddrinfo("example.com", 443))
attempt("udp", lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("127.0.0.1", ${port})))
attempt("unix", lambda: socket.socket(socket.AF_UNIX).connect("/var/run/mDNSResponder"))`),
      );
      expect(seen).toEqual({ tcp: 'blocked', dns: 'blocked', udp: 'blocked', unix: 'blocked' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(connections).toBe(0);
    } finally {
      server.close();
    }
  });

  it('sperrt Schreiben außerhalb des Arbeitsordners, auch mit ../', async () => {
    const seen = await outcome(
      attempts(`attempt("absolut", lambda: open(${JSON.stringify(join(outside, 'neu.txt'))}, "w").write("x"))
attempt("relativ", lambda: open("../../daten/neu2.txt", "w").write("x"))
attempt("ueberschreiben", lambda: open(${JSON.stringify(join(outside, 'geheim.txt'))}, "w").write("x"))
attempt("loeschen", lambda: os.remove(${JSON.stringify(join(outside, 'geheim.txt'))}))
attempt("umbenennen", lambda: os.rename(${JSON.stringify(join(outside, 'geheim.txt'))}, "mein.txt"))
attempt("mkdir", lambda: os.mkdir(${JSON.stringify(join(outside, 'ordner'))}))`),
    );
    expect(Object.values(seen).every((value) => value === 'blocked')).toBe(true);
    expect(existsSync(join(outside, 'neu.txt'))).toBe(false);
    expect(existsSync(join(outside, 'neu2.txt'))).toBe(false);
    expect(readFileSync(join(outside, 'geheim.txt'), 'utf8')).toBe('GEHEIMER-INHALT');
  });

  it('sperrt Lesen außerhalb: Datenverzeichnis, Benutzerverzeichnis, Systemdateien', async () => {
    const seen = await outcome(
      attempts(`attempt("daten", lambda: open(${JSON.stringify(join(outside, 'geheim.txt'))}).read())
attempt("daten_liste", lambda: os.listdir(${JSON.stringify(outside)}))
attempt("home", lambda: os.listdir(${JSON.stringify(process.env.HOME ?? '/Users')}))
attempt("users", lambda: os.listdir("/Users"))
attempt("hosts", lambda: open("/etc/hosts").read())
attempt("var_db", lambda: os.listdir("/private/var/db"))
attempt("tmp", lambda: os.listdir("/private/tmp"))
attempt("volumes", lambda: os.listdir("/Volumes"))`),
    );
    expect(Object.values(seen).every((value) => value === 'blocked')).toBe(true);
  });

  it('folgt keinem Symlink aus dem Arbeitsordner heraus', async () => {
    symlinkSync(join(outside, 'geheim.txt'), join(workspace, 'link.txt'));
    symlinkSync(outside, join(workspace, 'ordner'));
    const seen = await outcome(
      attempts(`attempt("datei", lambda: open("link.txt").read())
attempt("ordner", lambda: os.listdir("ordner"))
attempt("neu", lambda: os.symlink(${JSON.stringify(outside)}, "neuer-link"))
attempt("neu_lesen", lambda: os.listdir("neuer-link"))`),
    );
    expect(seen.datei).toBe('blocked');
    expect(seen.ordner).toBe('blocked');
    expect(seen.neu_lesen).toBe('blocked');
  });

  it('sperrt Schreiben in Python selbst', async () => {
    if (!python) return;
    const target = join(python.readOnly[0] as string, 'eingeschleust.py');
    const seen = await outcome(
      attempts(`attempt("python", lambda: open(${JSON.stringify(target)}, "w").write("x"))`),
    );
    expect(seen.python).toBe('blocked');
    expect(existsSync(target)).toBe(false);
  });

  it('startet keine Kindprozesse', async () => {
    const seen = await outcome(
      attempts(`attempt("subprocess", lambda: subprocess.run(["/bin/echo", "x"], timeout=5))
attempt("system", lambda: os.system("/bin/echo x") == 0 or (_ for _ in ()).throw(OSError()))
attempt("fork", lambda: os.fork())
attempt("popen", lambda: os.popen("/bin/echo x").read() or (_ for _ in ()).throw(OSError()))`),
    );
    expect(Object.values(seen).every((value) => value === 'blocked')).toBe(true);
  });

  it('sieht keine Schlüssel aus der Umgebung des Servers', async () => {
    process.env.PAGEWISE_TEST_GEHEIM = 'sk-nicht-weitergeben';
    try {
      const result = await run('import os\nprint(sorted(os.environ))');
      expect(result.stdout).not.toContain('PAGEWISE_TEST_GEHEIM');
      expect(result.stdout).not.toContain('HOME_ORIGINAL');
    } finally {
      delete process.env.PAGEWISE_TEST_GEHEIM;
    }
  });

  it('beendet eine Endlosschleife nach dem Zeitlimit', async () => {
    const result = await run('while True:\n    pass', { timeoutMs: 600 });
    expect(result.reason).toBe('timeout');
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it('beendet unendliche Ausgabe', async () => {
    const result = await run('while True:\n    print("x" * 1000)', { maxOutputBytes: 200 * 1024 });
    expect(result.reason).toBe('output_limit');
    expect(result.outputTruncated).toBe(true);
  });

  it('beendet zu hohen Speicherverbrauch', async () => {
    const result = await run(
      'import time\nkeep = []\nwhile True:\n    keep.append(bytearray(64 * 1024 * 1024))\n    time.sleep(0.02)',
      { maxMemoryBytes: 400 * 1024 * 1024, timeoutMs: 30_000 },
    );
    expect(result.reason).toBe('memory_limit');
  });

  it('beendet das Füllen der Platte', async () => {
    const result = await run(
      'import time\ni = 0\nwhile True:\n    open(f"f{i}.bin", "wb").write(bytes(2 * 1024 * 1024))\n    i += 1\n    time.sleep(0.01)',
      { watchDir: workspace, maxDirBytes: 20 * 1024 * 1024, timeoutMs: 30_000 },
    );
    expect(result.reason).toBe('disk_limit');
  });

  it('meldet Fehler des Skripts mit Austrittscode und stderr', async () => {
    const result = await run('raise ValueError("kaputt")');
    expect(result.reason).toBe('exit');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ValueError: kaputt');
  });

  it('bricht bei „Stopp“ ab', async () => {
    const controller = new AbortController();
    const pending = run('while True:\n    pass', { signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    expect((await pending).reason).toBe('cancelled');
  });
});

describe('ohne Sandbox', () => {
  it('startet nichts, wo es keine gibt', async () => {
    writeFileSync(join(workspace, 'x.txt'), 'x');
    const result = await runSandboxed(
      {
        command: process.execPath,
        args: ['-e', 'require("fs").writeFileSync("lief.txt", "ja")'],
        cwd: workspace,
        workspace,
        readOnly: [],
        env: {},
        timeoutMs: 5_000,
        maxOutputBytes: 1024,
        maxMemoryBytes: 1e9,
      },
      'linux',
    );
    expect(result.reason).toBe('unavailable');
    expect(existsSync(join(workspace, 'lief.txt'))).toBe(false);
  });

  it('startet auch nicht, wenn das Profil nicht entsteht', async () => {
    const result = await runSandboxed(
      {
        command: process.execPath,
        args: ['-e', ''],
        cwd: workspace,
        workspace: join(root, 'gibt-es-nicht'),
        readOnly: [],
        env: {},
        timeoutMs: 5_000,
        maxOutputBytes: 1024,
        maxMemoryBytes: 1e9,
      },
      'darwin',
    );
    expect(result.reason).toBe('unavailable');
  });
});
