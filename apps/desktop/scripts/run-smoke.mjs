// Startet die gebaute App mit --smoke-test: ohne Fenster, Server starten, /api/health fragen, Exit-Code 0 oder 1.
// Unter Linux ohne Bildschirm läuft sie unter xvfb-run. `--no-sandbox` gibt es nur, wenn der Rechner als Root läuft
// (Container): Electron weigert sich sonst zu starten. Auf dem Mac und für normale Nutzer wird es nie gesetzt.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
// Chromium-Schalter müssen vor dem App-Pfad stehen, sonst gibt Electron sie nicht an seine Kindprozesse weiter.
const flags = [];
if (process.platform === 'linux') {
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  flags.push('--disable-gpu', '--disable-dev-shm-usage');
}
flags.push('.', '--smoke-test');
const needsDisplay = process.platform === 'linux' && !process.env.DISPLAY;
const [command, args] = needsDisplay ? ['xvfb-run', ['-a', electron, ...flags]] : [electron, flags];
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
});
process.exit(result.status ?? 1);
