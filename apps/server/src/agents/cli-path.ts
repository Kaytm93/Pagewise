import { stat } from 'node:fs/promises';
import { basename, isAbsolute, normalize } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';

const KEY = 'agent.cliPath';
const MAX_LENGTH = 1024;

/** Warum ein Pfad abgelehnt wurde (`invalid_input`, Feld `path`); `null` meint: schon das Format war unzulässig. */
export type CliPathCheckFailure = 'not_found' | 'not_executable' | null;

/** Ergebnis der Prüfung eines von Hand eingetragenen Pfads. */
export type CliPathCheck = { ok: true; path: string } | { ok: false; reason: CliPathCheckFailure };

/**
 * Prüft einen von Hand eingetragenen Pfad zu „claude“. Er ist eine Einstellung der angemeldeten Person und wird
 * später als Programm gestartet. Damit eine gestohlene Sitzung daraus keinen beliebigen Programmstart macht, gilt:
 * absolut, ohne Umwege (`..`), ohne Steuerzeichen, und die Datei heißt `claude`. Die Datei muss außerdem vorhanden
 * und ausführbar sein, damit „Pfad gespeichert.“ nie einen Pfad bestätigt, mit dem der Agent sicher scheitert.
 * Gibt das Prüfergebnis mit bereinigtem Pfad oder Grund zurück.
 * (Über die Umgebungsvariable `PAGEWISE_CLAUDE_PATH` setzt der Besitzer den Pfad ohne diese Einschränkung.)
 */
export async function checkCliPath(input: string): Promise<CliPathCheck> {
  const path = validateCliPath(input);
  if (path === null) return { ok: false, reason: null };
  try {
    const info = await stat(path);
    // Das Ausführungsbit für irgendjemanden genügt: der Server startet das Programm mit den Rechten seines Kontos.
    if (!info.isFile() || !(info.mode & 0o111)) return { ok: false, reason: 'not_executable' };
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, path };
}

/**
 * Prüft das Format eines Pfads zu „claude“ (absolut, ohne `..`, Dateiname `claude`) ohne Blick auf das
 * Dateisystem. Gibt den bereinigten Pfad zurück oder `null`.
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
