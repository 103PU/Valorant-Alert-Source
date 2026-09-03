// Bumped whenever a shipped asset in ASSETS changes. The activate handler below
// deletes every cache whose name is not this one, so bumping is what actually
// evicts a stale shell — v1 kept serving the pre-license index.html to anyone
// who had already installed the PWA.
const CACHE_NAME = 'valorant-alert-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => {
    return Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    );
  }));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only cache GET requests, bypass WebSockets
  if (e.request.method !== 'GET' || e.request.url.includes('/ws')) {
    return;
  }

  // Never let an API response come from cache. License state, the share pin and
  // the QR all change during a session, and a cached "entitled" answer would
  // outlive a revoked license.
  const path = new URL(e.request.url).pathname;
  if (path.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for the shell so a new build is picked up on the next online
  // load; cache is the offline fallback, not the default answer.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
