import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanText } from '../scripts/secret-scan.mjs';
import { fakeKeys, genericAssignment, runNode } from './helpers.mjs';

describe('scanText', () => {
  it.each(Object.entries(fakeKeys))('erkennt %s', (rule, value) => {
    const findings = scanText(`const wert = '${value}';`, 'beispiel.ts');
    expect(findings.map((finding) => finding.rule)).toContain(rule);
  });

  it('erkennt allgemeine Zuweisungen', () => {
    const findings = scanText(genericAssignment, 'beispiel.env');
    expect(findings.map((finding) => finding.rule)).toContain('generic-assignment');
  });

  it('meldet Zeilennummern', () => {
    const findings = scanText(`erste Zeile\n${genericAssignment}`, 'beispiel.env');
    expect(findings[0]?.line).toBe(2);
  });

  it('ignoriert Platzhalter und gewöhnlichen Code', () => {
    const text = [
      'API_KEY=your_key_here_please_replace_1',
      'PAGEWISE_PORT=3000',
      'password: process.env.PASSWORD_VALUE_123',
      'const tokenizer = new Tokenizer(options);',
      'const secretKey = deriveKeyFromPasscode(passcode);',
      'token: tokenValueFromTheSessionStore',
    ].join('\n');
    expect(scanText(text)).toEqual([]);
  });

  it('nimmt Zeilen mit dem Marker aus', () => {
    const line = `${genericAssignment} // secret-scan:allow`;
    expect(scanText(line)).toEqual([]);
  });
});

describe('secret-scan CLI', () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pagewise-scan-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('meldet einen Fund, ohne den Wert auszugeben', () => {
    const file = join(dir, 'leak.txt');
    writeFileSync(file, `x = '${fakeKeys['openrouter-key']}'\n`);
    const result = runNode('scripts/secret-scan.mjs', ['--files', file]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('openrouter-key');
    expect(result.stderr).toContain('leak.txt:1');
    expect(result.stderr).not.toContain(fakeKeys['openrouter-key']);
    expect(result.stdout).not.toContain(fakeKeys['openrouter-key']);
  });

  it('besteht bei sauberen Dateien', () => {
    const file = join(dir, 'clean.txt');
    writeFileSync(file, 'Hallo Welt\n');
    const result = runNode('scripts/secret-scan.mjs', ['--files', file]);
    expect(result.status).toBe(0);
  });

  it('bricht ohne Argumente mit Exit-Code 2 ab', () => {
    const result = runNode('scripts/secret-scan.mjs', []);
    expect(result.status).toBe(2);
  });

  it('findet im echten Repo nichts', () => {
    const result = runNode('scripts/secret-scan.mjs', ['--all']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
