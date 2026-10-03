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
