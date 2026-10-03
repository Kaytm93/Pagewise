import { ApiError } from '../../api/client';
import type { TestOutcome } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { commonErrorMessage } from '../auth-errors';

export interface ProviderErrors {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string;
  form?: string;
}

/** Ordnet Fehlercodes des Servers dem Feld zu, in dem sie angezeigt werden. */
export function mapProviderError(error: unknown): ProviderErrors {
  const e = m.providers.errors;
  if (error instanceof ApiError) {
    if (error.code === 'name_taken') return { name: e.nameTaken };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      const { field, reason } = error.details;
      if (field === 'name') return { name: m.errors.invalidName };
      if (field === 'baseUrl') {
        return { baseUrl: reason === 'insecure' ? e.baseUrlInsecure : e.baseUrlInvalid };
      }
      if (field === 'apiKey') return { apiKey: e.keyInvalid };
      if (field === 'models') return { models: e.modelInvalid };
    }
  }
  return { form: commonErrorMessage(error) };
}

/** Meldung zum Ergebnis von „Verbindung testen“. */
export function testMessage(outcome: TestOutcome): string {
  const t = m.providers.test;
  if (outcome.ok) {
    return outcome.modelCount === null
      ? format(t.ok, { ms: outcome.latencyMs })
      : format(t.okModels, { ms: outcome.latencyMs, count: outcome.modelCount });
  }
  const failed = t.failed as Record<string, string>;
  return failed[outcome.code] ?? failed.unknown ?? t.failed.unknown;
}

/** Spiegelt die Regel des Servers: Kostenlose Modelle erkennt man an der Kennung. */
export function isFreeModel(id: string): boolean {
  return id === 'openrouter/free' || id.endsWith(':free');
}

export function isCodingPlanUrl(baseUrl: string): boolean {
  return /\/api\/coding(\/|$)/i.test(baseUrl);
}

/** Die allgemeine Pay-per-Token-API von Z.ai: Das Kontingent eines Coding Plans gilt dort nicht. */
export function isZaiGeneralUrl(baseUrl: string): boolean {
  return /^https:\/\/api\.z\.ai\/api\/paas(\/|$)/i.test(baseUrl.trim());
}

/** Zeigt Adresse ohne Protokoll und Pfad: „openrouter.ai“. Ungültiges kommt unverändert zurück. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function selectionKey(providerId: string, model: string): string {
  return `${providerId}|${model}`;
}

export function parseSelectionKey(key: string): { providerId: string; model: string } | null {
  const index = key.indexOf('|');
  if (index <= 0) return null;
  return { providerId: key.slice(0, index), model: key.slice(index + 1) };
}
