import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandboxed, sandboxSupported } from './runner';

/**
 * Selbsttest der Sandbox (fail closed): Ein Probeskript versucht in der Sandbox, was ein Skript des Modells nicht
 * dürfen soll, und dazu das Eine, was es darf. Nur wenn alles wie erwartet ausgeht, bietet Pagewise Code-Ausführung
 * an. Der Test läuft bei der Einrichtung und einmal je Serverstart, nicht bei jedem Lauf.
 */

/** Fester Text, kein Eingabewert. Gibt je Versuch `blocked` oder `allowed` als JSON aus. */
export const PROBE_SCRIPT = `import json, os, socket, subprocess, sys
outside, home = sys.argv[1], sys.argv[2]
def attempt(fn):
    try:
        fn()
        return "allowed"
    except BaseException:
        return "blocked"
def write(path):
    with open(path, "w") as handle:
        handle.write("x")
print(json.dumps({
    "net": attempt(lambda: socket.create_connection(("127.0.0.1", 9), 1)),
    "dns": attempt(lambda: socket.getaddrinfo("example.com", 80)),
    "outside_write": attempt(lambda: write(os.path.join(outside, "probe.txt"))),
    "home_read": attempt(lambda: os.listdir(home)),
    "fork": attempt(lambda: subprocess.run(["/bin/echo", "x"], timeout=5)),
    "workspace_write": attempt(lambda: write("probe-out.txt")),
}))
`;

const EXPECTED: Record<string, 'blocked' | 'allowed'> = {
  net: 'blocked',
  dns: 'blocked',
  outside_write: 'blocked',
  home_read: 'blocked',
  fork: 'blocked',
  workspace_write: 'allowed',
};

export interface SandboxCheck {
  ok: boolean;
  /** Namen der Versuche, die nicht wie erwartet ausgingen, oder `unavailable` / `probe_failed`. */
  failed: string[];
}

export interface ProbeTarget {
  /** Python, mit dem das Probeskript läuft (dasselbe wie für echte Läufe). */
  python: string;
  readOnly: readonly string[];
  env: Readonly<Record<string, string>>;
}

export async function selfTest(target: ProbeTarget): Promise<SandboxCheck> {
  if (!sandboxSupported()) return { ok: false, failed: ['unavailable'] };
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pw-sbx-')));
  const workspace = join(root, 'ws');
  const outside = join(root, 'outside');
  try {
    mkdirSync(workspace, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(workspace, '.probe.py'), PROBE_SCRIPT, { mode: 0o600 });
    const result = await runSandboxed({
      command: target.python,
      args: ['-s', '.probe.py', outside, homedir()],
      cwd: workspace,
      workspace,
      readOnly: target.readOnly,
      env: target.env,
      timeoutMs: 20_000,
      maxOutputBytes: 64 * 1024,
      maxMemoryBytes: 512 * 1024 * 1024,
    });
    if (result.reason === 'unavailable') return { ok: false, failed: ['unavailable'] };
    if (result.reason !== 'exit' || result.code !== 0)
      return { ok: false, failed: ['probe_failed'] };
    let seen: Record<string, unknown>;
    try {
      seen = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    } catch {
      return { ok: false, failed: ['probe_failed'] };
    }
    const failed = Object.entries(EXPECTED)
      .filter(([name, expected]) => seen[name] !== expected)
      .map(([name]) => name);
    return { ok: failed.length === 0, failed };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Merkt sich das Ergebnis je Python, damit der Test nicht bei jeder Anfrage läuft. */
export class SandboxGuard {
  private readonly cache = new Map<string, Promise<SandboxCheck>>();

  check(target: ProbeTarget): Promise<SandboxCheck> {
    const key = `${target.python}|${[...target.readOnly].join(':')}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = selfTest(target);
      this.cache.set(key, pending);
    }
    return pending;
  }

  /** Nach einer neuen Einrichtung oder einem Fehler neu prüfen. */
  reset(): void {
    this.cache.clear();
  }
}
