import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireInstanceLock,
  InstanceLockError,
  LOCK_FILE,
  processIsAlive,
  readLockHolder,
} from './instance-lock';

describe('Instanzsperre', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pagewise-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('legt die Sperre mit Rechten 600 an und gibt sie wieder frei', () => {
    const lock = acquireInstanceLock(dir, { pid: 4242, isAlive: () => true });
    const file = join(dir, LOCK_FILE);
    expect(lock.file).toBe(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: 4242, port: null });
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it('weist einen zweiten Start ab und nennt Prozess und Port', () => {
    const first = acquireInstanceLock(dir, { pid: 4242, isAlive: () => true });
    first.setPort(3000);
    let error: unknown;
    try {
      acquireInstanceLock(dir, { pid: 4343, isAlive: () => true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InstanceLockError);
    expect((error as InstanceLockError).pid).toBe(4242);
    expect((error as Error).message).toContain('läuft bereits');
    expect((error as Error).message).toContain('4242');
    expect((error as Error).message).toContain('Port 3000');
    expect(readLockHolder(dir, { isAlive: () => true })).toMatchObject({ pid: 4242, port: 3000 });
  });

  it('übernimmt eine verwaiste Sperre (Prozess gibt es nicht mehr)', () => {
    acquireInstanceLock(dir, { pid: 4242, isAlive: () => true });
    const second = acquireInstanceLock(dir, { pid: 4343, isAlive: (pid) => pid !== 4242 });
    expect(JSON.parse(readFileSync(second.file, 'utf8')).pid).toBe(4343);
  });

  it('übernimmt eine unlesbare Sperrdatei', () => {
    writeFileSync(join(dir, LOCK_FILE), 'kein json');
    const lock = acquireInstanceLock(dir, { pid: 4343, isAlive: () => true });
    expect(JSON.parse(readFileSync(lock.file, 'utf8')).pid).toBe(4343);
  });

  it('gibt eine fremde Sperre nicht frei', () => {
    const mine = acquireInstanceLock(dir, { pid: 4242, isAlive: () => true });
    rmSync(mine.file);
    const theirs = acquireInstanceLock(dir, { pid: 4343, isAlive: () => true });
    mine.release();
    expect(existsSync(theirs.file)).toBe(true);
  });

  it('erkennt den eigenen Prozess als lebend und eine unmögliche Nummer als tot', () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(2 ** 22 + 12345)).toBe(false);
  });

  it('zählt ohne Datei keinen Inhaber', () => {
    expect(readLockHolder(dir)).toBeNull();
  });
});
