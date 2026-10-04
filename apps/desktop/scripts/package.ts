import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

/**
 * Packt `Pagewise.app` (Stufe 1, D-053): lokal gebaut, ohne Developer-ID-Signatur und ohne Notarisierung.
 * Aufruf: tsx scripts/package.ts [--platform darwin] [--arch arm64] [--skip-build]
 *
 * Warum nicht Electron Forge: Forge 8 verlangt bei pnpm `node-linker=hoisted` für den ganzen Workspace, das würde
 * Web und Server umkrempeln. Die App hat keine Laufzeitabhängigkeiten (alles ist gebündelt), deshalb nutzen wir den
 * Packager, den Forge intern aufruft (`@electron/packager`), direkt. Makers (DMG) und Publisher von Forge wären
 * Stufe 2.
 *
 * Stufe 2 (vorbereitet, nicht aktiv): `osxSign` mit Developer ID, Hardened Runtime und Entitlements für Node und
 * Bibliotheken (`com.apple.security.cs.allow-jit` für V8, `com.apple.security.cs.disable-library-validation` für die
 * Binärdatei von better-sqlite3, oder `allowLoadingUnsignedLibraries` beim utilityProcess), `osxNotarize`.
 * Zugangsdaten kämen ausschließlich aus GitHub-Actions-Secrets, nie in dieses Repository.
 */
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const platform = (value('--platform') ?? 'darwin') as 'darwin' | 'linux' | 'win32';
const arch = (value('--arch') ?? 'arm64') as 'arm64' | 'x64';

if (!args.includes('--skip-build')) {
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(root, 'scripts', 'build.ts'),
      '--platform',
      platform,
      '--arch',
      arch,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

const [appDir] = await packager({
  dir: root,
  out: join(root, 'out'),
  overwrite: true,
  platform,
  arch,
  name: 'Pagewise',
  executableName: 'Pagewise',
  appBundleId: 'io.github.kaytm93.pagewise',
  appCategoryType: 'public.app-category.education',
  icon: join(root, 'assets', 'icon'),
  asar: true,
  prune: false,
  // Nur das Gebaute kommt in die App: kein Quelltext, kein node_modules (alles ist gebündelt). Der Server liegt als
  // eigener Ordner neben dem Archiv (`Resources/server`): `pagewise-embedded.mjs` und die Binärdatei von
  // better-sqlite3 müssen als echte Dateien daliegen (ein Archiv kann keine .node-Datei laden).
  ignore: (path: string) => {
    if (path === '') return false;
    return !(path === '/package.json' || path === '/dist' || path.startsWith('/dist/'));
  },
  extraResource: [join(root, 'dist', 'server')],
  quiet: true,
});

if (!appDir) throw new Error('Der Packager hat keinen Ordner geliefert.');

if (platform === 'darwin') {
  const app = join(appDir, 'Pagewise.app');
  if (process.platform === 'darwin') {
    // Ad-hoc-Signatur (ohne Identität): Auf Apple-Silizium startet ein verändertes Paket sonst nicht. Kein Hardened
    // Runtime, damit die unsigniert mitgelieferte Binärdatei von better-sqlite3 geladen werden darf.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  } else {
    console.warn(
      'Hinweis: Auf diesem System lässt sich nicht signieren (codesign gibt es nur auf macOS). Auf dem Mac läuft das beim Bauen.',
    );
  }
}
console.log(`Gepackt: ${appDir}`);
