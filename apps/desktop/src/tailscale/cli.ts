import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Das Programm `tailscale` finden und aufrufen. Die App aus Finder oder Anmeldung hat nur einen knappen `PATH`,
 * deshalb gibt es feste Orte (zuerst die App von Tailscale, deren Programm auch als Befehlszeile dient). Aufrufe laufen
 * mit `execFile` (ohne Shell), mit Zeitlimit und mit einer minimalen Umgebung, nie mit Schlüsseln.
 */
export const CLI_CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
] as const;

export interface ExecResult {
  /** Das Programm ließ sich starten (auch wenn es mit Fehler endete). */
  spawned: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Exec = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<ExecResult>;

const MAX_OUTPUT = 4 * 1024 * 1024;

/** `execFile` mit minimaler Umgebung (kein `process.env` als Ganzes). */
export function realExec(source: NodeJS.ProcessEnv = process.env): Exec {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR']) {
    const value = source[name];
    if (typeof value === 'string') env[name] = value;
  }
  return (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, env, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          const spawnFailed = failure?.code === 'ENOENT' || failure?.code === 'EACCES';
          resolve({
            spawned: !spawnFailed,
            code: failure ? (typeof failure.code === 'number' ? failure.code : null) : 0,
            stdout: String(stdout),
            stderr: String(stderr),
            timedOut: failure?.killed === true,
          });
        },
      );
    });
}

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function candidatePaths(pathEnv: string | undefined): string[] {
  const dirs = (pathEnv ?? '').split(delimiter).filter(Boolean);
  return [...new Set([...CLI_CANDIDATES, ...dirs.map((dir) => join(dir, 'tailscale'))])];
}

export interface FoundCli {
  path: string;
  /** Ergebnis von `status --json` mit diesem Programm. */
  status: ExecResult;
}

const STATUS_TIMEOUT_MS = 6_000;

/**
 * Probiert die Kandidaten der Reihe nach mit `status --json`. Der erste, der sich starten lässt und wie Tailscale
 * antwortet (JSON oder eine Tailscale-Fehlermeldung), gewinnt. Gibt `null` zurück, wenn es keines gibt.
 */
export async function findCli(
  exec: Exec,
  options: { exists?: (path: string) => boolean; pathEnv?: string; timeoutMs?: number } = {},
): Promise<FoundCli | null> {
  const exists = options.exists ?? isExecutableFile;
  for (const path of candidatePaths(options.pathEnv ?? process.env.PATH)) {
    if (!exists(path)) continue;
    const status = await exec(path, ['status', '--json'], options.timeoutMs ?? STATUS_TIMEOUT_MS);
    if (!status.spawned) continue;
    if (looksLikeTailscale(status)) return { path, status };
  }
  return null;
}

/** JSON mit `BackendState` oder eine Meldung, die Tailscale nennt (Dienst läuft nicht, abgemeldet …). */
export function looksLikeTailscale(result: ExecResult): boolean {
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (typeof value === 'object' && value !== null && 'BackendState' in value) return true;
  } catch {
    // keine JSON-Antwort
  }
  return /tailscale/i.test(result.stderr) || /tailscale/i.test(result.stdout);
}
