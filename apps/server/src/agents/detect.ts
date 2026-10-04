import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Findet das Programm „claude“ (Claude Code) auf diesem Rechner. Es zählt nur, was wirklich läuft:
 * Jeder Kandidat wird mit `--version` gestartet, der erste funktionierende gewinnt. So wird ein defekter
 * Platzhalter (z. B. ein Wrapper, der auf eine nicht mehr vorhandene App zeigt) übersprungen, statt
 * Pagewise zu blockieren, wenn weiter hinten im Pfad eine funktionierende Installation liegt.
 *
 * Pagewise startet nur die vom Hersteller veröffentlichte, unveränderte Binary (siehe docs/agent-cli.md).
 */

export type RejectedReason = 'not_executable' | 'failed' | 'timeout' | 'bad_output';

export interface RejectedCli {
  path: string;
  reason: RejectedReason;
}

export type CliStatus =
  /** Gefunden und lauffähig. `skipped` nennt Kandidaten, die vorher geprüft wurden und nicht liefen. */
  | { state: 'ready'; path: string; version: string; skipped: RejectedCli[] }
  /** Es gibt keinen Kandidaten. */
  | { state: 'missing'; skipped: [] }
  /** Es gibt Kandidaten, aber keiner läuft. */
  | { state: 'broken'; skipped: RejectedCli[] };

export interface DetectOptions {
  /**
   * Ausdrücklich gesetzter Pfad (Einstellung der Person, `PAGEWISE_CLAUDE_PATH`). Er wird zuerst geprüft. Eine
   * Funktion wird bei jeder Suche neu gefragt, damit eine geänderte Einstellung sofort gilt.
   */
  explicitPath?: string | null | (() => string | null);
  /** Suchpfad. Standard: `PATH` des Servers. */
  searchPath?: string;
  /** Zusätzliche Ordner, in denen Installationen üblich sind (macOS, npm, nvm, Homebrew). */
  extraDirs?: string[];
  /** Name der Datei. Nur für Tests. */
  binaryName?: string;
  timeoutMs?: number;
  /** Nur für Tests: ersetzt den Start des Programms. */
  probe?: (path: string, timeoutMs: number) => Promise<ProbeResult>;
}

export type ProbeResult =
  | { ok: true; version: string }
  | { ok: false; reason: Exclude<RejectedReason, 'not_executable'> };

const VERSION = /^(\d+\.\d+\.\d+\S*)/;
const PROBE_TIMEOUT_MS = 8_000;

/** Übliche Orte, falls der Server mit einem knappen `PATH` gestartet wurde (z. B. über launchd). */
export function defaultExtraDirs(home = homedir()): string[] {
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  try {
    const nvm = join(home, '.nvm', 'versions', 'node');
    for (const version of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, version, 'bin'));
  } catch {
    // kein nvm
  }
  return dirs;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Startet `<programm> --version` mit minimaler Umgebung und kurzem Zeitlimit. */
export function probeVersion(path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      path,
      ['--version'],
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        // Nur das Nötigste: `--version` braucht weder Konten noch Schlüssel.
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'C' },
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          const timedOut = (error as { killed?: boolean }).killed === true;
          resolve({ ok: false, reason: timedOut ? 'timeout' : 'failed' });
          return;
        }
        const match = VERSION.exec(String(stdout).trim());
        resolve(match?.[1] ? { ok: true, version: match[1] } : { ok: false, reason: 'bad_output' });
      },
    );
  });
}

export async function detectClaude(options: DetectOptions = {}): Promise<CliStatus> {
  const name = options.binaryName ?? 'claude';
  const searchPath = options.searchPath ?? process.env.PATH ?? '';
  const probe = options.probe ?? probeVersion;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;

  const dirs = [...searchPath.split(delimiter), ...(options.extraDirs ?? defaultExtraDirs())];
  const candidates: string[] = [];
  const explicit =
    typeof options.explicitPath === 'function' ? options.explicitPath() : options.explicitPath;
  if (explicit) candidates.push(explicit);
  for (const dir of dirs) if (dir) candidates.push(join(dir, name));

  const seen = new Set<string>();
  const skipped: RejectedCli[] = [];
  let found = false;
  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) continue;
    // Derselbe Ort über mehrere Pfade (Symlinks) wird nur einmal geprüft.
    let real = candidate;
    try {
      real = realpathSync(candidate);
    } catch {
      // Kann der Pfad nicht aufgelöst werden, gilt der Kandidat selbst.
    }
    if (seen.has(real)) continue;
    seen.add(real);
    found = true;
    const result = await probe(candidate, timeoutMs);
    if (result.ok) return { state: 'ready', path: candidate, version: result.version, skipped };
    skipped.push({ path: candidate, reason: result.reason });
  }
  return found ? { state: 'broken', skipped } : { state: 'missing', skipped: [] };
}

/** Merkt sich das Ergebnis kurz, damit nicht jede Seitenansicht Programme startet. */
export class CliDetector {
  private cached: { at: number; status: CliStatus } | null = null;
  private pending: Promise<CliStatus> | null = null;

  constructor(
    private readonly options: DetectOptions = {},
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async status(refresh = false): Promise<CliStatus> {
    if (!refresh && this.cached && this.now() - this.cached.at < this.ttlMs) {
      return this.cached.status;
    }
    this.pending ??= detectClaude(this.options)
      .then((status) => {
        this.cached = { at: this.now(), status };
        return status;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
