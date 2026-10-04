import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectLicenses, findPackageDir, renderLicenses } from '../scripts/licenses';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '..', '..');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-lic-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pkg(
  base: string,
  name: string,
  json: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const path = join(base, 'node_modules', name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...json }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
  return path;
}

describe('Lizenzhinweise der gebündelten Pakete', () => {
  it('läuft den Baum ab, nimmt nur Laufzeitabhängigkeiten und überspringt eigene Pakete', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { alpha: '1', '@pagewise/render': 'workspace:*' },
        devDependencies: { entwicklung: '1' },
      }),
    );
    pkg(
      dir,
      'alpha',
      { license: 'MIT', dependencies: { beta: '1' } },
      { LICENSE: 'Alpha-Text\r\n' },
    );
    pkg(dir, 'beta', { licenses: [{ type: 'ISC' }], optionalDependencies: { gamma: '1' } }, {});
    pkg(dir, 'entwicklung', { license: 'MIT' }, { LICENSE: 'nie' });
    pkg(dir, '@pagewise/render', { license: 'MIT' }, {});

    const found = collectLicenses([{ dir }]);
    expect(found.map((p) => `${p.name} ${p.license}`)).toEqual(['alpha MIT', 'beta ISC']);
    expect(found[0]?.texts).toEqual([{ file: 'LICENSE', text: 'Alpha-Text' }]);
    // „gamma“ ist optional und nicht installiert: fehlt einfach.
    expect(found.some((p) => p.name === 'gamma')).toBe(false);
  });

  it('findet Pakete wie Node, auch hinter pnpm-Symlinks, ohne exports zu lesen', () => {
    const store = join(dir, '.pnpm', 'alpha@1', 'node_modules');
    const alpha = join(store, 'alpha');
    mkdirSync(alpha, { recursive: true });
    writeFileSync(
      join(alpha, 'package.json'),
      JSON.stringify({ name: 'alpha', version: '1.0.0', license: 'MIT', exports: { '.': null } }),
    );
    const beta = join(store, 'beta');
    mkdirSync(beta, { recursive: true });
    writeFileSync(join(beta, 'package.json'), JSON.stringify({ name: 'beta', version: '2.0.0' }));
    mkdirSync(join(dir, 'app', 'node_modules'), { recursive: true });
    symlinkSync(alpha, join(dir, 'app', 'node_modules', 'alpha'));
    writeFileSync(
      join(alpha, 'package.json'),
      JSON.stringify({
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { beta: '2' },
      }),
    );

    expect(findPackageDir('alpha', join(dir, 'app'))).toBe(alpha);
    const found = collectLicenses([{ dir: join(dir, 'app'), names: ['alpha'] }]);
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual(['alpha@1.0.0', 'beta@2.0.0']);
    expect(found[1]?.license).toBe('UNKNOWN');
  });

  it('schreibt einen festen, sortierten Text ohne Zeitstempel und nennt fehlende Lizenzdateien', () => {
    const text = renderLicenses([
      {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        source: null,
        texts: [{ file: 'LICENSE', text: 'A' }],
      },
      {
        name: 'b',
        version: '2.0.0',
        license: 'ISC',
        source: 'git+https://example.org/b.git',
        texts: [],
      },
    ]);
    expect(text).toContain('Pakete: 2');
    expect(text).toContain('a 1.0.0\nLizenz: MIT');
    expect(text).toContain('--- LICENSE ---\n\nA');
    expect(text).toContain('Quelle: git+https://example.org/b.git');
    expect(text).toContain('keine Lizenzdatei');
    expect(text).toContain('Electron-LICENSE');
    expect(text).toBe(
      renderLicenses([
        {
          name: 'a',
          version: '1.0.0',
          license: 'MIT',
          source: null,
          texts: [{ file: 'LICENSE', text: 'A' }],
        },
        {
          name: 'b',
          version: '2.0.0',
          license: 'ISC',
          source: 'git+https://example.org/b.git',
          texts: [],
        },
      ]),
    );
  });

  it('im echten Repo: bekannte Pakete sind dabei, jedes hat eine Lizenzangabe, nichts Unfreies', () => {
    const found = collectLicenses([
      { dir: join(repo, 'apps', 'server') },
      { dir: join(repo, 'apps', 'web') },
      { dir: join(repo, 'packages', 'render') },
      { dir: desktop, names: ['uqr'] },
    ]);
    const names = new Set(found.map((p) => p.name));
    for (const expected of [
      'better-sqlite3',
      'hono',
      'zod',
      'react',
      'katex',
      'uqr',
      'dompurify',
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
    expect(names.has('electron')).toBe(false);
    expect(names.has('vitest')).toBe(false);
    expect(found.filter((p) => p.license === 'UNKNOWN').map((p) => p.name)).toEqual([]);
    // Nur freie Lizenzen: kein GPL, AGPL, SSPL, kein „UNLICENSED“.
    const unfree = found.filter((p) => /GPL|SSPL|UNLICENSED|Commons-Clause/i.test(p.license));
    expect(unfree.map((p) => `${p.name} ${p.license}`)).toEqual([]);
    // Die Schriften stehen unter der OFL und ihr Text geht mit.
    const font = found.find((p) => p.name === '@fontsource/inter');
    expect(font?.license).toBe('OFL-1.1');
    expect(font?.texts.length).toBeGreaterThan(0);
  });
});
