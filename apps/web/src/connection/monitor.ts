/**
 * Überwacht, ob der Server (der Mac) erreichbar ist. `navigator.onLine` sagt nur, ob das Gerät irgendein Netz hat,
 * nicht, ob der Mac antwortet: Schläft er bei verbundenem Tailscale, hängt die Verbindung. Deshalb gilt allein eine
 * Probe auf `GET /api/health` mit Zeitlimit.
 *
 * Geprüft wird beim Zurückkehren zur Seite (`visibilitychange`, `pageshow`), bei `online` und `offline` sowie alle
 * 30 Sekunden, solange die Seite sichtbar ist. Nach einem Ausfall wiederholt sich die Probe mit wachsendem Abstand
 * (2, 5, 10, 30 Sekunden, danach alle 30). Kommt der Server zurück, wird ein Ereignis gemeldet, auf das Sitzung
 * und Arbeitsbereich neu laden.
 */

export const PROBE_TIMEOUT_MS = 4_000;
export const POLL_INTERVAL_MS = 30_000;
export const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000] as const;

/** Fragt `/api/health` und meldet nur dann `true`, wenn der Server wirklich als Pagewise antwortet. */
export async function probeHealth(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    // Ein WLAN-Portal oder ein Proxy kann 200 mit einer Seite liefern: nur die Antwort des Servers zählt.
    const body: unknown = await response.json();
    return (
      typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok'
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type ConnectionStatus = 'online' | 'offline';

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  /** Eine Probe läuft gerade. */
  checking: boolean;
}

export interface MonitorOptions {
  probe: () => Promise<boolean>;
  isVisible?: () => boolean;
  /** Ziel für `pageshow`, `online`, `offline`. Standard: `window`. */
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Ziel für `visibilitychange`. Standard: `document`. */
  documentTarget?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export class ConnectionMonitor {
  private snapshot: ConnectionSnapshot = { status: 'online', checking: false };
  private readonly listeners = new Set<() => void>();
  private readonly recoveredHandlers = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopFn: (() => void) | null = null;

  constructor(private readonly options: MonitorOptions) {}

  getSnapshot = (): ConnectionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Meldet, wenn der Server nach einem Ausfall wieder antwortet. */
  onRecovered(handler: () => void): () => void {
    this.recoveredHandlers.add(handler);
    return () => this.recoveredHandlers.delete(handler);
  }

  private set(patch: Partial<ConnectionSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (next.status === this.snapshot.status && next.checking === this.snapshot.checking) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private visible(): boolean {
    return this.options.isVisible
      ? this.options.isVisible()
      : document.visibilityState !== 'hidden';
  }

  /** Probe jetzt (mehrere gleichzeitige Aufrufe teilen sich eine Probe). */
  check(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.set({ checking: true });
    this.inFlight = this.options
      .probe()
      .then(
        (ok) => this.handle(ok),
        () => this.handle(false),
      )
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Eine Anfrage der App ist am Netz gescheitert: Zustand sofort prüfen, statt auf die nächste Runde zu warten. */
  noteNetworkError(): void {
    if (this.snapshot.status === 'online') void this.check();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Wertet eine Probe aus. Zustand und „prüft“ ändern sich zusammen, damit nie ein Zwischenstand sichtbar ist. */
  private handle(ok: boolean): void {
    if (ok) {
      this.clearRetry();
      this.failures = 0;
      const wasOffline = this.snapshot.status === 'offline';
      this.set({ status: 'online', checking: false });
      if (wasOffline) {
        for (const handler of this.recoveredHandlers) {
          try {
            handler();
          } catch {
            // Ein fehlerhafter Zuhörer darf die anderen nicht aufhalten.
          }
        }
      }
      return;
    }
    this.set({ status: 'offline', checking: false });
    this.clearRetry();
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 30_000;
    this.failures += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Eine verborgene Seite wartet: Beim Zurückkehren wird ohnehin geprüft.
      if (this.visible()) void this.check();
    }, delay);
  }

  /** Beginnt zu überwachen. Gibt eine Funktion zurück, die alles wieder abhängt. */
  start(): () => void {
    if (this.stopFn) return this.stopFn;
    const win = this.options.windowTarget ?? window;
    const doc = this.options.documentTarget ?? document;
    const check = (): void => void this.check();
    const onVisibility = (): void => {
      if (this.visible()) void this.check();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    for (const name of ['pageshow', 'online', 'offline'] as const)
      win.addEventListener(name, check);
    this.pollTimer = setInterval(() => {
      // Im Ausfall übernimmt die Wiederholung mit wachsendem Abstand.
      if (this.visible() && this.snapshot.status === 'online') void this.check();
    }, POLL_INTERVAL_MS);

    this.stopFn = () => {
      doc.removeEventListener('visibilitychange', onVisibility);
      for (const name of ['pageshow', 'online', 'offline'] as const) {
        win.removeEventListener(name, check);
      }
      if (this.pollTimer !== null) clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.clearRetry();
      this.stopFn = null;
    };
    return this.stopFn;
  }
}
