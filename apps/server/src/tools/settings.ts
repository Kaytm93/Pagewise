import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';

const KEY = 'tools.enabled';
const FILES_KEY = 'tools.files';
const CODE_KEY = 'tools.code';

/**
 * Der globale Schalter „KI darf Stundenplan und Tests einsehen“ (Voreinstellung: an). Zusätzlich muss der
 * Anbieter es erlauben und das Modell Werkzeuge können; nur wenn alles zusammenkommt, geht der Aufruf los.
 */
export class ToolSettings {
  constructor(private readonly db: Db) {}

  private read(key: string, fallback = true): boolean {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try {
      const value: unknown = JSON.parse(row.value);
      return fallback ? value !== false : value === true;
    } catch {
      return fallback;
    }
  }

  private write(key: string, enabled: boolean): void {
    const json = JSON.stringify(enabled);
    this.db
      .insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }

  enabled(): boolean {
    return this.read(KEY);
  }

  setEnabled(enabled: boolean): void {
    this.write(KEY, enabled);
  }

  /** „KI darf Dateien erstellen“ (Dokument, Präsentation …). Voreinstellung: an (D-074). */
  filesEnabled(): boolean {
    return this.read(FILES_KEY);
  }

  setFilesEnabled(enabled: boolean): void {
    this.write(FILES_KEY, enabled);
  }

  /** „KI darf Code ausführen“ (Python in der Sandbox, D-079). Voreinstellung: aus. */
  codeEnabled(): boolean {
    return this.read(CODE_KEY, false);
  }

  setCodeEnabled(enabled: boolean): void {
    this.write(CODE_KEY, enabled);
  }
}
