/*
 * Service Worker von Pagewise.
 *
 * Er macht die App schneller und zeigt ohne Verbindung die App-Oberfläche statt einer Fehlerseite.
 * Er speichert NUR die Dateien der Oberfläche (HTML, Skripte, Stile, Schriften, Icons), nie Antworten
 * der API und nie den Antwort-Strom: Chats, Fächer und Schlüssel gelangen nie in den Cache des Browsers.
 *
 * - /api/*: wird nicht angefasst, der Browser fragt den Server direkt.
 * - Nur GET derselben Herkunft wird behandelt.
 * - Seitenaufrufe: zuerst das Netz (damit eine neue Version sofort kommt), aber mit Zeitlimit: Antwortet der Server
 *   nicht innerhalb von PAGE_TIMEOUT_MS (der Mac schläft, Tailscale ist verbunden, die Verbindung hängt), kommt die
 *   gemerkte Startseite, und die Netzantwort aktualisiert den Speicher im Hintergrund. Ohne gemerkte Seite wird
 *   gewartet (es gibt nichts anderes zu zeigen).
 * - /assets/*: Dateinamen enthalten einen Hash und ändern sich mit dem Inhalt, deshalb zuerst der Cache.
 * - /boot.js: kleines Skript, das Darstellung und Effektstufe vor dem ersten Anstrich setzt. Es steht synchron im
 *   <head> und blockiert den Anstrich, deshalb ein kürzeres Zeitlimit (BOOT_TIMEOUT_MS). Es hat keinen Hash,
 *   deshalb zuerst das Netz (eine neue Fassung kommt sofort), sonst die gemerkte.
 *
 * Wer den Inhalt der gemerkten Dateien oder die Icons ändert, zählt die Versionsnummer der Speichernamen hoch.
 */
const SHELL_CACHE = 'pagewise-shell-v2';
const ASSET_CACHE = 'pagewise-assets-v2';
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];
const MAX_ASSETS = 80;
const PAGE_TIMEOUT_MS = 3000;
const BOOT_TIMEOUT_MS = 1500;

self.addEventListener('install', (event) => {
  // Eine neue Version übernimmt sofort, statt auf das Schließen aller Tabs zu warten.
  self.skipWaiting();
  // Startseite und Startskript gleich merken: Beim ersten Besuch läuft die Seite noch ohne Service Worker, ohne
  // diesen Schritt gäbe es beim zweiten Öffnen (der Mac schläft gerade) nichts, auf das das Zeitlimit zurückfallen kann.
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) {
    await cache.delete(request);
  }
}

async function assetResponse(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

// Marken für den Wettlauf zwischen Netz und Zeitlimit.
const TIMED_OUT = Symbol('timed-out');
const FAILED = Symbol('failed');

/** Löst nach `ms` Millisekunden mit TIMED_OUT auf, früher mit dem Ergebnis; ein Fehler des Netzes ergibt FAILED. */
function raceWithTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(FAILED);
      },
    );
  });
}

/**
 * Zuerst das Netz, aber nie länger als `timeoutMs`, wenn es eine gemerkte Fassung gibt. Die Netzantwort wird in
 * jedem Fall gemerkt (auch wenn sie erst nach dem Zeitlimit kommt), `waitUntil` hält den Worker dafür am Leben.
 * Fehlt die gemerkte Fassung, wird auf das Netz gewartet; ein Fehler des Netzes geht dann an den Browser weiter.
 */
async function networkFirst(event, request, key, timeoutMs, isCacheable) {
  const cache = await caches.open(SHELL_CACHE);
  const stored = await cache.match(key);
  const network = fetch(request).then(async (response) => {
    if (isCacheable(response)) await cache.put(key, response.clone());
    return response;
  });
  if (!stored) return network;
  event.waitUntil(network.catch(() => {}));
  const outcome = await raceWithTimeout(network, timeoutMs);
  if (outcome === TIMED_OUT || outcome === FAILED) return stored;
  // Läuft Tailscale Serve, aber nicht der Server dahinter, antwortet Serve schnell mit 502 bis 504. Dann ist die
  // gemerkte Oberfläche besser als die Fehlerseite: Sie zeigt selbst, dass der Mac nicht erreichbar ist.
  if (outcome.status >= 502 && outcome.status <= 504) return stored;
  return outcome;
}

// Nur die Startseite der Oberfläche merken, keine Fehlerseiten, Umleitungen oder andere Dateien.
const isStartPage = (response) =>
  response.ok &&
  response.type === 'basic' &&
  (response.headers.get('content-type') || '').includes('text/html');
const isScript = (response) => response.ok && response.type === 'basic';

/** Merkt Startseite und Startskript vorab. Ein Fehler (kein Netz bei der Installation) ist kein Grund abzubrechen. */
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  for (const [key, isCacheable] of [
    ['/', isStartPage],
    ['/boot.js', isScript],
  ]) {
    try {
      const response = await fetch(key, { cache: 'no-store' });
      if (isCacheable(response)) await cache.put(key, response);
    } catch {
      // Beim nächsten Seitenaufruf wird nachgeholt.
    }
  }
}

function pageResponse(event, request) {
  return networkFirst(event, request, '/', PAGE_TIMEOUT_MS, isStartPage);
}

function bootResponse(event, request) {
  return networkFirst(event, request, '/boot.js', BOOT_TIMEOUT_MS, isScript);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageResponse(event, request));
  } else if (url.pathname === '/boot.js') {
    event.respondWith(bootResponse(event, request));
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(assetResponse(request));
  }
});
