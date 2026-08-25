/*
 * Service Worker.
 *
 * !! Bei jeder Änderung an einer der Shell-Dateien VERSION erhöhen. !!
 * Es gibt keinen Build-Schritt, der das automatisch tut.
 *
 * Die wichtigste Regel steht gleich in der ersten Zeile von fetch: Anfragen
 * an /api/ werden nicht abgefangen. Ein zwischengespeicherter
 * Konfigurationsstand wäre schlimmer als gar keine Offline-Fähigkeit - man
 * würde einen Zustand sehen, den es nicht mehr gibt, und ihn womöglich
 * zurückschreiben. Offline-Daten leben deshalb in der App-Schicht, sichtbar
 * als solche gekennzeichnet.
 */
const VERSION = '8';
const SHELL_CACHE = `mm4-shell-v${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/themes.css',
  '/mobile.css',
  '/auth.js',
  '/ws-client.js',
  '/i18n.js',
  '/visual-editor.js',
  '/app.js',
  '/pwa.js',
  '/vendor/Sortable.min.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Einzeln statt addAll: eine fehlende Datei soll nicht die gesamte
    // Installation scheitern lassen.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        await cache.add(new Request(`${url}?v=${VERSION}`, { cache: 'reload' }));
      } catch {
        // Nicht erreichbar - beim nächsten Mal.
      }
    }));
    // Bewusst KEIN skipWaiting: ein Wechsel mitten in einer offenen
    // Bearbeitung würde sie verwerfen. Die App fragt stattdessen nach.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('mm4-shell-') && name !== SHELL_CACHE) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function cacheKey(request) {
  const url = new URL(request.url);
  url.search = `?v=${VERSION}`;
  return url.toString();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Niemals API-Antworten anfassen. Siehe oben.
  if (url.pathname.startsWith('/api/')) return;

  // Die Live-Ansicht muss den echten Stand zeigen.
  if (url.pathname.startsWith('/mirror')) return;

  // Nur GET, nur eigene Herkunft.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  event.respondWith(handleAsset(event.request));
});

/**
 * Seitenaufrufe: erst das Netz, mit kurzer Frist. Danach die
 * zwischengespeicherte Hülle, sonst die Offline-Seite.
 */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    if (response.ok) {
      cache.put(cacheKey(new Request('/index.html')), response.clone());
    }
    return response;
  } catch {
    return (await cache.match(cacheKey(new Request('/index.html'))))
      || (await cache.match(cacheKey(new Request('/offline.html'))))
      || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

/**
 * Shell-Dateien: sofort aus dem Zwischenspeicher, im Hintergrund erneuern.
 */
async function handleAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await refresh) || new Response('', { status: 504 });
}
