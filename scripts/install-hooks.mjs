#!/usr/bin/env node
// Aktiviert die Git-Hooks aus .githooks. Läuft bei "pnpm install" (prepare).
// Ohne Git-Arbeitsverzeichnis (z. B. in einem Docker-Build) tut das Skript nichts.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  if (!existsSync(join(root, '.git')) || !existsSync(join(root, '.githooks'))) process.exit(0);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
  console.log('Git-Hooks aktiviert (.githooks).');
} catch {
  // Kein Git verfügbar: kein Fehler, nur kein Hook.
}
