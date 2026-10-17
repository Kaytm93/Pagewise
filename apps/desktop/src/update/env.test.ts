import { describe, expect, it } from 'vitest';
import {
  buildMinimalEnv,
  buildPath,
  buildUpdateEnv,
  commonToolDirs,
  FIXED_ENV,
  PASS_THROUGH,
} from './env';

describe('Umgebung der Update-Programme', () => {
  it('reicht nur die erlaubten Namen durch und setzt feste Werte', () => {
    const env = buildUpdateEnv({
      source: {
        HOME: '/Users/beispiel',
        HTTPS_PROXY: 'http://proxy.example.org',
        PNPM_HOME: '/Users/beispiel/Library/pnpm',
        PATH: '/boese/pfade',
        ANTHROPIC_API_KEY: 'geheim',
        OPENROUTER_API_KEY: 'geheim',
        GITHUB_TOKEN: 'geheim',
        NODE_OPTIONS: '--inspect',
        DYLD_INSERT_LIBRARIES: '/x.dylib',
        LEER: '',
      },
      pathDirs: ['/opt/node/bin'],
    });
    expect(env.HOME).toBe('/Users/beispiel');
    expect(env.HTTPS_PROXY).toBe('http://proxy.example.org');
    expect(env.PNPM_HOME).toBe('/Users/beispiel/Library/pnpm');
    expect(env.CI).toBe('true');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    // Der PATH wird neu zusammengesetzt, der der App ist egal.
    expect(env.PATH).toBe('/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    for (const name of [
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'GITHUB_TOKEN',
      'NODE_OPTIONS',
      'DYLD_INSERT_LIBRARIES',
      'LEER',
    ]) {
      expect(env, name).not.toHaveProperty(name);
    }
  });

  it('enthält in der Allowlist nie etwas, das nach Geheimnis klingt', () => {
    for (const name of [...PASS_THROUGH, ...Object.keys(FIXED_ENV)]) {
      expect(name, name).not.toMatch(/KEY|TOKEN|SECRET|PASSW|PASSCODE|AUTH|CREDENTIAL/i);
    }
    expect(PASS_THROUGH).not.toContain('PATH');
    expect(PASS_THROUGH).not.toContain('NODE_OPTIONS');
  });

  it('setzt den PATH aus bekannten Ordnern zusammen, ohne Doppelte, mit Systemordnern am Ende', () => {
    expect(buildPath(['/a', '/b', '/a', '/usr/bin'])).toBe('/a:/b:/usr/bin:/bin:/usr/sbin:/sbin');
    expect(commonToolDirs('/Users/beispiel')).toContain('/opt/homebrew/bin');
    expect(commonToolDirs('/Users/beispiel')).toContain('/Users/beispiel/Library/pnpm');
  });

  it('gibt dem Rauchtest und dem Helfer nur das Nötigste', () => {
    const env = buildMinimalEnv(
      { HOME: '/h', USER: 'u', HTTPS_PROXY: 'x', ANTHROPIC_API_KEY: 'k', LANG: 'de_DE.UTF-8' },
      ['/n/bin'],
    );
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH', 'USER']);
  });
});
