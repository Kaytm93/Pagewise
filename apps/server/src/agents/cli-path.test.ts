import { describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from '../db/client';
import { CliPathSetting, validateCliPath } from './cli-path';

describe('validateCliPath', () => {
  it('nimmt absolute Pfade, deren Datei „claude“ heißt, und bereinigt sie', () => {
    expect(validateCliPath('/opt/homebrew/bin/claude')).toBe('/opt/homebrew/bin/claude');
    expect(validateCliPath('  /usr/local/bin/claude  ')).toBe('/usr/local/bin/claude');
    expect(validateCliPath('/usr/local//bin/./claude')).toBe('/usr/local/bin/claude');
    expect(validateCliPath('/Users/beispiel/.local/bin/claude')).toBe(
      '/Users/beispiel/.local/bin/claude',
    );
  });

  it.each([
    '',
    '   ',
    'claude',
    './claude',
    '~/bin/claude',
    '/opt/../bin/claude',
    '/bin/sh',
    '/opt/beispiel/claude-code',
    '/opt/beispiel/Claude',
    '/opt/beispiel/claude/',
    '/opt/beispiel/claude\u0000',
    '/opt/beispiel/cla\nude',
    `/${'a'.repeat(1030)}/claude`,
  ])('lehnt %j ab', (input) => {
    expect(validateCliPath(input)).toBeNull();
  });
});

describe('CliPathSetting', () => {
  function setting() {
    const handle = openDatabase(':memory:');
    migrateDatabase(handle);
    return { handle, setting: new CliPathSetting(handle.db) };
  }

  it('ist anfangs leer, speichert, überschreibt und entfernt', () => {
    const { handle, setting: s } = setting();
    expect(s.get()).toBeNull();
    s.set('/opt/a/claude');
    expect(s.get()).toBe('/opt/a/claude');
    s.set('/opt/b/claude');
    expect(s.get()).toBe('/opt/b/claude');
    s.set(null);
    expect(s.get()).toBeNull();
    handle.close();
  });

  it('ignoriert einen beschädigten oder unzulässigen Wert in der Datenbank', () => {
    const { handle, setting: s } = setting();
    handle.sqlite
      .prepare(
        "insert into settings (key, value, created_at, updated_at) values ('agent.cliPath', ?, 0, 0)",
      )
      .run('"/bin/sh"');
    expect(s.get()).toBeNull();
    handle.sqlite
      .prepare("update settings set value = 'kein json' where key = 'agent.cliPath'")
      .run();
    expect(s.get()).toBeNull();
    handle.sqlite.prepare("update settings set value = '42' where key = 'agent.cliPath'").run();
    expect(s.get()).toBeNull();
    handle.close();
  });
});
