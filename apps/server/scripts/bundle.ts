import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Baut den Server als Bundle für die Mac-App (und jeden, der den Server ohne `node_modules` und ohne Repo-Aufbau
 * ausliefern will). Ergebnis ist ein flacher Ordner (siehe `bundledResources` in `src/paths.ts`):
 *
 *   pagewise-server.mjs     Befehlszeile (wie `pnpm start`)
 *   pagewise-embedded.mjs   Einstieg für die Mac-App (utilityProcess, Steuerkanal über IPC)
 *   better_sqlite3.node     Binärdatei von better-sqlite3 (Node-API, fertige Prebuilds, wird nicht kompiliert)
 *   web/  drizzle/  config/  prompts/defaults/  package.json   Ressourcen
 *
 * Alles andere steckt in den beiden .mjs-Dateien (kein `node_modules` nötig). Die Lizenzhinweise der gebündelten
 * Pakete stehen daneben (`*.LEGAL.txt`).
 */

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(serverDir, '..', '..');

export interface BundleOptions {
  outDir: string;
  /** Gebaute Oberfläche. Standard: `apps/web/dist`, wenn es sie gibt. `null` lässt sie weg. */
  webDist?: string | null;
  /** Für welches System die Binärdatei von better-sqlite3 kopiert wird. Standard: dieses. */
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface BundleResult {
  outDir: string;
  entries: { cli: string; embedded: string };
  sqliteBinding: string;
}

/** Kopiert nur Dateien einer Endung (Standard-Prompts: nur `.md`), keine versehentlichen Zusätze. */
function copyOnly(from: string, to: string, extension: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.endsWith(extension)) cpSync(join(from, name), join(to, name));
  }
}

export async function bundleServer(options: BundleOptions): Promise<BundleResult> {
  const outDir = resolve(options.outDir);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const version =
    (JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8')) as { version?: string })
      .version ?? '0.0.0';

  await build({
    entryPoints: {
      'pagewise-server': join(serverDir, 'src', 'main.ts'),
      'pagewise-embedded': join(serverDir, 'src', 'embedded.ts'),
    },
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // Nur die Binärdatei von better-sqlite3 liegt daneben, alles andere ist im Bundle.
    define: { __PAGEWISE_BUNDLE__: 'true', 'process.env.NODE_ENV': '"production"' },
    banner: {
      // Gebündelte CommonJS-Pakete (better-sqlite3) brauchen `require`.
      js: "import { createRequire as __pwCreateRequire } from 'node:module';\nconst require = __pwCreateRequire(import.meta.url);",
    },
    legalComments: 'external',
    logLevel: 'warning',
  });

  // Binärdatei: better-sqlite3 liefert Prebuilds für macOS, Linux und Windows mit (D-017).
  const sqliteDir = dirname(
    createRequire(join(serverDir, 'package.json')).resolve('better-sqlite3/package.json'),
  );
  const prebuild = join(sqliteDir, 'prebuilds', `${platform}-${arch}.node`);
  if (!existsSync(prebuild)) {
    throw new Error(
      `better-sqlite3 hat kein fertiges Prebuild für ${platform}-${arch} (${prebuild}).`,
    );
  }
  const sqliteBinding = join(outDir, 'better_sqlite3.node');
  cpSync(prebuild, sqliteBinding);

  // Ressourcen (nur lesend): Migrationen, Katalog, Standard-Prompts, Oberfläche, Version.
  cpSync(join(serverDir, 'drizzle'), join(outDir, 'drizzle'), { recursive: true });
  mkdirSync(join(outDir, 'config'), { recursive: true });
  cpSync(
    join(repoRoot, 'config', 'subject-catalog.json'),
    join(outDir, 'config', 'subject-catalog.json'),
  );
  copyOnly(join(repoRoot, 'prompts', 'defaults'), join(outDir, 'prompts', 'defaults'), '.md');
  const webDist =
    options.webDist === undefined ? join(repoRoot, 'apps', 'web', 'dist') : options.webDist;
  if (webDist) {
    if (!existsSync(join(webDist, 'index.html'))) {
      throw new Error(
        `Die Oberfläche ist nicht gebaut (${webDist}/index.html fehlt). Erst „pnpm --filter @pagewise/web build“.`,
      );
    }
    cpSync(webDist, join(outDir, 'web'), { recursive: true });
  }
  writeFileSync(
    join(outDir, 'package.json'),
    `${JSON.stringify({ name: 'pagewise-server', version, private: true, type: 'module' }, null, 2)}\n`,
  );

  return {
    outDir,
    entries: {
      cli: join(outDir, 'pagewise-server.mjs'),
      embedded: join(outDir, 'pagewise-embedded.mjs'),
    },
    sqliteBinding,
  };
}

// Aufruf: tsx scripts/bundle.ts --out <Ordner> [--no-web] [--web <Ordner>] [--platform darwin] [--arch arm64]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = value('--out');
  if (!out) {
    console.error(
      'Aufruf: bundle.ts --out <Ordner> [--no-web] [--web <Ordner>] [--platform <p>] [--arch <a>]',
    );
    process.exit(2);
  }
  bundleServer({
    outDir: out,
    webDist: args.includes('--no-web') ? null : (value('--web') ?? undefined),
    platform: value('--platform') as NodeJS.Platform | undefined,
    arch: value('--arch'),
  })
    .then((result) => console.log(`Server gebündelt: ${result.outDir}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
