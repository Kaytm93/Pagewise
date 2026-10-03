export interface AttemptLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

export type LimiterDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Begrenzt fehlgeschlagene Anmeldeversuche. Hinter Tailscale Serve kommen alle Anfragen von
 * 127.0.0.1, eine Begrenzung je Adresse hätte deshalb keinen Sinn. Gezählt wird daher für die
 * ganze Instanz: Nach `maxFailures` Fehlversuchen innerhalb des Fensters sind Versuche gesperrt,
 * bis der älteste Fehlversuch aus dem Fenster fällt. Der Zustand liegt nur im Speicher.
 */
export class AttemptLimiter {
  private failures: number[] = [];
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: AttemptLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    this.failures = this.failures.filter((time) => time > cutoff);
  }

  check(): LimiterDecision {
    this.prune();
    if (this.failures.length < this.maxFailures) return { allowed: true };
    const oldest = this.failures[0] ?? this.now();
    const retryAfterMs = oldest + this.windowMs - this.now();
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recordFailure(): void {
    this.prune();
    this.failures.push(this.now());
  }

  /** Nach erfolgreicher Anmeldung beginnt die Zählung von vorn. */
  reset(): void {
    this.failures = [];
  }
}
