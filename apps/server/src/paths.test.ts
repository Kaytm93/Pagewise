import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from './config';
import { APP_ROOT, bundledResources, repoResources, resolveResources } from './paths';

describe('Ressourcenpfade', () => {
  it('nutzt ohne Angabe den Aufbau des Repos', () => {
    const paths = resolveResources({});
    expect(paths).toEqual(repoResources(APP_ROOT));
    expect(paths.webDist).toBe(join(APP_ROOT, 'apps', 'web', 'dist'));
    expect(paths.migrations).toBe(join(APP_ROOT, 'apps', 'server', 'drizzle'));
    expect(paths.catalogFile).toBe(join(APP_ROOT, 'config', 'subject-catalog.json'));
    expect(paths.defaultsDir).toBe(join(APP_ROOT, 'prompts', 'defaults'));
  });

  it('übersteuert alles mit PAGEWISE_RESOURCES_DIR (flacher Aufbau)', () => {
    const paths = resolveResources({ PAGEWISE_RESOURCES_DIR: '/opt/beispiel/res' });
    expect(paths).toEqual(bundledResources('/opt/beispiel/res'));
    expect(paths.root).toBe('/opt/beispiel/res');
    expect(paths.webDist).toBe('/opt/beispiel/res/web');
    expect(paths.migrations).toBe('/opt/beispiel/res/drizzle');
    expect(paths.catalogFile).toBe('/opt/beispiel/res/config/subject-catalog.json');
    expect(paths.defaultsDir).toBe('/opt/beispiel/res/prompts/defaults');
    expect(paths.versionFile).toBe('/opt/beispiel/res/package.json');
  });

  it('lässt eine Angabe im Aufruf Vorrang vor der Umgebung', () => {
    expect(resolveResources({ PAGEWISE_RESOURCES_DIR: '/a' }, '/b').root).toBe('/b');
  });

  it('verlangt einen absoluten Pfad', () => {
    expect(() => resolveResources({ PAGEWISE_RESOURCES_DIR: 'relativ/res' })).toThrow(ConfigError);
  });

  it('behandelt eine leere Angabe wie keine', () => {
    expect(resolveResources({ PAGEWISE_RESOURCES_DIR: '  ' }).root).toBe(APP_ROOT);
  });
});
