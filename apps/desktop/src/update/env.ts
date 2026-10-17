import { delimiter, join } from 'node:path';

/**
 * Umgebung für die Programme des Updates (git, pnpm, die gebaute App im Rauchtest). Nie `process.env` als Ganzes: Eine
 * App aus Finder erbt zwar wenig, aber was sie erbt, geht nicht an Programme, die Code aus dem Netz bauen. Durch kommt
 * nur, was Git, pnpm und der Download von Electron zum Arbeiten brauchen (Ort der Konfiguration, Proxy, eigene
 * Zertifikate); Schlüssel, Tokens und Kennwörter nie (ein Test hält das fest).
 */
export const PASS_THROUGH = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TZ',
  // Netz: Proxy und eigene Zertifikate (Firmen- oder Schulnetz).
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Ort von pnpm und seinem Speicher: derselbe wie beim Bauen im Terminal, sonst lädt pnpm alles neu.
  'PNPM_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  // Electron-Download (Zwischenspeicher, Spiegel).
  'ELECTRON_CACHE',
  'ELECTRON_MIRROR',
] as const;

/** Feste Werte: keine Rückfragen im Terminal, keine Farben, keine Hinweise auf neue Versionen der Werkzeuge. */
export const FIXED_ENV: Readonly<Record<string, string>> = Object.freeze({
  CI: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  NO_UPDATE_NOTIFIER: '1',
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  npm_config_update_notifier: 'false',
});

/** Systemordner, immer am Ende des `PATH`. */
export const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'] as const;

/** Übliche Orte von Node, pnpm und git auf dem Mac (nach den gemerkten Ordnern des Bauens). */
export function commonToolDirs(home: string): string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, 'Library', 'pnpm'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.local', 'bin'),
  ];
}

export function buildPath(dirs: readonly string[]): string {
  return [...new Set([...dirs, ...SYSTEM_PATH])].join(delimiter);
}

export interface UpdateEnvInput {
  source: NodeJS.ProcessEnv;
  /** Ordner für `PATH`, vorne zuerst (z. B. der Ordner von `node`, dann die gemerkten Ordner). */
  pathDirs: readonly string[];
  /** Zusätzlich erlaubte Werte, z. B. nichts. */
  extra?: Readonly<Record<string, string>>;
}

export function buildUpdateEnv(input: UpdateEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASS_THROUGH) {
    const value = input.source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  Object.assign(env, FIXED_ENV, input.extra ?? {});
  env.PATH = buildPath(input.pathDirs);
  return env;
}

/** Knappe Umgebung für den Rauchtest der gebauten App und den Helfer: kein Netz-, kein Werkzeug-Zubehör. */
export function buildMinimalEnv(
  source: NodeJS.ProcessEnv,
  pathDirs: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR']) {
    const value = source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  env.PATH = buildPath(pathDirs);
  return env;
}
