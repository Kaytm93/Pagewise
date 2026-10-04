import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleServer } from '@pagewise/server/bundle';
import { build } from 'esbuild';

/**
 * Baut alles, was die Mac-App braucht, nach `dist/`:
 *   main.cjs, preload.cjs   Hauptprozess und Preload (gebündelt, `electron` bleibt außen vor)
 *   shell/                  Seiten der Hüllen-Fenster (eigene CSP)
 *   assets/                 Menüleisten-Symbol
 *   server/                 gebündelter Server samt Oberfläche, Migrationen, Katalog, Binärdatei von better-sqlite3
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
  entryPoints: { main: join(root, 'src', 'main.ts'), preload: join(root, 'src', 'preload.ts') },
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
mkdirSync(join(dist, 'assets'), { recursive: true });
for (const file of ['trayTemplate.png', 'trayTemplate@2x.png']) {
  cpSync(join(root, 'assets', file), join(dist, 'assets', file));
}

const result = await bundleServer({
  outDir: join(dist, 'server'),
  platform: value('--platform') as NodeJS.Platform | undefined,
  arch: value('--arch'),
});
console.log(`Mac-App gebaut: ${dist} (Server: ${result.outDir})`);
