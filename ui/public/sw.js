const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `crumb-static-${CACHE_VERSION}`;
const API_CACHE     = `crumb-api-${CACHE_VERSION}`;
const IMAGE_CACHE   = `crumb-images-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: App-Shell vorlädt ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: alte Caches aufräumen ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => ![STATIC_CACHE, API_CACHE, IMAGE_CACHE].includes(key))
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Strategie je nach Request-Typ ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Nur GET cachen
  if (request.method !== 'GET') return;

  // Chrome-Extensions etc. ignorieren
  if (!url.protocol.startsWith('http')) return;

  // API-Calls: Network First mit Cache-Fallback
  // NACHHER:
  if (url.pathname.startsWith('/api/')) {
      // API-Calls NICHT cachen – sie sind personalisiert, gefiltert
      // und sollten immer frisch vom Server kommen.
      // Offline-Fallback für die Rezeptliste bleibt via Navigation-Cache erhalten.
      return; // → Browser handled den fetch normal, kein SW-Eingriff
  }

  // Bilder (eigene Uploads + Unsplash): Cache First
  if (
    url.pathname.startsWith('/uploads/') ||
    url.hostname === 'images.unsplash.com'
  ) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 200));
    return;
  }

  // Next.js statische Assets (_next/static): Cache First
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, 500));
    return;
  }

  // Seiten-Navigationen: Network First, Fallback auf gecachte Version
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, 60 * 60 * 24));
    return;
  }
});

// ── Strategien ────────────────────────────────────────────────

async function networkFirst(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseToCache = response.clone();
      cache.put(request, withTimestamp(responseToCache));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached && !isExpired(cached, maxAgeSeconds)) return cached;
    if (cached) return cached; // abgelaufen aber besser als nichts
    return new Response(JSON.stringify({ error: 'Offline – keine gecachten Daten verfügbar' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await trimCache(cache, maxEntries - 1);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ── Hilfsfunktionen ───────────────────────────────────────────

function withTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isExpired(response, maxAgeSeconds) {
  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return false;
  return (Date.now() - parseInt(cachedAt)) > maxAgeSeconds * 1000;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await Promise.all(keys.slice(0, keys.length - maxEntries).map(k => cache.delete(k)));
  }
}
