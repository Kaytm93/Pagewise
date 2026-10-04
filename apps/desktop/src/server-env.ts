import { delimiter, join } from 'node:path';

/**
 * Umgebung des Serverprozesses: eine feste Allowlist, nie `process.env` der App. Schlüssel anderer Anbieter,
 * Proxy-Einstellungen oder fremde `PAGEWISE_*`-Variablen aus der Umgebung, aus der die App gestartet wurde, erreichen
 * den Server nicht. Der Server gibt daraus seinerseits nur eine Allowlist an `claude` weiter (`agents/env.ts`).
 * Secrets stehen nie in Argumenten (sichtbar in der Prozessliste).
 */
export const SERVER_PASSTHROUGH_ENV = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
] as const;

/** Orte, an denen `claude` auf dem Mac üblicherweise liegt (eine aus Finder oder Anmeldung gestartete App hat nur einen knappen PATH). */
export function extraPathDirs(home: string): string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
  ];
}

export interface ServerEnvInput {
  /** Umgebung der App (nur die Allowlist wird gelesen). */
  source: NodeJS.ProcessEnv;
  port: number;
  host: string;
  /** Ordner mit `pagewise-embedded.mjs`, `better_sqlite3.node` und den Ressourcen. */
  serverDir: string;
  /** Eigenes Datenverzeichnis. Ohne Angabe gilt der Standard des Servers (`~/Library/Application Support/Pagewise`). */
  dataDir?: string | null;
  /** Ausdrücklich eingestellter Pfad zu `claude`. */
  claudePath?: string | null;
}

export function buildServerEnv(input: ServerEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SERVER_PASSTHROUGH_ENV) {
    const value = input.source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  const home = env.HOME ?? '';
  const base = (input.source.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin').split(delimiter);
  env.PATH = [...new Set([...base, ...(home ? extraPathDirs(home) : [])])]
    .filter(Boolean)
    .join(delimiter);

  env.NODE_ENV = 'production';
  env.PAGEWISE_PORT = String(input.port);
  env.PAGEWISE_HOST = input.host;
  env.PAGEWISE_RESOURCES_DIR = input.serverDir;
  env.PAGEWISE_SQLITE_BINDING = join(input.serverDir, 'better_sqlite3.node');
  if (input.dataDir) env.PAGEWISE_DATA_DIR = input.dataDir;
  if (input.claudePath) env.PAGEWISE_CLAUDE_PATH = input.claudePath;
  return env;
}
