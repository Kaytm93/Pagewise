import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rejection } from '../test-utils';
import { FileSecretStore, SecretStoreError } from './secret-store';

// Offensichtlich erfundener Wert, zur Laufzeit zusammengesetzt (kein echtes Schlüsselformat).
const fakeKey = ['beispiel', 'schluessel', 'nur', 'fuer', 'tests', 'ABCD'].join('-');

describe('FileSecretStore', () => {
  let base: string;
  let file: string;
  let store: FileSecretStore;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    mkdirSync(join(base, 'secrets'), { mode: 0o700 });
    file = join(base, 'secrets', 'secrets.json');
    store = new FileSecretStore(file);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('speichert, liest, prüft und löscht Werte', async () => {
    expect(await store.has('provider.beispiel')).toBe(false);
    expect(await store.get('provider.beispiel')).toBeUndefined();

    await store.set('provider.beispiel', fakeKey);
    expect(await store.has('provider.beispiel')).toBe(true);
    expect(await store.get('provider.beispiel')).toBe(fakeKey);

    expect(await store.delete('provider.beispiel')).toBe(true);
    expect(await store.delete('provider.beispiel')).toBe(false);
    expect(await store.has('provider.beispiel')).toBe(false);
  });

  it('legt die Datei mit Rechten 600 an und hinterlässt keine Temp-Dateien', async () => {
    await store.set('a', fakeKey);
    await store.set('b', `${fakeKey}2`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(base, 'secrets'))).toEqual(['secrets.json']);
  });

  it('setzt zu lockere Rechte einer bestehenden Datei wieder auf 600', async () => {
    await store.set('a', fakeKey);
    chmodSync(file, 0o644);
    expect(await store.has('a')).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('entfernt umgebende Leerzeichen und Zeilenumbrüche aus eingefügten Werten', async () => {
    await store.set('a', `  ${fakeKey}\n`);
    expect(await store.get('a')).toBe(fakeKey);
  });

  it('zeigt die letzten vier Zeichen nur bei langen Werten', async () => {
    await store.set('lang', fakeKey);
    await store.set('kurz', 'kurzer-wert-1');
    expect(await store.list()).toEqual([
      { name: 'kurz', last4: null },
      { name: 'lang', last4: 'ABCD' },
    ]);
  });

  it('gibt über list() niemals den vollständigen Wert heraus', async () => {
    await store.set('lang', fakeKey);
    expect(JSON.stringify(await store.list())).not.toContain(fakeKey);
  });

  it('akzeptiert Namen wie "constructor" als gewöhnliche Namen', async () => {
    await store.set('constructor', fakeKey);
    expect(await store.get('constructor')).toBe(fakeKey);
    expect(await store.get('tostring')).toBeUndefined();
  });

  it.each(['', 'Gross', '1zahl', '_start', '__proto__', 'mit leerzeichen', 'a/b', 'x'.repeat(65)])(
    'lehnt den Namen %j ab',
    async (name) => {
      await expect(store.set(name, fakeKey)).rejects.toBeInstanceOf(SecretStoreError);
      await expect(store.get(name)).rejects.toBeInstanceOf(SecretStoreError);
    },
  );

  it.each(['', '   ', 'zeile1\nzeile2', 'mit\ttab', 'steuer\u0000zeichen', 'x'.repeat(4097)])(
    'lehnt den Wert %j ab, ohne ihn in der Meldung zu nennen',
    async (value) => {
      const error = await rejection(store.set('a', value));
      expect(error).toBeInstanceOf(SecretStoreError);
      if (value.trim().length > 0 && value.length < 100) {
        expect(error.message).not.toContain(value.trim());
      }
    },
  );

  it('nennt bei beschädigter Datei weder Inhalt noch Werte', async () => {
    writeFileSync(file, `{"version":1,"secrets":{"a":"${fakeKey}",`, { mode: 0o600 });
    const error = await rejection(store.list());
    expect(error).toBeInstanceOf(SecretStoreError);
    expect(error.message).not.toContain(fakeKey);
    expect(error.message).toContain(file);
  });

  it('weist unbekannte Formate ab, ohne Werte zu nennen', async () => {
    writeFileSync(file, JSON.stringify({ version: 2, secrets: { a: fakeKey } }), { mode: 0o600 });
    const error = await rejection(store.get('a'));
    expect(error).toBeInstanceOf(SecretStoreError);
    expect(error.message).not.toContain(fakeKey);

    writeFileSync(file, JSON.stringify({ version: 1, secrets: { a: 42 } }), { mode: 0o600 });
    await expect(store.get('a')).rejects.toBeInstanceOf(SecretStoreError);
  });

  it('übersteht eine beschädigte Datei nicht durch stilles Überschreiben', async () => {
    writeFileSync(file, 'kein json', { mode: 0o600 });
    await expect(store.set('a', fakeKey)).rejects.toBeInstanceOf(SecretStoreError);
    expect(readFileSync(file, 'utf8')).toBe('kein json');
  });

  it('hält den Wert nicht im Speicher des Objekts', async () => {
    await store.set('a', fakeKey);
    const dump = JSON.stringify(store) + Object.values(store).join('');
    expect(dump).not.toContain(fakeKey);
  });
});
