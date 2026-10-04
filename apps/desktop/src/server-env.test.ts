import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServerEnv, extraPathDirs, SERVER_PASSTHROUGH_ENV } from './server-env';

const SERVER_DIR = '/Applications/Pagewise.app/Contents/Resources/server';

function fakeKey(prefix: string): string {
  // Zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
  return [prefix, 'erfundener', 'wert', '1234567890'].join('-');
}

describe('Umgebung des Serverprozesses (Allowlist)', () => {
  const source: NodeJS.ProcessEnv = {
    HOME: '/Users/beispiel',
    USER: 'beispiel',
    LANG: 'de_DE.UTF-8',
    TZ: 'Europe/Berlin',
    PATH: '/usr/bin:/bin',
    ANTHROPIC_API_KEY: fakeKey('sk-ant'),
    ANTHROPIC_AUTH_TOKEN: fakeKey('tok'),
    OPENROUTER_API_KEY: fakeKey('sk-or'),
    GITHUB_TOKEN: fakeKey('ghp'),
    AWS_SECRET_ACCESS_KEY: fakeKey('aws'),
    HTTPS_PROXY: 'http://proxy.example.test:3128',
    PAGEWISE_DATA_DIR: '/tmp/fremd',
    PAGEWISE_PORT: '9999',
    PAGEWISE_ALLOW_NON_LOOPBACK: '1',
    NODE_OPTIONS: '--require /tmp/boese.js',
    ELECTRON_RUN_AS_NODE: '1',
    DYLD_INSERT_LIBRARIES: '/tmp/boese.dylib',
  };
  const env = buildServerEnv({ source, port: 3000, host: '127.0.0.1', serverDir: SERVER_DIR });

  it('enthält nur Allowlist und die ausdrücklich gesetzten Pagewise-Variablen', () => {
    expect(Object.keys(env).sort()).toEqual(
      [
        'HOME',
        'LANG',
        'NODE_ENV',
        'PAGEWISE_HOST',
        'PAGEWISE_PORT',
        'PAGEWISE_RESOURCES_DIR',
        'PAGEWISE_SQLITE_BINDING',
        'PATH',
        'TZ',
        'USER',
      ].sort(),
    );
    for (const name of Object.keys(env)) {
      const allowed =
        (SERVER_PASSTHROUGH_ENV as readonly string[]).includes(name) ||
        [
          'PATH',
          'NODE_ENV',
          'PAGEWISE_PORT',
          'PAGEWISE_HOST',
          'PAGEWISE_RESOURCES_DIR',
          'PAGEWISE_SQLITE_BINDING',
        ].includes(name);
      expect(allowed, name).toBe(true);
    }
  });

  it('gibt keinen Schlüssel, kein Token und keine fremde Einstellung weiter', () => {
    const joined = JSON.stringify(env);
    for (const secret of [
      source.ANTHROPIC_API_KEY,
      source.ANTHROPIC_AUTH_TOKEN,
      source.OPENROUTER_API_KEY,
      source.GITHUB_TOKEN,
      source.AWS_SECRET_ACCESS_KEY,
      source.NODE_OPTIONS,
      source.DYLD_INSERT_LIBRARIES,
    ]) {
      expect(joined).not.toContain(String(secret));
    }
    for (const name of [
      'HTTPS_PROXY',
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'DYLD_INSERT_LIBRARIES',
    ]) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('setzt Port, Host und Ressourcen selbst und lässt fremde PAGEWISE_*-Werte nicht durch', () => {
    expect(env.PAGEWISE_PORT).toBe('3000');
    expect(env.PAGEWISE_HOST).toBe('127.0.0.1');
    expect(env.PAGEWISE_RESOURCES_DIR).toBe(SERVER_DIR);
    expect(env.PAGEWISE_SQLITE_BINDING).toBe(join(SERVER_DIR, 'better_sqlite3.node'));
    expect(env).not.toHaveProperty('PAGEWISE_DATA_DIR');
    expect(env).not.toHaveProperty('PAGEWISE_ALLOW_NON_LOOPBACK');
    expect(env.NODE_ENV).toBe('production');
  });

  it('setzt das Datenverzeichnis und den Pfad zu claude nur, wenn sie ausdrücklich übergeben werden', () => {
    const custom = buildServerEnv({
      source,
      port: 3000,
      host: '127.0.0.1',
      serverDir: SERVER_DIR,
      dataDir: '/Volumes/Beispiel/Pagewise',
      claudePath: '/opt/beispiel/claude',
    });
    expect(custom.PAGEWISE_DATA_DIR).toBe('/Volumes/Beispiel/Pagewise');
    expect(custom.PAGEWISE_CLAUDE_PATH).toBe('/opt/beispiel/claude');
  });

  it('erweitert den knappen PATH einer aus dem Finder gestarteten App um die üblichen Orte von claude', () => {
    const dirs = env.PATH?.split(':') ?? [];
    expect(dirs.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    for (const dir of extraPathDirs('/Users/beispiel')) expect(dirs).toContain(dir);
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/Users/beispiel/.local/bin');
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it('kommt auch ohne HOME und PATH aus', () => {
    const bare = buildServerEnv({
      source: {},
      port: 3000,
      host: '127.0.0.1',
      serverDir: SERVER_DIR,
    });
    expect(bare.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    expect(bare).not.toHaveProperty('HOME');
  });
});
