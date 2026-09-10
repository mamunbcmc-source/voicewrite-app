// VoiceWrite AI — Service Worker
// Caches the app shell (this page + icons) so the app opens instantly and
// still works (UI-wise) with no signal. Voice-to-text, AI writing, and
// backend calls still need an active internet connection — only the app
// screen itself is cached for offline use.

const CACHE_NAME = 'voicewrite-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own same-origin GET requests as "app shell" cache.
  // Everything else (backend API, Anthropic API, Google Fonts, xlsx CDN)
  // goes straight to the network — never cached, never intercepted.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to cache
      // Cache-first for instant load, but refresh cache in background.
      return cached || networkFetch;
    })
  );
});
