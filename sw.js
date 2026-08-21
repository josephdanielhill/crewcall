/**
 * CrewCall Service Worker
 *
 * Caching strategy:
 *  - Pre-cache: core HTML, CSS, JS assets on install
 *  - Cache-first: fonts (Google Fonts), app icons, screenshots
 *  - Network-first: Fathom analytics
 *  - Stale-while-revalidate: everything else
 *
 * Version: 1.0.0
 */

const PRECACHE = 'crewcall-v1';
const RUNTIME = 'crewcall-runtime-v1';
const FONTS_CACHE = 'crewcall-fonts-v1';
const ANALYTICS_CACHE = 'crewcall-analytics-v1';

const PRECACHE_URLS = [
  '/',
  '/app.html',
  '/index.html',
  '/manifest.json',
  '/css/crewcall.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/hero-bg.mp4',
  '/privacy.html'
];

// ---- Install: pre-cache core assets ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: clean old caches ----
self.addEventListener('activate', (event) => {
  const currentCaches = [PRECACHE, RUNTIME, FONTS_CACHE, ANALYTICS_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return cacheNames.filter((name) => !currentCaches.includes(name));
    }).then((cachesToDelete) => {
      return Promise.all(cachesToDelete.map((name) => caches.delete(name)));
    }).then(() => self.clients.claim())
  );
});

// ---- Fetch: routing by URL pattern ----
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  // Google Fonts: cache-first (versioned URLs, rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, FONTS_CACHE));
    return;
  }

  // Fathom analytics: network-first (fresh data preferred)
  if (url.hostname === 'cdn.usefathom.com') {
    event.respondWith(networkFirst(event.request, ANALYTICS_CACHE));
    return;
  }

  // Pre-cached assets: cache-first
  if (PRECACHE_URLS.includes(path)) {
    event.respondWith(cacheFirst(event.request, PRECACHE));
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request, RUNTIME));
});

// ---- Caching strategies ----

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline and no cache fallback
    if (request.mode === 'navigate') {
      const cache = await caches.open(PRECACHE);
      const fallback = await cache.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}