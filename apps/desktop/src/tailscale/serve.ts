/**
 * Auswertung von `tailscale serve status --json` (die Konfiguration `ipn.ServeConfig`, Quelle `ipn/serve.go`,
 * Hauptzweig, gelesen am 4. Oktober 2026). Tolerant gelesen. Gefragt wird: Zeigt unsere Freigabe noch auf den lokalen
 * Server? Gibt es fremde Freigaben auf dem Port? Ist Funnel (öffentlich im Internet) an?
 */
export interface ServeEntry {
  /** HTTPS-Port der Freigabe (443, 8443 …). */
  port: number;
  /** Ziele der Pfade, z. B. `http://127.0.0.1:3000`. */
  targets: string[];
  /** Mehr als nur ein Weiterleiter auf einen lokalen Dienst (Dateien, Text, Umleitung). */
  nonProxy: boolean;
  funnel: boolean;
}

export interface ParsedServe {
  entries: ServeEntry[];
  /** Reine TCP-Weiterleitungen (Port → Ziel). */
  tcp: Array<{ port: number; target: string }>;
  /** Irgendeine Freigabe ist über Funnel öffentlich. */
  funnel: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function portOf(hostPort: string): number | null {
  const match = /:(\d{1,5})$/.exec(hostPort);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

export function parseServe(raw: unknown): ParsedServe {
  const root = record(raw);
  const result: ParsedServe = { entries: [], tcp: [], funnel: false };
  if (!root) return result;

  const allowFunnel = record(root.AllowFunnel) ?? {};
  const web = record(root.Web) ?? {};
  for (const [hostPort, config] of Object.entries(web)) {
    const port = portOf(hostPort);
    const handlers = record(record(config)?.Handlers) ?? {};
    if (port === null) continue;
    const targets: string[] = [];
    let nonProxy = false;
    for (const handler of Object.values(handlers)) {
      const h = record(handler) ?? {};
      if (typeof h.Proxy === 'string' && h.Proxy !== '') targets.push(h.Proxy);
      else nonProxy = true;
    }
    if (Object.keys(handlers).length === 0) nonProxy = true;
    const funnel = allowFunnel[hostPort] === true;
    result.entries.push({ port, targets, nonProxy, funnel });
  }
  for (const [hostPort, enabled] of Object.entries(allowFunnel)) {
    if (enabled === true) result.funnel = true;
    void hostPort;
  }

  const tcp = record(root.TCP) ?? {};
  for (const [portText, handler] of Object.entries(tcp)) {
    const port = Number(portText);
    const h = record(handler) ?? {};
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    // `HTTPS` und `HTTP` gehören zu `Web`; nur echte TCP-Weiterleitungen zählen hier.
    if (typeof h.TCPForward === 'string' && h.TCPForward !== '') {
      result.tcp.push({ port, target: h.TCPForward });
    }
  }
  return result;
}

/** Normalisiert die Schreibweisen eines Ziels auf `127.0.0.1:<Port>` (oder `null` bei anderem Ziel). */
export function localPortOfTarget(target: string): number | null {
  const trimmed = target.trim();
  if (/^\d{1,5}$/.test(trimmed)) return Number(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  const port = Number(url.port);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export interface ServeAnalysis {
  /** Unsere Freigabe: HTTPS-Port, der nur auf den lokalen Server zeigt. */
  ours: { port: number } | null;
  /** Freigaben auf anderen Zielen (Port und Ziele), die Pagewise nie überschreibt. */
  foreign: Array<{ port: number; targets: string[] }>;
  funnel: boolean;
}

export function analyzeServe(serve: ParsedServe, localPort: number): ServeAnalysis {
  let ours: ServeAnalysis['ours'] = null;
  const foreign: ServeAnalysis['foreign'] = [];
  for (const entry of serve.entries) {
    const isOurs =
      !entry.nonProxy &&
      entry.targets.length === 1 &&
      localPortOfTarget(entry.targets[0] ?? '') === localPort;
    if (isOurs) ours ??= { port: entry.port };
    else foreign.push({ port: entry.port, targets: entry.targets });
  }
  for (const entry of serve.tcp) foreign.push({ port: entry.port, targets: [entry.target] });
  return { ours, foreign, funnel: serve.funnel };
}

/** Der erste Port, auf dem nichts Fremdes liegt: 443, sonst 8443, sonst 10000. `null`, wenn alle belegt sind. */
export function pickHttpsPort(analysis: ServeAnalysis): number | null {
  const taken = new Set(analysis.foreign.map((f) => f.port));
  for (const port of [443, 8443, 10000]) if (!taken.has(port)) return port;
  return null;
}
