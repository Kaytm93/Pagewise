export type BaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'invalid' | 'insecure' };

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Prüft die Basis-URL eines Anbieters. Zugangsdaten gehen nur über HTTPS, Klartext-HTTP ist nur für
 * den eigenen Rechner erlaubt (z. B. ein lokaler Modellserver). Kennung, Passwort, Query und
 * Fragment haben in einer Basis-URL nichts verloren: Schlüssel gehören in den Secret-Speicher.
 */
export function parseBaseUrl(raw: string): BaseUrlResult {
  const text = raw.trim();
  if (text.length === 0 || text.length > 200) return { ok: false, reason: 'invalid' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'invalid' };
  if (url.username || url.password || url.search || url.hash)
    return { ok: false, reason: 'invalid' };
  if (url.protocol === 'http:' && !LOOPBACK.test(url.hostname)) {
    return { ok: false, reason: 'insecure' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.origin}${path}` };
}

/** Der Coding Plan von Z.ai ist nur für unterstützte Werkzeuge gedacht (siehe docs/providers.md). */
export function isCodingPlanUrl(baseUrl: string): boolean {
  return /\/api\/coding(\/|$)/i.test(baseUrl);
}
