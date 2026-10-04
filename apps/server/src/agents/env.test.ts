import { describe, expect, it } from 'vitest';
import { buildAgentEnv, effectiveModel, FIXED_ENV } from './env';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');
const OTHER = ['anderer', 'schluessel', 'qrstuvwxyz'].join('-');

const server: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/Users/beispiel',
  LANG: 'de_DE.UTF-8',
  USER: 'beispiel',
  TMPDIR: '/tmp/x',
  // Alles Folgende darf nie im Kindprozess ankommen.
  ANTHROPIC_API_KEY: OTHER,
  ANTHROPIC_AUTH_TOKEN: OTHER,
  ANTHROPIC_BASE_URL: 'https://fremd.example.test',
  CLAUDE_CODE_OAUTH_TOKEN: OTHER,
  CLAUDE_CONFIG_DIR: '/Users/beispiel/.claude-fremd',
  OPENROUTER_API_KEY: OTHER,
  HTTPS_PROXY: 'http://proxy.example.test',
  PAGEWISE_DATA_DIR: '/geheim',
  SSH_AUTH_SOCK: '/tmp/ssh',
  AWS_SECRET_ACCESS_KEY: OTHER,
};

const base = {
  token: null,
  model: null,
  cliDir: '/opt/claude/bin',
  source: server,
  isolatedHome: null,
} as const;

describe('buildAgentEnv', () => {
  it('Abo: echtes Benutzerverzeichnis, keine Schlüssel, kein CLAUDE_CONFIG_DIR', () => {
    const env = buildAgentEnv({ ...base, kind: 'claude-subscription' });
    expect(env.HOME).toBe('/Users/beispiel');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(Object.keys(env).filter((name) => /TOKEN|API_KEY|BASE_URL/.test(name))).toEqual([]);
    expect(env.LANG).toBe('de_DE.UTF-8');
    expect(env.PATH).toBe('/opt/claude/bin:/usr/local/bin:/usr/bin');
  });

  it('GLM: Bearer-Token, Adresse von Z.ai, alle drei Modellstufen, eigenes Verzeichnis', () => {
    const env = buildAgentEnv({
      ...base,
      kind: 'glm-coding-plan',
      token: TOKEN,
      isolatedHome: '/daten/engine/p1/home',
    });
    expect(env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: TOKEN,
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.3-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3-flash',
      API_TIMEOUT_MS: '3000000',
      HOME: '/daten/engine/p1/home',
      CLAUDE_CONFIG_DIR: '/daten/engine/p1/home/.claude',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('GLM: eigene Modellwahl gilt für alle Stufen', () => {
    const env = buildAgentEnv({
      ...base,
      kind: 'glm-coding-plan',
      token: TOKEN,
      model: 'glm-5.3',
      isolatedHome: '/h',
    });
    for (const name of ['HAIKU', 'SONNET', 'OPUS']) {
      expect(env[`ANTHROPIC_DEFAULT_${name}_MODEL`]).toBe('glm-5.3');
    }
  });

  it('API-Schlüssel: nur ANTHROPIC_API_KEY, keine Basis-Adresse', () => {
    const env = buildAgentEnv({
      ...base,
      kind: 'anthropic-api',
      token: TOKEN,
      isolatedHome: '/daten/engine/p2/home',
    });
    expect(env.ANTHROPIC_API_KEY).toBe(TOKEN);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.HOME).toBe('/daten/engine/p2/home');
  });

  it.each(['claude-subscription', 'glm-coding-plan', 'anthropic-api'] as const)(
    '%s: übernimmt nichts von fremden Schlüsseln und Einstellungen des Servers',
    (kind) => {
      const env = buildAgentEnv({
        ...base,
        kind,
        token: kind === 'claude-subscription' ? null : TOKEN,
        isolatedHome: kind === 'claude-subscription' ? null : '/h',
      });
      const text = JSON.stringify(env);
      expect(text).not.toContain(OTHER);
      for (const name of [
        'OPENROUTER_API_KEY',
        'HTTPS_PROXY',
        'PAGEWISE_DATA_DIR',
        'SSH_AUTH_SOCK',
        'AWS_SECRET_ACCESS_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ]) {
        expect(env[name]).toBeUndefined();
      }
      expect(env.CLAUDE_CONFIG_DIR === undefined || env.CLAUDE_CONFIG_DIR.startsWith('/h')).toBe(
        true,
      );
    },
  );

  it.each(['claude-subscription', 'glm-coding-plan', 'anthropic-api'] as const)(
    '%s: setzt die festen Schalter gegen unnötigen Verkehr und Selbstaktualisierung',
    (kind) => {
      const env = buildAgentEnv({
        ...base,
        kind,
        token: kind === 'claude-subscription' ? null : TOKEN,
        isolatedHome: kind === 'claude-subscription' ? null : '/h',
      });
      expect(env).toMatchObject(FIXED_ENV);
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
      expect(env.DISABLE_AUTOUPDATER).toBe('1');
    },
  );

  it('verlangt, was ein Profil braucht', () => {
    expect(() => buildAgentEnv({ ...base, kind: 'glm-coding-plan', isolatedHome: '/h' })).toThrow();
    expect(() => buildAgentEnv({ ...base, kind: 'glm-coding-plan', token: TOKEN })).toThrow();
    expect(() => buildAgentEnv({ ...base, kind: 'anthropic-api', token: TOKEN })).toThrow();
    expect(() =>
      buildAgentEnv({ ...base, kind: 'claude-subscription', source: { PATH: '/usr/bin' } }),
    ).toThrow();
  });

  it('der Schlüssel steht nur an der dafür vorgesehenen Stelle', () => {
    const env = buildAgentEnv({
      ...base,
      kind: 'glm-coding-plan',
      token: TOKEN,
      isolatedHome: '/h',
    });
    const holders = Object.entries(env).filter(([, value]) => value.includes(TOKEN));
    expect(holders).toEqual([['ANTHROPIC_AUTH_TOKEN', TOKEN]]);
  });
});

describe('effectiveModel', () => {
  it('nutzt die Wahl, sonst die Vorgabe der Art', () => {
    expect(effectiveModel('glm-coding-plan', null)).toBe('glm-5.3-flash');
    expect(effectiveModel('glm-coding-plan', 'glm-5.3')).toBe('glm-5.3');
    expect(effectiveModel('anthropic-api', null)).toBeNull();
    expect(effectiveModel('claude-subscription', 'opus')).toBe('opus');
  });
});
