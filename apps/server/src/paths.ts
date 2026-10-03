import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Wurzel dieser Anwendung (Repo-Ordner). Das Datenverzeichnis darf nicht darin liegen. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
