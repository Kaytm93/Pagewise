// Abnahme Phase 0: Ein absichtlich eingecheckter Fake-Key wird vom Hook blockiert.
// Der Test baut ein temporäres Git-Repo mit Kopien von Hook und Skripten.
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeKeys, root, run } from './helpers.mjs';

describe('Pre-Commit-Hook', () => {
  let repo;
  let blacklist;
  const baseEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };

  const git = (args, env = baseEnv) => run('git', args, { cwd: repo, env });
  const commit = (file, content, env = baseEnv) => {
    writeFileSync(join(repo, file), content);
    git(['add', file], env);
    return git(['commit', '-m', `test: ${file}`], env);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'schulheft-hook-'));
    blacklist = join(repo, '..', `${repo.split('/').pop()}-blacklist.txt`);
    git(['init', '-b', 'main']);
    cpSync(join(root, 'scripts'), join(repo, 'scripts'), { recursive: true });
    cpSync(join(root, '.githooks'), join(repo, '.githooks'), { recursive: true });
    chmodSync(join(repo, '.githooks', 'pre-commit'), 0o755);
    git(['config', 'core.hooksPath', '.githooks']);
    git(['config', 'commit.gpgsign', 'false']);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(blacklist, { force: true });
  });

  it('blockiert einen Commit mit Fake-Key und gibt den Wert nicht aus', () => {
    const secret = fakeKeys['openrouter-key'];
    const result = commit('leak.txt', `OPENROUTER=${secret}\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-scan');
    expect(result.stderr).toContain('leak.txt:1');
    expect(result.stderr).not.toContain(secret);
    expect(git(['rev-parse', '--verify', 'HEAD']).status).not.toBe(0);
    git(['reset', '-q']);
    rmSync(join(repo, 'leak.txt'));
  });

  it('lässt einen sauberen Commit durch', () => {
    const result = commit('sauber.txt', 'Hallo Welt\n');
    expect(result.status).toBe(0);
    expect(git(['rev-parse', '--verify', 'HEAD']).status).toBe(0);
  });

  it('blockiert Begriffe aus der lokalen Blacklist', () => {
    writeFileSync(blacklist, 'Zebrafisch-Testschule\n');
    const env = { ...baseEnv, SCHULHEFT_PRIVACY_BLACKLIST: blacklist };
    const result = commit('privat.md', 'Ich gehe auf die Zebrafisch-Testschule.\n', env);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('privacy-check');
    expect(result.stderr).not.toContain('Zebrafisch');
    git(['reset', '-q'], env);
    rmSync(join(repo, 'privat.md'));
  });
});
