// Gemeinsame Hilfen für Secret-Scan und Privacy-Check: Dateien auflisten und lesen.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 5 * 1024 * 1024;

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function splitZ(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length > 0);
}

export function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

/**
 * Liefert die zu prüfenden Dateien.
 *  - staged: Inhalt aus dem Index (genau das, was committet würde)
 *  - all:    getrackte und nicht ignorierte, ungetrackte Dateien aus dem Arbeitsverzeichnis
 *  - files:  explizit übergebene Pfade (relativ zum aktuellen Verzeichnis)
 * Rückgabe: { entries: [{ path, content }], skipped: [{ path, reason }] }
 */
export function collectFiles(mode, explicit = []) {
  const entries = [];
  const skipped = [];

  const add = (path, read) => {
    let content;
    try {
      content = read();
    } catch {
      skipped.push({ path, reason: 'nicht lesbar' });
      return;
    }
    if (content.length > MAX_BYTES) {
      skipped.push({ path, reason: 'zu groß' });
      return;
    }
    if (isBinary(content)) {
      skipped.push({ path, reason: 'binär' });
      return;
    }
    entries.push({ path, content: content.toString('utf8') });
  };

  if (mode === 'staged') {
    const names = splitZ(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
    for (const path of names) add(path, () => git(['show', `:${path}`]));
  } else if (mode === 'all') {
    const names = splitZ(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
    for (const path of names) {
      add(path, () => {
        const full = join(repoRoot, path);
        if (!statSync(full).isFile()) throw new Error('keine Datei');
        return readFileSync(full);
      });
    }
  } else {
    for (const path of explicit) add(path, () => readFileSync(path));
  }

  return { entries, skipped };
}

/** Wertet die gemeinsamen Argumente von Scan und Check aus. */
export function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('--staged')) return { mode: 'staged', files: [] };
  if (args.includes('--all')) return { mode: 'all', files: [] };
  const index = args.indexOf('--files');
  if (index !== -1) return { mode: 'files', files: args.slice(index + 1) };
  return null;
}
