import { createHash } from 'node:crypto';
import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Fehler der Einrichtung mit kurzem Code. Der Text ist nie für Anzeige oder Logs gedacht, nur der Code. */
export class SetupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SetupError';
  }
}

export interface DownloadOptions {
  url: string;
  /** Erwartete SHA-256-Prüfsumme (hex). Passt sie nicht, wird die Datei gelöscht. */
  sha256: string;
  /** Größte erlaubte Größe in Bytes. Mehr bricht den Download ab. */
  maxBytes: number;
  dest: string;
  /** Hosts, zu denen geladen und weitergeleitet werden darf (exakter Vergleich). */
  allowedHosts: readonly string[];
  signal?: AbortSignal;
  onProgress?: (bytes: number) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 5;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function checkUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SetupError('bad_url');
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new SetupError('bad_url');
  }
  if (!allowedHosts.includes(url.hostname)) throw new SetupError('host_not_allowed');
  return url;
}

/**
 * Lädt eine Datei, prüft Host, Größe und SHA-256 und legt sie erst bei Erfolg unter `dest` ab. Weiterleitungen
 * folgt die Funktion von Hand und nur zu erlaubten Hosts. Die Quelle ist eine feste Adresse aus `pins.ts`, nie
 * etwas von einer Seite oder aus einer Modell-Antwort.
 */
export async function downloadVerified(options: DownloadOptions): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const part = `${options.dest}.part`;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000),
  ]);
  try {
    let url = checkUrl(options.url, options.allowedHosts);
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await doFetch(url, { redirect: 'manual', signal }).catch(() => {
        throw new SetupError(signal.aborted ? 'cancelled' : 'download_failed');
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) throw new SetupError('download_failed');
        await response.body?.cancel();
        url = checkUrl(new URL(location, url).toString(), options.allowedHosts);
        continue;
      }
      break;
    }
    if (!response?.ok || !response.body) throw new SetupError('download_failed');
    const announced = Number(response.headers.get('content-length') ?? 0);
    if (announced > options.maxBytes) throw new SetupError('too_large');

    const hash = createHash('sha256');
    let bytes = 0;
    const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    source.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
      options.onProgress?.(bytes);
      if (bytes > options.maxBytes) source.destroy(new SetupError('too_large'));
    });
    await pipeline(source, createWriteStream(part, { mode: 0o600 })).catch((error: unknown) => {
      if (error instanceof SetupError) throw error;
      throw new SetupError(signal.aborted ? 'cancelled' : 'download_failed');
    });
    if (hash.digest('hex') !== options.sha256.toLowerCase())
      throw new SetupError('checksum_mismatch');
    renameSync(part, options.dest);
  } finally {
    rmSync(part, { force: true });
  }
}
