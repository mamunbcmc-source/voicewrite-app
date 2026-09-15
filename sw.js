// VoiceWrite AI — Service Worker
// Caches the app shell (icons, manifest) so the app opens instantly and
// still works (UI-wise) with no signal. The main app page (index.html)
// always uses network-first, so every update (new features, bug fixes)
// reaches users immediately instead of being stuck behind an old cache.
// Voice-to-text, AI writing, and backend calls still need an active
// internet connection — only the app shell itself works offline.

const CACHE_NAME = 'voicewrite-shell-v3';
const SHELL_FILES = [
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

  // Only handle our own same-origin GET requests. Everything else
  // (backend API, Anthropic API, Google Fonts, xlsx CDN) goes straight
  // to the network — never cached, never intercepted.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // The app page itself (index.html / navigations / '/') is ALWAYS
  // fetched from the network first, so new deploys show up immediately.
  // If the network is unavailable, fall back to the last cached copy.
  const isAppPage =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/voicewrite-app/');

  if (isAppPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Static shell assets (icons, manifest): cache-first for instant load,
  // refreshed in the background for next time.
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
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
