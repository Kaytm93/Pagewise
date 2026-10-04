/** Wie lange die App beim Start auf Sitzung und Arbeitsbereich wartet, bevor sie „Server antwortet nicht“ zeigt. */
export const LOAD_TIMEOUT_MS = 8_000;

/** Fehler, wenn eine Antwort zu lange braucht. */
export class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/**
 * Wartet höchstens `ms` auf `promise`. Die Anfrage selbst läuft weiter (sie lässt sich ohne Abbruchsignal nicht
 * beenden), ihr spätes Ergebnis ignoriert der Aufrufer.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
