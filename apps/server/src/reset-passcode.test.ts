import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstanceLockError } from './instance-lock';
import { resetPasscode } from './reset-passcode';
import { startServer } from './server';
import { makeResourceDir } from './test-resources';

describe('Passcode zurücksetzen (Bibliothek)', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-reset-'));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('verweigert das Zurücksetzen, solange ein Server auf den Daten läuft', async () => {
    const resourcesDir = makeResourceDir(join(base, 'res'));
    const dataDir = join(base, 'daten');
    const server = await startServer({
      env: {},
      port: 0,
      dataDir,
      resourcesDir,
      services: { scryptParams: { N: 16, r: 8, p: 1 } },
    });
    try {
      expect(() => resetPasscode(dataDir, { resources: server.resources })).toThrow(
        InstanceLockError,
      );
    } finally {
      await server.stop();
    }
    // Danach geht es, und die Sperre bleibt nicht liegen.
    resetPasscode(dataDir, { resources: server.resources });
    resetPasscode(dataDir, { resources: server.resources });
  });
});
