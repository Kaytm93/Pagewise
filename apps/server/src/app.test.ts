import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('API', () => {
  const app = createApp({ version: '1.2.3' });

  it('beantwortet /api/health', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('gibt keine Pfade oder Konfiguration preis', async () => {
    const body = await (await app.request('/api/health')).text();
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['status', 'version']);
  });

  it('setzt Security-Header und verbietet Caching der API', async () => {
    const response = await app.request('/api/health');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('antwortet auf unbekannte API-Pfade mit 404 als JSON', async () => {
    const response = await app.request('/api/gibt-es-nicht');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('Auslieferung der Oberfläche', () => {
  let dist: string;

  beforeAll(() => {
    dist = realpathSync(mkdtempSync(join(tmpdir(), 'pagewise-web-')));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Pagewise</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  });

  afterAll(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('liefert Dateien aus dem Build-Ordner', async () => {
    const app = createApp({ version: '0', webDist: dist });
    const response = await app.request('/assets/app.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('console.log(1)');
  });

  it('liefert für unbekannte Pfade index.html (Einseiten-App)', async () => {
    const app = createApp({ version: '0', webDist: dist });
    const response = await app.request('/faecher/42');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Pagewise</title>');
  });

  it('liefert API-Pfade nie als index.html aus', async () => {
    const app = createApp({ version: '0', webDist: dist });
    const response = await app.request('/api/nichts');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('liefert nie Dateien von außerhalb des Build-Ordners (Pfad-Traversal)', async () => {
    const marker = 'GEHEIMER-MARKER-FUER-TESTS';
    writeFileSync(join(dist, '..', 'ausserhalb.txt'), marker);
    const app = createApp({ version: '0', webDist: dist });
    const probes = [
      '/../ausserhalb.txt',
      '/assets/../../ausserhalb.txt',
      '/assets/..%2f..%2fausserhalb.txt',
      '/%2e%2e/ausserhalb.txt',
      '/..%5causserhalb.txt',
      '/ausserhalb.txt',
    ];
    try {
      for (const probe of probes) {
        const response = await app.request(probe);
        expect(await response.text(), probe).not.toContain(marker);
      }
    } finally {
      rmSync(join(dist, '..', 'ausserhalb.txt'), { force: true });
    }
  });

  it('läuft auch ohne gebaute Oberfläche', async () => {
    const app = createApp({ version: '0', webDist: join(dist, 'fehlt') });
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/')).status).toBe(404);
  });
});
