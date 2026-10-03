import { type SseMessage, SseParser } from './sse';

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

/** Ein vom Aufrufer gewollter Abbruch (`AbortController`), kein Fehler. */
export function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
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

  private async send(
    method: string,
    path: string,
    accept: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    try {
      return await this.fetchImpl(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ApiError('network', 0);
    }
  }

  /** Macht aus einer Fehlerantwort des Servers einen `ApiError` und meldet verlorene Sitzungen. */
  private async failure(response: Response): Promise<ApiError> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const record = isRecord(payload) ? payload : {};
    const code = typeof record.error === 'string' ? record.error : 'unknown';
    const details: ApiErrorDetails = {};
    if ('field' in record) details.field = typeof record.field === 'string' ? record.field : null;
    if (typeof record.reason === 'string') details.reason = record.reason;
    if (typeof record.retryAfterSeconds === 'number') {
      details.retryAfterSeconds = record.retryAfterSeconds;
    }
    if (code === 'unauthorized' || code === 'csrf') this.onSessionLost?.();
    return new ApiError(code, response.status, details);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, 'application/json', body);
    if (response.status === 204) return undefined as T;
    if (!response.ok) throw await this.failure(response);

    try {
      return (await response.json()) as T;
    } catch {
      return undefined as T;
    }
  }

  /**
   * Öffnet einen Server-Sent-Events-Strom und liefert jede Nachricht an `onMessage`. Das Ergebnis ist
   * `'empty'`, wenn der Server nichts zu senden hat (204), sonst `'streamed'` nach dem Ende des Stroms.
   * Bricht die Verbindung mittendrin ab, kommt `ApiError('network')`; `signal` beendet den Strom
   * mit einem `AbortError`.
   */
  async stream(
    method: string,
    path: string,
    body: unknown,
    onMessage: (message: SseMessage) => void,
    signal?: AbortSignal,
  ): Promise<'streamed' | 'empty'> {
    const response = await this.send(method, path, 'text/event-stream', body, signal);
    if (response.status === 204) return 'empty';
    if (!response.ok) throw await this.failure(response);
    if (!response.body) throw new ApiError('network', 0);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          onMessage(message);
        }
      }
      for (const message of parser.push(decoder.decode())) onMessage(message);
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ApiError('network', 0);
    } finally {
      reader.cancel().catch(() => {});
    }
    return 'streamed';
  }
}
