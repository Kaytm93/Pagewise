import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subjects } from './db/schema';
import { createServices, type Services } from './services';

describe('createServices', () => {
  let base: string;
  let services: Services | undefined;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  });
  afterEach(() => {
    services?.close();
    services = undefined;
    rmSync(base, { recursive: true, force: true });
  });

  it('baut Ordner, Datenbank, Storage und Secret-Speicher im Datenverzeichnis auf', async () => {
    const dataDir = join(base, 'daten');
    services = createServices(dataDir);

    expect(readdirSync(dataDir).sort()).toEqual(
      expect.arrayContaining(['assets', 'backups', 'logs', 'pagewise.db', 'secrets', 'workspaces']),
    );
    expect(services.database.db.select().from(subjects).all()).toEqual([]);

    await services.storage.put('beispiel.txt', 'x');
    expect(await services.storage.exists('beispiel.txt')).toBe(true);

    await services.secrets.set('beispiel', 'ein-erfundener-wert-12345');
    expect(statSync(join(dataDir, 'secrets', 'secrets.json')).mode & 0o777).toBe(0o600);
  });

  it('behält Daten über einen Neustart', () => {
    const dataDir = join(base, 'daten');
    services = createServices(dataDir);
    services.database.db.insert(subjects).values({ name: 'Beispielfach' }).run();
    services.close();

    services = createServices(dataDir);
    expect(services.database.db.select().from(subjects).all()).toHaveLength(1);
  });
});
