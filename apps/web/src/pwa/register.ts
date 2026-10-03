/** Wie oft die Seite beim Zurückkehren nach einer neuen Version des Service Workers sucht (Millisekunden). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface Environment {
  /** Nur in der gebauten Version; im Entwicklungsserver stört ein Service Worker. */
  production: boolean;
  navigator?: Pick<Navigator, 'serviceWorker'>;
  isSecureContext?: boolean;
  document?: Pick<Document, 'addEventListener' | 'visibilityState'>;
  now?: () => number;
}

/**
 * Meldet den Service Worker an (`/sw.js`). Er speichert nur Dateien der Oberfläche, nie Antworten der
 * API (siehe `public/sw.js`). Ohne Unterstützung, ohne sicheren Kontext oder im Entwicklungsserver
 * passiert nichts. Gibt die Anmeldung zurück oder `null`.
 */
export async function registerServiceWorker(
  env: Environment = {
    production: import.meta.env.PROD,
    navigator: globalThis.navigator,
    isSecureContext: globalThis.isSecureContext,
    document: globalThis.document,
  },
): Promise<ServiceWorkerRegistration | null> {
  if (!env.production || !env.isSecureContext) return null;
  const container = env.navigator?.serviceWorker;
  if (!container) return null;

  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register('/sw.js', { scope: '/' });
  } catch {
    // Ohne Service Worker läuft Pagewise normal weiter, nur ohne Zwischenspeicher.
    return null;
  }

  // Eine als App auf dem Home-Bildschirm gestartete Seite wird selten neu geladen: beim Zurückkehren
  // nachsehen, ob es eine neue Version gibt.
  const now = env.now ?? Date.now;
  let lastCheck = now();
  env.document?.addEventListener('visibilitychange', () => {
    if (env.document?.visibilityState !== 'visible') return;
    if (now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheck = now();
    registration.update().catch(() => {});
  });
  return registration;
}
