import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changedFiles, snapshotDir, WorkspaceManager } from './workspace';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('WorkspaceManager', () => {
  it('legt je Fach und Untergruppe einen eigenen Ordner mit Rechten 700 an', () => {
    const root = join(base, 'workspaces');
    mkdirSync(root);
    const manager = new WorkspaceManager(root);
    const main = manager.ensure(SUBJECT, null);
    const group = manager.ensure(SUBJECT, GROUP);
    expect(main).not.toBe(group);
    expect(main.endsWith(`${SUBJECT}/main`)).toBe(true);
    expect(group.endsWith(`${SUBJECT}/groups/${GROUP}`)).toBe(true);
    expect(manager.ensure(SUBJECT, null)).toBe(main);
  });

  it.each([
    ['../ausbruch', null],
    ['11111111-1111-4111-8111-11111111111', null],
    [SUBJECT, '../x'],
    [SUBJECT, 'nicht-eine-id'],
    ['', null],
  ])('weist die ungültige ID %j / %j zurück, bevor ein Pfad entsteht', (subject, group) => {
    const manager = new WorkspaceManager(join(base, 'workspaces'));
    expect(() => manager.pathFor(subject, group)).toThrow();
    expect(existsSync(join(base, 'workspaces'))).toBe(false);
  });

  it('entfernt Fach und Untergruppen mit ihren Dateien', () => {
    const root = join(base, 'workspaces');
    mkdirSync(root);
    const manager = new WorkspaceManager(root);
    writeFileSync(join(manager.ensure(SUBJECT, null), 'a.txt'), 'x');
    writeFileSync(join(manager.ensure(SUBJECT, GROUP), 'b.txt'), 'y');
    manager.removeGroup(SUBJECT, GROUP);
    expect(existsSync(manager.pathFor(SUBJECT, GROUP))).toBe(false);
    expect(existsSync(manager.pathFor(SUBJECT, null))).toBe(true);
    manager.removeSubject(SUBJECT);
    expect(existsSync(join(root, SUBJECT))).toBe(false);
    // Unbekanntes und Ungültiges ist harmlos.
    manager.removeSubject(SUBJECT);
    manager.removeSubject('../irgendwas');
    expect(existsSync(root)).toBe(true);
  });
});

describe('snapshotDir und changedFiles', () => {
  it('sieht nur gewöhnliche, nicht versteckte Dateien und keine Verknüpfungen', () => {
    mkdirSync(join(base, 'unter'), { recursive: true });
    mkdirSync(join(base, '.claude'));
    writeFileSync(join(base, 'a.txt'), 'x');
    writeFileSync(join(base, 'unter', 'b.pdf'), 'y');
    writeFileSync(join(base, '.versteckt'), 'z');
    writeFileSync(join(base, '.claude', 'settings.json'), '{}');
    writeFileSync(join(base, 'ziel.txt'), 'ziel');
    symlinkSync(join(base, 'ziel.txt'), join(base, 'link.txt'));
    expect([...snapshotDir(base).keys()]).toEqual(['a.txt', 'unter/b.pdf', 'ziel.txt']);
  });

  it('erkennt neue und geänderte Dateien, nicht unveränderte', () => {
    writeFileSync(join(base, 'alt.txt'), 'alt');
    writeFileSync(join(base, 'gleich.txt'), 'gleich');
    const before = snapshotDir(base);
    writeFileSync(join(base, 'neu.pdf'), 'neu');
    writeFileSync(join(base, 'alt.txt'), 'geändert und länger');
    expect(changedFiles(before, snapshotDir(base))).toEqual(['alt.txt', 'neu.pdf']);
  });

  it('erkennt eine Änderung auch bei gleicher Größe über den Zeitstempel', () => {
    writeFileSync(join(base, 'a.txt'), 'abc');
    utimesSync(join(base, 'a.txt'), new Date(1_000_000), new Date(1_000_000));
    const before = snapshotDir(base);
    writeFileSync(join(base, 'a.txt'), 'xyz');
    utimesSync(join(base, 'a.txt'), new Date(2_000_000), new Date(2_000_000));
    expect(changedFiles(before, snapshotDir(base))).toEqual(['a.txt']);
  });
});
