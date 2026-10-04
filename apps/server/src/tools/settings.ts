import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';

const KEY = 'tools.enabled';

/**
 * Der globale Schalter „KI darf Stundenplan und Tests einsehen“ (Voreinstellung: an). Zusätzlich muss der
 * Anbieter es erlauben und das Modell Werkzeuge können; nur wenn alles zusammenkommt, geht der Aufruf los.
 */
export class ToolSettings {
  constructor(private readonly db: Db) {}

  enabled(): boolean {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    if (!row) return true;
    try {
      return JSON.parse(row.value) !== false;
    } catch {
      return true;
    }
  }

  setEnabled(enabled: boolean): void {
    const json = JSON.stringify(enabled);
    this.db
      .insert(settings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }
}
