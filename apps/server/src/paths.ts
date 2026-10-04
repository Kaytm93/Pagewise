import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './config';

/** Wurzel dieser Anwendung (Repo-Ordner). Das Datenverzeichnis darf nicht darin liegen. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Wo der Server seine mitgelieferten Dateien findet (alles nur lesend, nie Nutzerdaten). */
export interface ResourcePaths {
  /** Ordner der Anwendung. Das Datenverzeichnis darf nicht darin liegen (D-005). */
  root: string;
  /** Gebaute Oberfläche (`index.html` und `assets/`). */
  webDist: string;
  /** SQL-Dateien der Migrationen. */
  migrations: string;
  /** Katalog der Fachvorlagen. */
  catalogFile: string;
  /** Standard-Prompts je Fach. */
  defaultsDir: string;
  /** `package.json` mit der Version. */
  versionFile: string;
}

/** Aufbau im Repo: `apps/web/dist`, `apps/server/drizzle`, `config/`, `prompts/defaults`. */
export function repoResources(root: string = APP_ROOT): ResourcePaths {
  return {
    root,
    webDist: join(root, 'apps', 'web', 'dist'),
    migrations: join(root, 'apps', 'server', 'drizzle'),
    catalogFile: join(root, 'config', 'subject-catalog.json'),
    defaultsDir: join(root, 'prompts', 'defaults'),
    versionFile: join(root, 'apps', 'server', 'package.json'),
  };
}

/**
 * Flacher Aufbau für den gebündelten Server (die Mac-App, ein Ordner aus `pnpm --filter @pagewise/server bundle`):
 * `web/`, `drizzle/`, `config/subject-catalog.json`, `prompts/defaults/`, `package.json`.
 */
export function bundledResources(root: string): ResourcePaths {
  return {
    root,
    webDist: join(root, 'web'),
    migrations: join(root, 'drizzle'),
    catalogFile: join(root, 'config', 'subject-catalog.json'),
    defaultsDir: join(root, 'prompts', 'defaults'),
    versionFile: join(root, 'package.json'),
  };
}

/**
 * Wählt den Aufbau: `PAGEWISE_RESOURCES_DIR` (muss ein absoluter Pfad sein) bedeutet den flachen Aufbau des
 * gebündelten Servers, sonst gilt der Aufbau des Repos.
 */
export function resolveResources(env: NodeJS.ProcessEnv, override?: string | null): ResourcePaths {
  const configured = (override ?? env.PAGEWISE_RESOURCES_DIR)?.trim();
  if (!configured) return repoResources();
  if (!isAbsolute(configured)) {
    throw new ConfigError(
      `PAGEWISE_RESOURCES_DIR muss ein absoluter Pfad sein (aktuell: "${configured}").`,
    );
  }
  return bundledResources(resolve(configured));
}
