/*
 * Service Worker von Pagewise.
 *
 * Er macht die App schneller und zeigt ohne Verbindung die App-Oberfläche statt einer Fehlerseite.
 * Er speichert NUR die Dateien der Oberfläche (HTML, Skripte, Stile, Schriften, Icons), nie Antworten
 * der API und nie den Antwort-Strom: Chats, Fächer und Schlüssel gelangen nie in den Cache des Browsers.
 *
 * - /api/*: wird nicht angefasst, der Browser fragt den Server direkt.
 * - Nur GET derselben Herkunft wird behandelt.
 * - Seitenaufrufe: zuerst das Netz (damit eine neue Version sofort kommt), ohne Netz die gemerkte Startseite.
 * - /assets/*: Dateinamen enthalten einen Hash und ändern sich mit dem Inhalt, deshalb zuerst der Cache.
 */
const SHELL_CACHE = 'pagewise-shell-v1';
const ASSET_CACHE = 'pagewise-assets-v1';
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];
const MAX_ASSETS = 80;

self.addEventListener('install', () => {
  // Eine neue Version übernimmt sofort, statt auf das Schließen aller Tabs zu warten.
  self.skipWaiting();
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

async function pageResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Nur die Startseite der Oberfläche merken, keine Fehlerseiten, Umleitungen oder andere Dateien.
    const isPage = (response.headers.get('content-type') || '').includes('text/html');
    if (response.ok && response.type === 'basic' && isPage) await cache.put('/', response.clone());
    return response;
  } catch {
    const fallback = await cache.match('/');
    if (fallback) return fallback;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageResponse(request));
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(assetResponse(request));
  }
});
