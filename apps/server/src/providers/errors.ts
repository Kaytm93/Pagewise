/**
 * Fehlercodes für Anfragen an Modell-Anbieter. Es gibt bewusst nur Codes: Texte der Anbieter
 * können Teile des Schlüssels oder der Eingabe wiederholen und werden nie weitergereicht.
 */
export type ProviderErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'aborted'
  | 'auth_failed'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'no_package'
  | 'quota_exhausted'
  | 'plan_expired'
  | 'model_not_allowed'
  | 'content_blocked'
  | 'model_not_found'
  | 'bad_request'
  | 'upstream_error'
  | 'invalid_response'
  | 'redirected'
  | 'models_unavailable'
  | 'no_key';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    /** HTTP-Status des Anbieters, falls es einen gab. */
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = 'ProviderError';
  }

  /** Fehler, bei denen ein anderes Modell oder ein späterer Versuch helfen kann (für die Fallback-Kette). */
  get retryable(): boolean {
    return (
      this.code === 'rate_limited' ||
      this.code === 'upstream_error' ||
      this.code === 'unreachable' ||
      this.code === 'timeout' ||
      this.code === 'insufficient_credits' ||
      this.code === 'no_package' ||
      this.code === 'quota_exhausted' ||
      this.code === 'plan_expired' ||
      this.code === 'model_not_allowed' ||
      this.code === 'model_not_found'
    );
  }
}

export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 402) return 'insufficient_credits';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 300 && status < 400) return 'redirected';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'upstream_error';
}

/**
 * Fehlernummern im Rumpf der Antwort, die mehr sagen als der HTTP-Status. Z.ai antwortet bei fast
 * allen Fehlern mit 429 und trennt sie über `error.code` (Quelle: https://docs.z.ai/api-reference/api-code,
 * Stand 3. Oktober 2026). Ohne diese Tabelle würde „kein Guthaben oder Paket“ (1113) als „zu viele
 * Anfragen“ erscheinen. Nur Nummern aus dieser Liste zählen, alles andere im Rumpf wird ignoriert.
 */
const BUSINESS_CODES: Readonly<Record<string, ProviderErrorCode>> = {
  '1113': 'no_package',
  '1211': 'model_not_found',
  '1301': 'content_blocked',
  '1308': 'quota_exhausted',
  '1309': 'plan_expired',
  '1310': 'quota_exhausted',
  '1311': 'model_not_allowed',
};

/**
 * Liest aus dem Fehlerrumpf eines Anbieters ausschließlich eine bekannte Fehlernummer. Texte
 * (`message`) werden nie gelesen oder weitergegeben, sie könnten Schlüssel oder Eingabe wiederholen.
 */
export function codeFromBody(body: unknown): ProviderErrorCode | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const raw = (error as Record<string, unknown>).code;
  const number = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return Object.hasOwn(BUSINESS_CODES, number) ? (BUSINESS_CODES[number] ?? null) : null;
}
