import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rejection } from '../test-utils';
import { LocalStorage, StorageError } from './storage';

describe('LocalStorage', () => {
  let base: string;
  let root: string;
  let storage: LocalStorage;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    root = join(base, 'assets');
    storage = new LocalStorage(root);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('speichert und liest Text und Bytes', async () => {
    await storage.put('notiz.txt', 'Beispieltext');
    expect(new TextDecoder().decode((await storage.get('notiz.txt')) ?? new Uint8Array())).toBe(
      'Beispieltext',
    );

    const bytes = new Uint8Array([0, 1, 2, 255]);
    await storage.put('bilder/2026/beispiel.bin', bytes);
    expect(await storage.get('bilder/2026/beispiel.bin')).toEqual(bytes);
  });

  it('legt Dateien mit Rechten 600 und Ordner mit 700 an', async () => {
    await storage.put('ordner/datei.txt', 'x');
    expect(statSync(join(root, 'ordner', 'datei.txt')).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'ordner')).mode & 0o777).toBe(0o700);
  });

  it('überschreibt atomar und hinterlässt keine Temp-Dateien', async () => {
    await storage.put('a.txt', 'eins');
    await storage.put('a.txt', 'zwei');
    expect(new TextDecoder().decode((await storage.get('a.txt')) ?? new Uint8Array())).toBe('zwei');
    expect(readdirSync(root)).toEqual(['a.txt']);
  });

  it('meldet fehlende Dateien als null beziehungsweise false', async () => {
    expect(await storage.get('gibt-es-nicht.txt')).toBeNull();
    expect(await storage.exists('gibt-es-nicht.txt')).toBe(false);
    expect(await storage.delete('gibt-es-nicht.txt')).toBe(false);
  });

  it('löscht Dateien wirklich', async () => {
    await storage.put('weg.txt', 'x');
    expect(await storage.exists('weg.txt')).toBe(true);
    expect(await storage.delete('weg.txt')).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  it('listet Schlüssel sortiert, mit und ohne Präfix, ohne Temp-Dateien', async () => {
    await storage.put('b/zwei.txt', '2');
    await storage.put('a/eins.txt', '1');
    await storage.put('a/tief/drei.txt', '3');
    writeFileSync(join(root, 'a', '.tmp-halb'), 'unvollständig');

    expect(await storage.list()).toEqual(['a/eins.txt', 'a/tief/drei.txt', 'b/zwei.txt']);
    expect(await storage.list('a')).toEqual(['a/eins.txt', 'a/tief/drei.txt']);
    expect(await storage.list('nicht-da')).toEqual([]);
  });

  it.each([
    '',
    '../ausbruch.txt',
    'a/../../ausbruch.txt',
    '/absolut.txt',
    'a//b.txt',
    'a/./b.txt',
    '.versteckt',
    'a/.versteckt',
    'mit leerzeichen.txt',
    'rück\\wärts.txt',
    'nul\0byte.txt',
    `${'x'.repeat(256)}.txt`,
  ])('lehnt den Schlüssel %j ab', async (key) => {
    await expect(storage.put(key, 'x')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(StorageError);
  });

  it('lehnt ungültige Präfixe beim Auflisten ab', async () => {
    await expect(storage.list('../draußen')).rejects.toBeInstanceOf(StorageError);
  });

  it('folgt keinem Symlink aus dem Speicherordner heraus', async () => {
    const outside = join(base, 'draussen');
    mkdirSync(outside);
    writeFileSync(join(outside, 'geheim.txt'), 'nicht für dich');

    symlinkSync(outside, join(root, 'ordner-link'));
    await expect(storage.put('ordner-link/neu.txt', 'x')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.get('ordner-link/geheim.txt')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.list('ordner-link')).rejects.toBeInstanceOf(StorageError);

    symlinkSync(join(outside, 'geheim.txt'), join(root, 'datei-link'));
    await expect(storage.get('datei-link')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.put('datei-link', 'überschrieben')).rejects.toBeInstanceOf(StorageError);
  });

  it('nennt in Fehlermeldungen keine Pfade des Servers', async () => {
    const error = await rejection(storage.put('../x', 'y'));
    expect(error.message).not.toContain(base);
  });
});
