// Holt die Binärdatei von Electron, wenn sie fehlt. `pnpm install` tut es bewusst nicht (rund 280 MB, Web und Server
// brauchen sie nicht, siehe pnpm-workspace.yaml). Der Download kommt von GitHub-Releases über `@electron/get`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dir = dirname(require.resolve('electron/package.json'));
if (!existsSync(join(dir, 'path.txt')) || !existsSync(join(dir, 'dist'))) {
  console.log('Electron wird geladen (einmalig) …');
  const result = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(
      'Der Download von Electron ist gescheitert (Netz oder Proxy). Es wird nichts umgangen.',
    );
    process.exit(result.status ?? 1);
  }
}
