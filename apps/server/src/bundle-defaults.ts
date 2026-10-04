import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Wird vom Bundle-Skript (esbuild `define`) auf `true` gesetzt, im Quelltext (`tsx`, Tests) gibt es sie nicht. */
declare const __PAGEWISE_BUNDLE__: boolean | undefined;

/**
 * Im gebündelten Server liegen Ressourcen (Oberfläche, Migrationen, Katalog, Standard-Prompts) und die Binärdatei von
 * better-sqlite3 neben der Bundle-Datei. Gilt nur, wenn die Umgebung nichts anderes vorgibt.
 */
export function bundleDefaults(env: NodeJS.ProcessEnv): {
  resourcesDir?: string;
  sqliteBinding?: string;
} {
  if (typeof __PAGEWISE_BUNDLE__ === 'undefined' || !__PAGEWISE_BUNDLE__) return {};
  const dir = dirname(fileURLToPath(import.meta.url));
  return {
    ...(env.PAGEWISE_RESOURCES_DIR?.trim() ? {} : { resourcesDir: dir }),
    ...(env.PAGEWISE_SQLITE_BINDING?.trim()
      ? {}
      : { sqliteBinding: join(dir, 'better_sqlite3.node') }),
  };
}
