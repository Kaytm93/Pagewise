import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleServer } from '@pagewise/server/bundle';
import { build } from 'esbuild';
import { collectLicenses, renderLicenses } from './licenses';

/**
 * Baut alles, was die Mac-App braucht, nach `dist/`:
 *   main.cjs, preload.cjs   Hauptprozess und Preload (gebündelt, `electron` bleibt außen vor)
 *   shell/                  Seiten der Hüllen-Fenster (eigene CSP)
 *   assets/                 Menüleisten-Symbol
 *   server/                 gebündelter Server samt Oberfläche, Migrationen, Katalog, Binärdatei von better-sqlite3
 *   licenses/               Lizenzhinweise der gebündelten Pakete (kommt als Resources/licenses in die App)
 *
 * Aufruf: tsx scripts/build.ts [--skip-web] [--platform darwin] [--arch arm64]
 * `--platform` und `--arch` bestimmen, welche Binärdatei von better-sqlite3 mitgeht (Standard: dieses System).
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = resolve(root, '..', '..');
const dist = join(root, 'dist');

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (!args.includes('--skip-web')) {
  execFileSync('pnpm', ['--filter', '@pagewise/web', 'build'], { cwd: repo, stdio: 'inherit' });
}

await build({
  entryPoints: {
    main: join(root, 'src', 'main.ts'),
    preload: join(root, 'src', 'preload.ts'),
    // Startseite der Hülle: gebündelt, damit sie die Texte aus `i18n.ts` bekommt (statt hartem Text).
    starting: join(root, 'src', 'starting.ts'),
  },
  outdir: dist,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});

cpSync(join(root, 'src', 'shell'), join(dist, 'shell'), { recursive: true });
renameSync(join(dist, 'starting.cjs'), join(dist, 'shell', 'starting.js'));
mkdirSync(join(dist, 'assets'), { recursive: true });
for (const file of ['trayTemplate.png', 'trayTemplate@2x.png']) {
  cpSync(join(root, 'assets', file), join(dist, 'assets', file));
}

const result = await bundleServer({
  outDir: join(dist, 'server'),
  platform: value('--platform') as NodeJS.Platform | undefined,
  arch: value('--arch'),
});
// Lizenzhinweise der Pakete, die in Server, Oberfläche und Hülle stecken (siehe `licenses.ts`). Die Hülle bündelt nur
// `uqr` (steht bei den Entwicklungsabhängigkeiten, weil alles gebündelt wird).
const licenseDir = join(dist, 'licenses');
mkdirSync(licenseDir, { recursive: true });
const packages = collectLicenses([
  { dir: join(repo, 'apps', 'server') },
  { dir: join(repo, 'apps', 'web') },
  { dir: join(repo, 'packages', 'render') },
  { dir: root, names: ['uqr'] },
]);
writeFileSync(join(licenseDir, 'THIRD-PARTY-LICENSES.txt'), renderLicenses(packages));

console.log(`Mac-App gebaut: ${dist} (Server: ${result.outDir})`);
