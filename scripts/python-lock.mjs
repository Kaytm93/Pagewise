#!/usr/bin/env node
// Erzeugt apps/server/src/python/lock.ts aus apps/server/python/requirements.in (D-079).
// Braucht `uv` (https://docs.astral.sh/uv/) und Netz: uv fragt bei pypi.org Versionen und Prüfsummen ab, lädt aber
// keine Pakete in dein System. Programme laufen mit execFile ohne Shell; die Umgebung wird nicht weitergereicht.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = join(root, 'apps/server/python/requirements.in');
const output = join(root, 'apps/server/src/python/lock.ts');
const PYTHON_VERSION = '3.13';
const PLATFORMS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};
const uv = process.env.UV_PATH || 'uv';

const locks = {};
for (const [key, platform] of Object.entries(PLATFORMS)) {
  const text = execFileSync(
    uv,
    [
      'pip',
      'compile',
      input,
      '--python-version',
      PYTHON_VERSION,
      '--python-platform',
      platform,
      '--generate-hashes',
      '--only-binary',
      ':all:',
      '--no-header',
      '--no-annotate',
      '--quiet',
    ],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '' },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  locks[key] = `${text.trim()}\n`;
}

const current = readFileSync(output, 'utf8');
const marker = 'export const REQUIREMENTS_LOCK';
const start = current.indexOf(marker);
const end = current.indexOf('\n\n/** Module, die nach der Einrichtung', start);
if (start === -1 || end === -1) throw new Error('lock.ts hat nicht die erwartete Form.');
const body = Object.entries(locks)
  .map(
    ([key, text]) =>
      `  '${key}': \`${text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\`,`,
  )
  .join('\n');
const next = `${current.slice(0, start)}export const REQUIREMENTS_LOCK: Readonly<Partial<Record<PlatformKey, string>>> = {\n${body}\n};${current.slice(end)}`;
writeFileSync(output, next);
console.log(`lock.ts geschrieben: ${Object.keys(locks).join(', ')}`);
