import { z } from 'zod';
import { cleanText } from './text';
import type { WebResult } from './types';

/**
 * Tavily Search API (Stand 26. Oktober 2026): `POST` mit JSON-Körper, Schlüssel im Kopf
 * `Authorization: Bearer`. Die Basissuche (`search_depth: "basic"`) kostet 1 Credit. Treffer unter `results`
 * mit `title`, `url` und `content` (ein Auszug).
 * Quelle: https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * Die Adresse ist fest. Sie kommt nie aus Eingaben oder Einstellungen, damit der Schlüssel nur dorthin geht.
 */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

const TIMEOUT_MS = 8_000;
/** Größte Antwort, die gelesen wird. Ein Treffer braucht selten mehr als wenige Kilobyte. */
const MAX_RESPONSE_CHARACTERS = 256_000;
const MAX_TITLE_CHARACTERS = 200;
const MAX_DESCRIPTION_CHARACTERS = 300;
const MAX_URL_CHARACTERS = 500;

export type TavilyErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'invalid_request'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'invalid_response';

/** Fehler mit kurzem Code. Die Meldung enthält nie die Antwort des Dienstes und nie den Schlüssel. */
export class TavilyError extends Error {
  constructor(readonly code: TavilyErrorCode) {
    super(code);
    this.name = 'TavilyError';
  }
}

const ResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
});

export interface TavilySearchOptions {
  apiKey: string;
  query: string;
  count: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function toResult(item: { title: string; url: string; content?: string }): WebResult | null {
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
    description: cleanText(item.content ?? '', MAX_DESCRIPTION_CHARACTERS),
  };
}

function failureCode(error: unknown, caller: AbortSignal | undefined): TavilyErrorCode {
  if (caller?.aborted) return 'aborted';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'unavailable';
}

/** Die Statuscodes, die Tavily für Schlüssel, Kontingent und Anfragen verwendet. Alles andere ist ein Ausfall. */
function statusCode(status: number): TavilyErrorCode | null {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  if (status === 432 || status === 433) return 'quota_exceeded';
  if (status === 400 || status === 422) return 'invalid_request';
  return null;
}

/** Eine Suche bei Tavily. Gibt höchstens `count` geprüfte Treffer zurück, Fehler nur als Code. */
export async function tavilySearch(options: TavilySearchOptions): Promise<WebResult[]> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let text: string;
  try {
    const response = await (options.fetch ?? fetch)(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        query: options.query,
        max_results: options.count,
        search_depth: 'basic',
      }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new TavilyError(statusCode(response.status) ?? 'unavailable');
    }
    text = await response.text();
  } catch (error) {
    if (error instanceof TavilyError) throw error;
    throw new TavilyError(failureCode(error, options.signal));
  }
  if (text.length > MAX_RESPONSE_CHARACTERS) throw new TavilyError('invalid_response');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TavilyError('invalid_response');
  }
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) throw new TavilyError('invalid_response');
  return parsed.data.results
    .map(toResult)
    .filter((result): result is WebResult => result !== null)
    .slice(0, options.count);
}
