import { delimiter, dirname, join } from 'node:path';
import { type EngineKind, GLM_BASE_URL, GLM_DEFAULT_MODEL } from './profiles';

/**
 * Umgebung des Agenten-Prozesses. Es gibt eine feste Allowlist: Der Prozess bekommt nur, was hier steht, nie
 * `process.env` des Servers (darin könnten Schlüssel anderer Anbieter, Proxy-Einstellungen oder fremde
 * `ANTHROPIC_*`- und `CLAUDE_CODE_*`-Variablen stehen). Secrets gehen ausschließlich über die Umgebung, nie als
 * Argument (sichtbar in der Prozessliste).
 */

/** Variablen, die aus der Umgebung des Servers durchgereicht werden dürfen. */
export const PASSTHROUGH_ENV = [
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'USER',
  'LOGNAME',
] as const;

/**
 * Pflicht für alle Profile (gemessen mit Claude Code 2.1.220): Ohne `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
 * verbindet sich das Programm auch mit einer fremden Basis-Adresse noch mit api.anthropic.com (Telemetrie,
 * Merkmale, Update-Prüfung). `DISABLE_AUTOUPDATER` verhindert, dass es sich selbst (oder das npm-Paket des Nutzers)
 * aktualisiert, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` dass es Notizen außerhalb des Arbeitsordners anlegt.
 */
export const FIXED_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  // Ohne Begrenzung wiederholt das Programm jeden API-Fehler bis zu 10 Mal, auch bei 401 (gemessen: rund
  // 3 Minuten bis zum Ende). Zwei Wiederholungen genügen für kurze Störungen.
  CLAUDE_CODE_MAX_RETRIES: '2',
};

export interface EnvInput {
  kind: EngineKind;
  /** Schlüssel des Profils (nicht beim Abo). Er landet nur in der Umgebung des Prozesses. */
  token: string | null;
  /** Eigene Modellwahl des Profils. */
  model: string | null;
  /** Ordner der Binary, damit sie ihre Geschwister findet (Shims, Bash-Werkzeug). */
  cliDir: string;
  /** Umgebung des Servers, aus der die Allowlist liest. */
  source: NodeJS.ProcessEnv;
  /** Eigenes `HOME` für Profile mit Schlüssel. Das Abo nutzt das echte `HOME` (dort liegt die Anmeldung). */
  isolatedHome: string | null;
  /** Standard-`PATH`, falls der Server keinen hat. */
  fallbackPath?: string;
}

/** Modell, das ein Profil tatsächlich nutzt (für GLM gilt die Voreinstellung für alle drei Stufen). */
export function effectiveModel(kind: EngineKind, model: string | null): string | null {
  if (model) return model;
  return kind === 'glm-coding-plan' ? GLM_DEFAULT_MODEL : null;
}

/** Baut die vollständige Umgebung für `claude`. Wirft, wenn ein Pflicht-Secret fehlt. */
export function buildAgentEnv(input: EnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH_ENV) {
    const value = input.source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }

  const serverPath = input.source.PATH ?? input.fallbackPath ?? '/usr/bin:/bin';
  env.PATH = [...new Set([input.cliDir, ...serverPath.split(delimiter)])]
    .filter(Boolean)
    .join(delimiter);

  if (input.kind === 'claude-subscription') {
    // Die Anmeldung liegt im echten Benutzerverzeichnis (Schlüsselbund, `~/.claude`): Das Programm findet sie selbst.
    // Pagewise liest sie nie. `CLAUDE_CONFIG_DIR` bleibt ungesetzt, sonst wäre die Person dort nicht angemeldet.
    const home = input.source.HOME;
    if (!home) throw new Error('Für das Claude-Abo ist kein Benutzerverzeichnis bekannt.');
    env.HOME = home;
  } else {
    if (!input.isolatedHome)
      throw new Error('Für diesen Zugang fehlt ein eigenes Arbeitsverzeichnis.');
    if (!input.token) throw new Error('Für diesen Zugang fehlt der Schlüssel.');
    env.HOME = input.isolatedHome;
    env.CLAUDE_CONFIG_DIR = join(input.isolatedHome, '.claude');
    if (input.kind === 'glm-coding-plan') {
      // Quelle: https://docs.z.ai/devpack/tool/claude. Bearer-Token, alle drei Modellstufen ausdrücklich gesetzt:
      // Ohne sie würde das Programm den Namen eines Claude-Modells an Z.ai schicken.
      const model = effectiveModel(input.kind, input.model) ?? GLM_DEFAULT_MODEL;
      env.ANTHROPIC_BASE_URL = GLM_BASE_URL;
      env.ANTHROPIC_AUTH_TOKEN = input.token;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      env.API_TIMEOUT_MS = '3000000';
    } else {
      env.ANTHROPIC_API_KEY = input.token;
    }
  }
  return { ...env, ...FIXED_ENV };
}

/** Ordner der Binary, für den `PATH`. */
export const cliDirOf = (cliPath: string): string => dirname(cliPath);
