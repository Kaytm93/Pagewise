import { basename, isAbsolute, normalize } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';

const KEY = 'agent.cliPath';
const MAX_LENGTH = 1024;

/**
 * Prüft einen von Hand eingetragenen Pfad zu „claude“. Er ist eine Einstellung der angemeldeten Person und wird
 * später als Programm gestartet. Damit eine gestohlene Sitzung daraus keinen beliebigen Programmstart macht, gilt:
 * absolut, ohne Umwege (`..`), ohne Steuerzeichen, und die Datei heißt `claude`. Gibt den bereinigten Pfad zurück oder `null`.
 * (Über die Umgebungsvariable `PAGEWISE_CLAUDE_PATH` setzt der Besitzer den Pfad ohne diese Einschränkung.)
 */
export function validateCliPath(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed.length > MAX_LENGTH) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind genau das, was abgelehnt wird
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (!isAbsolute(trimmed) || /[\\/]$/.test(trimmed)) return null;
  if (trimmed.split(/[\\/]/).includes('..')) return null;
  const normalized = normalize(trimmed);
  if (basename(normalized) !== 'claude') return null;
  return normalized;
}

/** Der eingetragene Pfad zu „claude“ (Tabelle `settings`). Hat Vorrang vor der Umgebungsvariable und der Suche. */
export class CliPathSetting {
  constructor(private readonly db: Db) {}

  get(): string | null {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    if (!row) return null;
    try {
      const value: unknown = JSON.parse(row.value);
      return typeof value === 'string' ? validateCliPath(value) : null;
    } catch {
      return null;
    }
  }

  /** `null` entfernt die Einstellung. Ungültige Pfade werden vor dem Aufruf abgelehnt (siehe `validateCliPath`). */
  set(path: string | null): void {
    if (path === null) {
      this.db.delete(settings).where(eq(settings.key, KEY)).run();
      return;
    }
    const json = JSON.stringify(path);
    this.db
      .insert(settings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }
}
