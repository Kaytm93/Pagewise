import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { type EngineProfileRow, engineProfiles } from '../db/schema';
import { type SecretStore, SecretStoreError } from '../storage/secret-store';

/**
 * Zugänge für den Agent-CLI-Adapter. Drei Arten (Mega-Prompt Abschnitt 7.2):
 *
 * - `claude-subscription`: das eigene Claude-Abo. Die Person meldet sich selbst in der CLI an, Pagewise
 *   liest, speichert und vermittelt keine Tokens. Das Profil hat deshalb nie ein Secret.
 * - `glm-coding-plan`: der GLM Coding Plan von Z.ai über die unveränderte `claude`-Binary mit
 *   `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` (D-011). Nur für den Kontoinhaber, nur lokal.
 * - `anthropic-api`: ein eigener Anthropic-API-Schlüssel.
 *
 * Schlüssel stehen nie in der Datenbank, nur im Secret-Speicher unter `engine.<id>.token`.
 */
export const ENGINE_KINDS = ['claude-subscription', 'glm-coding-plan', 'anthropic-api'] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** Adresse der Anthropic-kompatiblen Schnittstelle von Z.ai für Claude Code (Quelle: docs.z.ai/devpack/tool/claude). */
export const GLM_BASE_URL = 'https://api.z.ai/api/anthropic';
/** Vorgabe für alle drei Modellstufen beim GLM-Profil (D-011). */
export const GLM_DEFAULT_MODEL = 'glm-5.3-flash';

export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
export const DEFAULT_TIMEOUT_MINUTES = 20;
export const MAX_TIMEOUT_MINUTES = 120;
export const MAX_PROFILES = 20;

/** Ob die Art ein Secret braucht, erlaubt oder ausschließt. */
const TOKEN_RULE: Record<EngineKind, 'none' | 'required'> = {
  'claude-subscription': 'none',
  'glm-coding-plan': 'required',
  'anthropic-api': 'required',
};

export interface EngineProfileView {
  id: string;
  kind: EngineKind;
  name: string;
  /** Eigene Modellwahl, `null`: Voreinstellung der Art (bei GLM `glm-5.3-flash`). */
  model: string | null;
  timeoutMinutes: number;
  hasToken: boolean;
  /** Letzte vier Zeichen, nur bei langen Schlüsseln. Der Schlüssel selbst verlässt den Server nie. */
  tokenHint: string | null;
  position: number;
  createdAt: number;
}

export interface ProfileInput {
  kind: EngineKind;
  name: string;
  model?: string | null;
  timeoutMinutes?: number;
  token?: string;
}

export interface ProfilePatch {
  name?: string;
  model?: string | null;
  timeoutMinutes?: number;
  token?: string;
  clearToken?: boolean;
}

export type ProfileFailure = {
  ok: false;
  error:
    | 'not_found'
    | 'name_taken'
    | 'token_required'
    | 'token_not_allowed'
    | 'too_many'
    | 'secret_failed';
};
export type ProfileResult<T> = { ok: true; value: T } | ProfileFailure;

export const secretNameFor = (id: string): string => `engine.${id}.token`;

function key(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('de');
}

export class EngineProfileService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore,
  ) {}

  private rows(): EngineProfileRow[] {
    return this.db
      .select()
      .from(engineProfiles)
      .orderBy(asc(engineProfiles.position), asc(engineProfiles.createdAt))
      .all();
  }

  private toView(row: EngineProfileRow, hints: Map<string, string | null>): EngineProfileView {
    const name = secretNameFor(row.id);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      model: row.model,
      timeoutMinutes: row.timeoutMinutes,
      hasToken: hints.has(name),
      tokenHint: hints.get(name) ?? null,
      position: row.position,
      createdAt: row.createdAt.getTime(),
    };
  }

  private async hints(): Promise<Map<string, string | null>> {
    return new Map((await this.secrets.list()).map((info) => [info.name, info.last4]));
  }

  async list(): Promise<EngineProfileView[]> {
    const hints = await this.hints();
    return this.rows().map((row) => this.toView(row, hints));
  }

  async get(id: string): Promise<EngineProfileView | undefined> {
    const row = this.db.select().from(engineProfiles).where(eq(engineProfiles.id, id)).get();
    return row ? this.toView(row, await this.hints()) : undefined;
  }

  /** Nur für Server-Code (Start des Agenten): Zeile und Schlüssel. Gibt es keinen Schlüssel, ist `token` `null`. */
  async resolve(id: string): Promise<{ profile: EngineProfileRow; token: string | null } | null> {
    const profile = this.db.select().from(engineProfiles).where(eq(engineProfiles.id, id)).get();
    if (!profile) return null;
    let token: string | null = null;
    if (TOKEN_RULE[profile.kind] === 'required') {
      token = (await this.secrets.get(secretNameFor(id))) ?? null;
    }
    return { profile, token };
  }

  exists(id: string): boolean {
    return (
      this.db
        .select({ id: engineProfiles.id })
        .from(engineProfiles)
        .where(eq(engineProfiles.id, id))
        .get() !== undefined
    );
  }

  async create(input: ProfileInput): Promise<ProfileResult<EngineProfileView>> {
    const rule = TOKEN_RULE[input.kind];
    const token = input.token?.trim();
    if (rule === 'none' && token) return { ok: false, error: 'token_not_allowed' };
    if (rule === 'required' && !token) return { ok: false, error: 'token_required' };
    const existing = this.rows();
    if (existing.length >= MAX_PROFILES) return { ok: false, error: 'too_many' };
    if (existing.some((row) => key(row.name) === key(input.name))) {
      return { ok: false, error: 'name_taken' };
    }

    const last = this.db
      .select({ value: max(engineProfiles.position) })
      .from(engineProfiles)
      .get();
    let row: EngineProfileRow;
    try {
      row = this.db
        .insert(engineProfiles)
        .values({
          kind: input.kind,
          name: input.name,
          model: input.model ?? null,
          timeoutMinutes: input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
          position: (last?.value ?? -1) + 1,
        })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
      throw error;
    }
    if (rule === 'required' && token) {
      try {
        await this.secrets.set(secretNameFor(row.id), token);
      } catch (error) {
        this.db.delete(engineProfiles).where(eq(engineProfiles.id, row.id)).run();
        if (error instanceof SecretStoreError) return { ok: false, error: 'secret_failed' };
        throw error;
      }
    }
    const view = await this.get(row.id);
    return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
  }

  async update(id: string, patch: ProfilePatch): Promise<ProfileResult<EngineProfileView>> {
    const row = this.db.select().from(engineProfiles).where(eq(engineProfiles.id, id)).get();
    if (!row) return { ok: false, error: 'not_found' };
    const rule = TOKEN_RULE[row.kind];
    const token = patch.token?.trim();
    if (rule === 'none' && (token || patch.clearToken)) {
      return { ok: false, error: 'token_not_allowed' };
    }
    if (patch.name !== undefined) {
      const name = patch.name;
      if (this.rows().some((other) => other.id !== id && key(other.name) === key(name))) {
        return { ok: false, error: 'name_taken' };
      }
    }
    if (rule === 'required' && patch.clearToken && !token) {
      // Ein Zugang ohne Schlüssel ist unbrauchbar: dann gleich den ganzen Zugang entfernen lassen.
      return { ok: false, error: 'token_required' };
    }

    const changes: Partial<typeof engineProfiles.$inferInsert> = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.model !== undefined) changes.model = patch.model;
    if (patch.timeoutMinutes !== undefined) changes.timeoutMinutes = patch.timeoutMinutes;
    try {
      if (Object.keys(changes).length > 0) {
        this.db.update(engineProfiles).set(changes).where(eq(engineProfiles.id, id)).run();
      }
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, error: 'name_taken' };
      throw error;
    }
    if (token) {
      try {
        await this.secrets.set(secretNameFor(id), token);
      } catch (error) {
        if (error instanceof SecretStoreError) return { ok: false, error: 'secret_failed' };
        throw error;
      }
    }
    const view = await this.get(id);
    return view ? { ok: true, value: view } : { ok: false, error: 'not_found' };
  }

  /** Löscht den Zugang und seinen Schlüssel. Fächer und Chats mit diesem Zugang fallen auf ihr Modell zurück. */
  async remove(id: string): Promise<ProfileResult<null>> {
    const result = this.db.delete(engineProfiles).where(eq(engineProfiles.id, id)).run();
    if (result.changes === 0) return { ok: false, error: 'not_found' };
    await this.secrets.delete(secretNameFor(id));
    return { ok: true, value: null };
  }
}
