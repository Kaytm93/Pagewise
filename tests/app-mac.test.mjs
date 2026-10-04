import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtAppPath, parseArgs, UsageError } from '../scripts/app-mac.mjs';
import { root, runNode } from './helpers.mjs';

describe('app:mac (Befehlszeile)', () => {
  it('nimmt die Architektur des Macs und ~/Applications als Voreinstellung', () => {
    expect(parseArgs([], 'arm64', '/Users/beispiel')).toEqual({
      arch: 'arm64',
      install: true,
      dest: '/Users/beispiel/Applications',
    });
    expect(parseArgs([], 'x64', '/Users/beispiel').arch).toBe('x64');
    // Unbekannte Architektur (nicht für Mac gebaut): Apple-Silizium als Voreinstellung.
    expect(parseArgs([], 'ia32', '/Users/beispiel').arch).toBe('arm64');
  });

  it('versteht die Optionen und lehnt Unbekanntes ab', () => {
    expect(
      parseArgs(['--no-install', '--arch', 'x64', '--dest', '/tmp/ziel'], 'arm64', '/h'),
    ).toEqual({
      arch: 'x64',
      install: false,
      dest: '/tmp/ziel',
    });
    expect(() => parseArgs(['--arch', 'ppc'], 'arm64', '/h')).toThrow(UsageError);
    expect(() => parseArgs(['--arch'], 'arm64', '/h')).toThrow(UsageError);
    expect(() => parseArgs(['--dest'], 'arm64', '/h')).toThrow(UsageError);
    expect(() => parseArgs(['--force'], 'arm64', '/h')).toThrow(UsageError);
  });

  it('kennt den Ort der gebauten App', () => {
    expect(builtAppPath('arm64', '/repo')).toBe(
      join('/repo', 'apps', 'desktop', 'out', 'Pagewise-darwin-arm64', 'Pagewise.app'),
    );
  });

  it('bricht außerhalb von macOS mit einer klaren Meldung ab und baut nichts', () => {
    if (process.platform === 'darwin') return;
    const result = runNode('scripts/app-mac.mjs', []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('nur auf einem Mac');
  });

  it('meldet falsche Aufrufe mit Exit 2', () => {
    const result = runNode('scripts/app-mac.mjs', ['--unbekannt'], { cwd: root });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unbekannte Option');
  });

  it('der Quelltext benutzt keine Shell und kein Flag, das Abfragen überspringt', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(root, 'scripts', 'app-mac.mjs'), 'utf8');
    expect(source).not.toMatch(/shell:\s*true/);
    expect(source).not.toMatch(/\bexec\(|execSync\(/);
    expect(source).not.toMatch(/dangerously|--force-all|skip-permissions/);
  });
});
