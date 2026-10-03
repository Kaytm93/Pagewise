/** Zusätze, die manche Fehlerantworten des Servers mitbringen (nie die Eingabe selbst). */
export interface ApiErrorDetails {
  field?: string | null;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Fehler einer API-Anfrage. Maßgeblich ist der Code des Servers (z. B. `invalid_passcode`),
 * nicht der HTTP-Status. `network` bedeutet: der Server war nicht erreichbar.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: ApiErrorDetails = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  fetch?: typeof fetch;
  /** Wird aufgerufen, wenn der Server die Sitzung nicht (mehr) kennt oder das CSRF-Token nicht passt. */
  onSessionLost?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Dünner Client für `/api`. Er hält das CSRF-Token der Sitzung nur im Speicher
 * (nie in localStorage) und schickt es bei jeder Anfrage mit.
 */
export class ApiClient {
  private csrfToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  onSessionLost: (() => void) | undefined;

  constructor(options: ApiClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.onSessionLost = options.onSessionLost;
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    let response: Response;
    try {
      response = await this.fetchImpl(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('network', 0);
    }

    if (response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const record = isRecord(payload) ? payload : {};
      const code = typeof record.error === 'string' ? record.error : 'unknown';
      const details: ApiErrorDetails = {};
      if ('field' in record) details.field = typeof record.field === 'string' ? record.field : null;
      if (typeof record.reason === 'string') details.reason = record.reason;
      if (typeof record.retryAfterSeconds === 'number') {
        details.retryAfterSeconds = record.retryAfterSeconds;
      }
      if (code === 'unauthorized' || code === 'csrf') this.onSessionLost?.();
      throw new ApiError(code, response.status, details);
    }
    return payload as T;
  }
}
