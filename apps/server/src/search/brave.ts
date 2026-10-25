import { z } from 'zod';
import type { WebResult } from './types';

/**
 * Brave Search API (Web Search, Stand 25.10.2026): `q` und `count` (höchstens 20), Schlüssel im Kopf
 * `X-Subscription-Token`, Treffer unter `web.results` mit `title`, `url` und `description`.
 * Quelle: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 *
 * Die Adresse ist fest. Sie kommt nie aus Eingaben oder Einstellungen, damit der Schlüssel nur dorthin geht.
 */
export const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

const TIMEOUT_MS = 8_000;
/** Größte Antwort, die gelesen wird. Ein Treffer braucht selten mehr als wenige Kilobyte. */
const MAX_RESPONSE_CHARACTERS = 256_000;
const MAX_TITLE_CHARACTERS = 200;
const MAX_DESCRIPTION_CHARACTERS = 300;
const MAX_URL_CHARACTERS = 500;

export type BraveErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'invalid_response';

/** Fehler mit kurzem Code. Die Meldung enthält nie die Antwort des Dienstes und nie den Schlüssel. */
export class BraveSearchError extends Error {
  constructor(readonly code: BraveErrorCode) {
    super(code);
    this.name = 'BraveSearchError';
  }
}

const ResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export interface BraveSearchOptions {
  apiKey: string;
  query: string;
  count: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Entfernt Markup und Steuerzeichen aus Treffertexten und kürzt sie. Der Text bleibt Daten; hier wird nichts
 * ausgeführt oder interpretiert.
 */
export function cleanText(value: string, max: number): string {
  const printable = Array.from(value.replace(/<[^>]*>/g, ' '), (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');
  const plain = printable.replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function toResult(item: { title: string; url: string; description?: string }): WebResult | null {
  const url = item.url.trim();
  if (url.length === 0 || url.length > MAX_URL_CHARACTERS) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const title = cleanText(item.title, MAX_TITLE_CHARACTERS);
  if (title === '') return null;
  return {
    title,
    url: parsed.href,
    description: cleanText(item.description ?? '', MAX_DESCRIPTION_CHARACTERS),
  };
}

function failureCode(error: unknown, caller: AbortSignal | undefined): BraveErrorCode {
  if (caller?.aborted) return 'aborted';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'unavailable';
}

/** Eine Suche bei Brave. Gibt höchstens `count` geprüfte Treffer zurück, Fehler nur als Code. */
export async function braveSearch(options: BraveSearchOptions): Promise<WebResult[]> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set('q', options.query);
  url.searchParams.set('count', String(options.count));
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  let text: string;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': options.apiKey },
      redirect: 'error',
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new BraveSearchError('auth_failed');
    }
    if (response.status === 429) throw new BraveSearchError('rate_limited');
    if (!response.ok) throw new BraveSearchError('unavailable');
    text = await response.text();
  } catch (error) {
    if (error instanceof BraveSearchError) throw error;
    throw new BraveSearchError(failureCode(error, options.signal));
  }
  if (text.length > MAX_RESPONSE_CHARACTERS) throw new BraveSearchError('invalid_response');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BraveSearchError('invalid_response');
  }
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) throw new BraveSearchError('invalid_response');
  const results = parsed.data.web?.results ?? [];
  return results
    .map(toResult)
    .filter((result): result is WebResult => result !== null)
    .slice(0, options.count);
}
