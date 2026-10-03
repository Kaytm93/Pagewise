import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataLayout } from './data-paths';

describe('ensureDataLayout', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('legt alle Unterordner mit Rechten 700 an', () => {
    const paths = ensureDataLayout(join(base, 'daten'));
    for (const dir of [
      paths.root,
      paths.assets,
      paths.workspaces,
      paths.logs,
      paths.secrets,
      paths.backups,
    ]) {
      const stat = statSync(dir);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);
    }
  });

  it('liegt vollständig unterhalb des Datenverzeichnisses', () => {
    const root = join(base, 'daten');
    const paths = ensureDataLayout(root);
    for (const path of Object.values(paths)) {
      expect(path === root || path.startsWith(`${root}/`)).toBe(true);
    }
  });

  it('ist wiederholbar und lässt bestehende Inhalte in Ruhe', () => {
    const root = join(base, 'daten');
    const first = ensureDataLayout(root);
    const second = ensureDataLayout(root);
    expect(second).toEqual(first);
  });
});
