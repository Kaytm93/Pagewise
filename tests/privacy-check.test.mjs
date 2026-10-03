import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkEntries, loadBlacklist } from '../scripts/check-privacy.mjs';
import { runNode } from './helpers.mjs';

// Erfundene Begriffe, nur für diese Tests.
const TERM = 'Zebrafisch-Testschule';

describe('Privacy-Check', () => {
  let dir;
  let blacklist;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pagewise-privacy-'));
    blacklist = join(dir, 'blacklist.txt');
    writeFileSync(blacklist, `# Kommentar\n\n${TERM}\nre:lehrer(in)?\\s+quark\n`);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('liest Begriffe und reguläre Ausdrücke, ignoriert Kommentare', () => {
    const patterns = loadBlacklist(blacklist);
    expect(patterns.map((pattern) => pattern.number)).toEqual([3, 4]);
  });

  it('findet Begriffe in Inhalt und Dateiname, unabhängig von der Schreibweise', () => {
    const patterns = loadBlacklist(blacklist);
    const findings = checkEntries(
      [
        { path: 'docs/a.md', content: 'nichts\nWir gehen auf die zebrafisch-testschule.' },
        { path: 'docs/zebrafisch-testschule-notizen.md', content: 'harmlos' },
        { path: 'docs/b.md', content: 'Lehrerin  Quark hat gesagt' },
      ],
      patterns,
    );
    expect(findings).toEqual([
      { path: 'docs/a.md', line: 2, entry: 3 },
      { path: 'docs/zebrafisch-testschule-notizen.md', line: 0, entry: 3 },
      { path: 'docs/b.md', line: 1, entry: 4 },
    ]);
  });

  it('meldet einen Fund per CLI, ohne den Begriff auszugeben', () => {
    const file = join(dir, 'notiz.md');
    writeFileSync(file, `Besuch bei ${TERM}\n`);
    const result = runNode('scripts/check-privacy.mjs', ['--files', file], {
      env: { ...process.env, PAGEWISE_PRIVACY_BLACKLIST: blacklist },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('notiz.md:1');
    expect(result.stderr).not.toContain(TERM);
  });

  it('besteht ohne Blacklist-Datei', () => {
    const file = join(dir, 'egal.md');
    writeFileSync(file, 'Inhalt\n');
    const result = runNode('scripts/check-privacy.mjs', ['--files', file], {
      env: { ...process.env, PAGEWISE_PRIVACY_BLACKLIST: join(dir, 'gibt-es-nicht.txt') },
    });
    expect(result.status).toBe(0);
  });

  it('bricht bei ungültigem regulärem Ausdruck mit Exit-Code 2 ab', () => {
    const broken = join(dir, 'kaputt.txt');
    writeFileSync(broken, 're:(offen\n');
    const file = join(dir, 'egal2.md');
    writeFileSync(file, 'Inhalt\n');
    const result = runNode('scripts/check-privacy.mjs', ['--files', file], {
      env: { ...process.env, PAGEWISE_PRIVACY_BLACKLIST: broken },
    });
    expect(result.status).toBe(2);
  });
});
