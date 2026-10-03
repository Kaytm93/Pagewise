import { asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { providers, settings } from '../db/schema';
import { type SecretStore, SecretStoreError } from '../storage/secret-store';
import type { ProviderClient, Target, TestResult } from './client';
import type { ProviderErrorCode } from './errors';
import { ProviderError } from './errors';
import {
  isFreeModel,
  type ModelEntry,
  parseStoredModels,
  type Selection,
  SelectionSchema,
} from './models';
import { findPreset } from './presets';
import { isCodingPlanUrl, parseBaseUrl } from './url';

export interface ModelView extends ModelEntry {
  /** Kostenloses Modell: der Anbieter kann Prompts protokollieren, die Oberfläche warnt davor. */
  free: boolean;
}

export interface ProviderView {
  id: string;
  name: string;
  type: 'openai-compatible';
  preset: string;
  baseUrl: string;
  models: ModelView[];
  hasKey: boolean;
  /** Letzte vier Zeichen, nur bei langen Schlüsseln. Der Schlüssel selbst verlässt den Server nie. */
  keyHint: string | null;
  /** Hinweis, den die Oberfläche anzeigt (Coding-Plan-Adresse bei Z.ai). */
  warning: 'coding_plan' | null;
}

export interface ModelSettings {
  default: Selection | null;
  fallback: Selection[];
}

export interface AvailableModel {
  id: string;
  name: string | null;
  vision: boolean | null;
  tools: boolean | null;
  reasoning: boolean | null;
  free: boolean;
}

export type ServiceFailure =
  | {
      ok: false;
      error:
        | 'not_found'
        | 'name_taken'
        | 'invalid_url'
        | 'insecure_url'
        | 'invalid_key'
        | 'unknown_model';
    }
  | { ok: false; error: 'provider_failed'; code: ProviderErrorCode };
export type ServiceResult<T> = { ok: true; value: T } | ServiceFailure;

export interface CreateProviderInput {
  name: string;
  preset: string;
  baseUrl?: string;
  apiKey?: string;
  models?: ModelEntry[];
}

export interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  models?: ModelEntry[];
  /** Neuer Schlüssel. Ein leerer Wert wird vorher abgelehnt. */
  apiKey?: string;
  clearKey?: boolean;
}

const KEY_DEFAULT = 'models.default';
const KEY_FALLBACK = 'models.fallback';
export const MAX_FALLBACKS = 5;
const MAX_LISTED = 1000;

const FallbackSchema = z.array(SelectionSchema);

function secretName(providerId: string): string {
  return `provider.${providerId}.key`;
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.providerId === b.providerId && a.model === b.model;
}

/**
 * Verwaltet Anbieter (Datenbank) und ihre Schlüssel (Secret-Speicher). Schlüssel werden nur
 * geschrieben, gelöscht oder serverseitig für Anfragen gelesen, nie in einer Antwort zurückgegeben.
 */
export class ProviderService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore,
    readonly client: ProviderClient,
  ) {}

  private rows() {
    return this.db
      .select()
      .from(providers)
      .orderBy(asc(providers.position), asc(providers.createdAt), asc(providers.name))
      .all();
  }

  private toView(
    row: typeof providers.$inferSelect,
    hints: Map<string, string | null>,
  ): ProviderView {
    const name = secretName(row.id);
    return {
      id: row.id,
      name: row.name,
      type: 'openai-compatible',
      preset: row.preset,
      baseUrl: row.baseUrl,
      models: parseStoredModels(row.models).map((model) => ({
        ...model,
        free: isFreeModel(model.id),
      })),
      hasKey: hints.has(name),
      keyHint: hints.get(name) ?? null,
      warning: isCodingPlanUrl(row.baseUrl) ? 'coding_plan' : null,
    };
  }

  private async hints(): Promise<Map<string, string | null>> {
    return new Map((await this.secrets.list()).map((info) => [info.name, info.last4]));
  }

  async list(): Promise<ProviderView[]> {
    const hints = await this.hints();
    return this.rows().map((row) => this.toView(row, hints));
  }

  async get(id: string): Promise<ProviderView | undefined> {
    const row = this.db.select().from(providers).where(eq(providers.id, id)).get();
    return row ? this.toView(row, await this.hints()) : undefined;
  }

  private nameTaken(name: string, exceptId: string | null): boolean {
    const wanted = name.normalize('NFC').toLocaleLowerCase('de');
    return this.rows().some(
      (row) => row.id !== exceptId && row.name.normalize('NFC').toLocaleLowerCase('de') === wanted,
    );
  }

  async create(input: CreateProviderInput): Promise<ServiceResult<ProviderView>> {
    const preset = findPreset(input.preset) ?? findPreset('custom');
    const url = parseBaseUrl(input.baseUrl ?? preset?.baseUrl ?? '');
    if (!url.ok)
      return { ok: false, error: url.reason === 'insecure' ? 'insecure_url' : 'invalid_url' };
    if (this.nameTaken(input.name, null)) return { ok: false, error: 'name_taken' };

    const models = input.models ?? preset?.models ?? [];
    const last = this.db
      .select({ value: max(providers.position) })
      .from(providers)
      .get();
    let row: typeof providers.$inferSelect;
    try {
      row = this.db
        .insert(providers)
        .values({
          name: input.name,
          preset: preset?.id ?? 'custom',
          baseUrl: url.url,
          models: JSON.stringify(models),
          position: last?.value === null || last?.value === undefined ? 0 : last.value + 1,
        })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
      throw error;
    }

    if (input.apiKey !== undefined) {
      try {
        await this.secrets.set(secretName(row.id), input.apiKey);
      } catch (error) {
        this.db.delete(providers).where(eq(providers.id, row.id)).run();
        if (error instanceof SecretStoreError) return { ok: false, error: 'invalid_key' };
        throw error;
      }
    }

    this.applyPresetDefaults(
      row.id,
      preset?.defaultModel ?? null,
      preset?.fallbackModel ?? null,
      models,
    );
    const view = await this.get(row.id);
    if (!view) return { ok: false, error: 'not_found' };
    return { ok: true, value: view };
  }

  /** Setzt Standardmodell und Fallback aus der Voreinstellung, aber nur, wo der Nutzer noch nichts gewählt hat. */
  private applyPresetDefaults(
    providerId: string,
    defaultModel: string | null,
    fallbackModel: string | null,
    models: ModelEntry[],
  ): void {
    const has = (id: string | null): id is string => id !== null && models.some((m) => m.id === id);
    const current = this.modelSettings();
    if (current.default === null && has(defaultModel)) {
      this.write(KEY_DEFAULT, { providerId, model: defaultModel });
    }
    if (current.fallback.length === 0 && has(fallbackModel)) {
      this.write(KEY_FALLBACK, [{ providerId, model: fallbackModel }]);
    }
  }

  async update(id: string, input: UpdateProviderInput): Promise<ServiceResult<ProviderView>> {
    const existing = this.db.select().from(providers).where(eq(providers.id, id)).get();
    if (!existing) return { ok: false, error: 'not_found' };

    const changes: Partial<typeof providers.$inferInsert> = {};
    if (input.name !== undefined) {
      if (this.nameTaken(input.name, id)) return { ok: false, error: 'name_taken' };
      changes.name = input.name;
    }
    if (input.baseUrl !== undefined) {
      const url = parseBaseUrl(input.baseUrl);
      if (!url.ok) {
        return { ok: false, error: url.reason === 'insecure' ? 'insecure_url' : 'invalid_url' };
      }
      changes.baseUrl = url.url;
    }
    if (input.models !== undefined) changes.models = JSON.stringify(input.models);

    // Zuerst den Schlüssel prüfen und schreiben: schlägt das fehl, bleibt alles andere unverändert.
    if (input.apiKey !== undefined) {
      try {
        await this.secrets.set(secretName(id), input.apiKey);
      } catch (error) {
        if (error instanceof SecretStoreError) return { ok: false, error: 'invalid_key' };
        throw error;
      }
    }
    if (input.clearKey) await this.secrets.delete(secretName(id));

    try {
      if (Object.keys(changes).length > 0) {
        this.db.update(providers).set(changes).where(eq(providers.id, id)).run();
      }
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
      throw error;
    }
    this.prune();
    const view = await this.get(id);
    return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
  }

  async remove(id: string): Promise<ServiceResult<null>> {
    const result = this.db.delete(providers).where(eq(providers.id, id)).run();
    if (result.changes === 0) return { ok: false, error: 'not_found' };
    await this.secrets.delete(secretName(id));
    this.prune();
    return { ok: true, value: null };
  }

  private async target(
    id: string,
  ): Promise<{ target: Target; preset: string; models: ModelEntry[] } | null> {
    const row = this.db.select().from(providers).where(eq(providers.id, id)).get();
    if (!row) return null;
    return {
      target: { baseUrl: row.baseUrl, apiKey: (await this.secrets.get(secretName(id))) ?? null },
      preset: row.preset,
      models: parseStoredModels(row.models),
    };
  }

  /** „Verbindung testen“. Ein Fehlschlag ist ein normales Ergebnis, kein Serverfehler. */
  async test(id: string, signal?: AbortSignal): Promise<ServiceResult<TestResult>> {
    const found = await this.target(id);
    if (!found) return { ok: false, error: 'not_found' };
    const result = await this.client.test(found.target, {
      preset: found.preset,
      probeModel: found.models[0]?.id ?? null,
      signal,
    });
    return { ok: true, value: result };
  }

  /** Modelle, die der Anbieter anbietet. Es wird nichts gespeichert. */
  async discover(id: string, signal?: AbortSignal): Promise<ServiceResult<AvailableModel[]>> {
    const found = await this.target(id);
    if (!found) return { ok: false, error: 'not_found' };
    try {
      const models = await this.client.listModels(found.target, signal);
      const sorted = models.sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_LISTED);
      return { ok: true, value: sorted };
    } catch (error) {
      if (error instanceof ProviderError) {
        return { ok: false, error: 'provider_failed', code: error.code };
      }
      throw error;
    }
  }

  // --- Modellwahl ------------------------------------------------------------------------------

  private read(key: string): unknown {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.db
      .insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date() } })
      .run();
  }

  private valid(selection: Selection): boolean {
    const row = this.db
      .select({ models: providers.models })
      .from(providers)
      .where(eq(providers.id, selection.providerId))
      .get();
    return row !== undefined && parseStoredModels(row.models).some((m) => m.id === selection.model);
  }

  /** Standardmodell und Fallback-Kette. Einträge, die es nicht mehr gibt, fehlen in der Antwort. */
  modelSettings(): ModelSettings {
    const stored = SelectionSchema.safeParse(this.read(KEY_DEFAULT));
    const fallback = FallbackSchema.safeParse(this.read(KEY_FALLBACK));
    return {
      default: stored.success && this.valid(stored.data) ? stored.data : null,
      fallback: (fallback.success ? fallback.data : []).filter((entry) => this.valid(entry)),
    };
  }

  setModelSettings(input: ModelSettings): ServiceResult<ModelSettings> {
    const all = [...(input.default ? [input.default] : []), ...input.fallback];
    for (const selection of all) {
      const exists = this.db
        .select({ id: providers.id })
        .from(providers)
        .where(eq(providers.id, selection.providerId))
        .get();
      if (!exists) return { ok: false, error: 'not_found' };
      if (!this.valid(selection)) return { ok: false, error: 'unknown_model' };
    }
    const fallback: Selection[] = [];
    for (const entry of input.fallback) {
      if (!fallback.some((other) => sameSelection(other, entry))) fallback.push(entry);
    }
    if (input.default) this.write(KEY_DEFAULT, input.default);
    else this.db.delete(settings).where(eq(settings.key, KEY_DEFAULT)).run();
    this.write(KEY_FALLBACK, fallback.slice(0, MAX_FALLBACKS));
    return { ok: true, value: this.modelSettings() };
  }

  /** Entfernt Auswahl-Einträge, deren Anbieter oder Modell gelöscht wurde. */
  private prune(): void {
    const current = this.modelSettings();
    if (current.default) this.write(KEY_DEFAULT, current.default);
    else this.db.delete(settings).where(eq(settings.key, KEY_DEFAULT)).run();
    this.write(KEY_FALLBACK, current.fallback);
  }

  /**
   * Reihenfolge der Versuche für einen Chat: die gewählte Kombination (oder das Standardmodell),
   * danach die Fallback-Kette, ohne Doppelte.
   */
  chain(primary: Selection | null): Selection[] {
    const settingsNow = this.modelSettings();
    const first = primary && this.valid(primary) ? primary : settingsNow.default;
    const chain: Selection[] = [];
    for (const entry of [...(first ? [first] : []), ...settingsNow.fallback]) {
      if (!chain.some((other) => sameSelection(other, entry))) chain.push(entry);
    }
    return chain;
  }

  /** Alles, was eine Anfrage braucht. Nur für Server-Code: enthält den Schlüssel. */
  async resolve(
    selection: Selection,
  ): Promise<{ target: Target; model: ModelEntry; preset: string } | null> {
    const found = await this.target(selection.providerId);
    const model = found?.models.find((entry) => entry.id === selection.model);
    return found && model ? { target: found.target, model, preset: found.preset } : null;
  }
}
