import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { settings } from '../db/schema';
import type { SecretStore } from '../storage/secret-store';
import { ToolError } from '../tools/registry';
import { BraveSearchError, braveSearch } from './brave';
import type { WebResult, WebSearch } from './types';

/** Name des Schlüssels im Secret-Speicher, wie bei den Anbietern unter `provider.<id>.key` (D-026). */
export const SEARCH_KEY = 'search.key';
const ENABLED_KEY = 'tools.web.enabled';
/** Höchstens so viele Suchen je Minute, damit ein fehlerhaftes Modell das Kontingent nicht leert. */
export const MAX_SEARCHES_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
/** Neutrale, feste Suche für den Verbindungstest. Sie enthält nichts aus dem Datenbestand. */
const TEST_QUERY = 'Wikipedia';

export interface WebSearchStatus {
  enabled: boolean;
  hasKey: boolean;
  /** Letzte vier Zeichen des Schlüssels, nur bei langen Schlüsseln. Nie der Schlüssel selbst. */
  keyHint: string | null;
}

export type WebSearchTest = { ok: true; results: number } | { ok: false; error: string };

export interface WebSearchServiceOptions {
  /** Nur für Tests: ersetzt `fetch` für Anfragen an den Suchdienst. */
  fetch?: typeof fetch;
  /** Nur für Tests: feste Zeit in Millisekunden. */
  now?: () => number;
}

/**
 * Websuche für Chat-Modelle (Werkzeug `web_search`). Pagewise ruft den Dienst selbst auf, mit dem
 * gespeicherten Schlüssel. Standardmäßig aus: Suchbegriffe, die das Modell schreibt, verlassen das Gerät.
 */
export class WebSearchService implements WebSearch {
  private recent: number[] = [];

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore,
    private readonly options: WebSearchServiceOptions = {},
  ) {}

  /** Standard: aus. Nur ein gespeicherter Wert „true“ schaltet die Suche ein. */
  enabled(): boolean {
    const row = this.db.select().from(settings).where(eq(settings.key, ENABLED_KEY)).get();
    if (!row) return false;
    try {
      return JSON.parse(row.value) === true;
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    const json = JSON.stringify(enabled);
    this.db
      .insert(settings)
      .values({ key: ENABLED_KEY, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }

  async status(): Promise<WebSearchStatus> {
    const info = (await this.secrets.list()).find((item) => item.name === SEARCH_KEY);
    return { enabled: this.enabled(), hasKey: info !== undefined, keyHint: info?.last4 ?? null };
  }

  /** Speichert den Schlüssel. Der Speicher prüft den Wert und nennt ihn in keiner Meldung. */
  async setKey(apiKey: string): Promise<void> {
    await this.secrets.set(SEARCH_KEY, apiKey);
  }

  async clearKey(): Promise<void> {
    await this.secrets.delete(SEARCH_KEY);
  }

  async available(): Promise<boolean> {
    return this.enabled() && (await this.secrets.has(SEARCH_KEY));
  }

  /** Suche für das Modell: nur wenn die Websuche eingeschaltet ist. */
  async search(query: string, count: number, signal?: AbortSignal): Promise<WebResult[]> {
    if (!this.enabled()) throw new ToolError('not_enabled');
    return this.query(query, count, signal);
  }

  /** Verbindungstest in den Einstellungen. Gibt nur die Anzahl der Treffer oder einen Code zurück. */
  async test(): Promise<WebSearchTest> {
    try {
      const results = await this.query(TEST_QUERY, 1);
      return { ok: true, results: results.length };
    } catch (error) {
      return { ok: false, error: error instanceof ToolError ? error.code : 'failed' };
    }
  }

  private async query(query: string, count: number, signal?: AbortSignal): Promise<WebResult[]> {
    const apiKey = await this.secrets.get(SEARCH_KEY);
    if (!apiKey) throw new ToolError('not_configured');
    this.takeSlot();
    try {
      return await braveSearch({ apiKey, query, count, fetch: this.options.fetch, signal });
    } catch (error) {
      if (error instanceof BraveSearchError) throw new ToolError(error.code);
      throw new ToolError('failed');
    }
  }

  /** Zählt Suchen je Minute. Fehler kommen als Code; der Zähler speichert keine Begriffe. */
  private takeSlot(): void {
    const now = (this.options.now ?? Date.now)();
    this.recent = this.recent.filter((time) => now - time < MINUTE_MS);
    if (this.recent.length >= MAX_SEARCHES_PER_MINUTE) throw new ToolError('rate_limited');
    this.recent.push(now);
  }
}
