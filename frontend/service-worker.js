/* ═══════════════════════════════════════════════════════════════════
   ONYX SERVICE WORKER  —  Network-first strategy
   - Serves the app shell from cache when offline
   - Always tries network first so you get fresh API responses
   - Caches the HTML, manifest, and SW itself for offline shell
═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'onyx-v1';

// Files to pre-cache on install (the app shell)
const PRECACHE_URLS = [
  './second-brain.html',
  './manifest.json',
];

// ── Install: pre-cache app shell ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fallback to cache ───────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go straight to network for API calls — never cache these
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache (offline mode)
        return caches.match(event.request)
          .then(cached => cached || caches.match('./second-brain.html'));
      })
  );
});
