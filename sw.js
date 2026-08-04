// ============================================================
//  O2D Analytics — Service Worker
//  Cache-first for app shell; network-pass-through for GAS API
// ============================================================

var CACHE_NAME = 'o2d-v1';
var SHELL = [
  './',
  './index.html',
  './apiconfig.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// ── Install: pre-cache shell ────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: delete old caches ─────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k)    { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: serve shell from cache; pass through GAS / CDN ───
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Never intercept GAS or Google API calls
  if (
    url.indexOf('script.google.com')   >= 0 ||
    url.indexOf('googleapis.com')      >= 0 ||
    url.indexOf('cdnjs.cloudflare.com')>= 0
  ) {
    return; // network only
  }

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request)
        .then(function(response) {
          // Cache successful GET responses
          if (
            response &&
            response.status === 200 &&
            e.request.method === 'GET'
          ) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline fallback → serve the shell
          return caches.match('./index.html');
        });
    })
  );
});
