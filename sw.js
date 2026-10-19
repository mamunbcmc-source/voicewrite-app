// VoiceWrite AI — Service Worker
// Goal: the app must OPEN and RECORD with no internet at all.
//  • The app page (index.html) is network-first, so new deploys show up at
//    once — but if the network is down OR slower than NAV_TIMEOUT_MS, the
//    last saved copy opens instead.
//  • The Firebase + Excel scripts the page needs (served from CDNs) are saved
//    on the phone too, so the page does not break when offline.
// Voice-to-text, AI writing and the Admin Panel still need internet.

const CACHE_NAME = 'voicewrite-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];
const CDN_FILES = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
const NAV_TIMEOUT_MS = 3500;
const INDEX_URL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Each file is saved on its own, so one failure never blocks the others.
    await Promise.all(SHELL_FILES.map((u) =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    await Promise.all(CDN_FILES.map(async (u) => {
      try {
        const res = await fetch(u, { mode: 'no-cors' });
        await cache.put(u, res);
      } catch (e) { /* will be saved the first time the page loads it online */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

async function cachedAppPage(req) {
  return (await caches.match(req, { ignoreSearch: true })) ||
         (await caches.match(INDEX_URL)) ||
         (await caches.match('./'));
}

// Network first; fall back to the saved copy if offline or too slow.
function appPageResponse(req) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled && res) { settled = true; resolve(res); } };

    const timer = setTimeout(async () => { done(await cachedAppPage(req)); }, NAV_TIMEOUT_MS);

    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.status === 200) {
        const forReq = res.clone();
        const forIndex = res.clone();
        caches.open(CACHE_NAME).then((c) => {
          c.put(req, forReq);
          c.put(INDEX_URL, forIndex);
        }).catch(() => {});
      }
      done(res);
    }).catch(async () => {
      clearTimeout(timer);
      const cached = await cachedAppPage(req);
      if (cached) done(cached);
      else done(Response.error());
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Third-party scripts the page needs: use the saved copy first.
  if (url.origin !== new URL(self.location.href).origin) {
    if (CDN_FILES.includes(req.url)) {
      event.respondWith(
        caches.match(req.url).then((cached) =>
          cached || fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req.url, copy)).catch(() => {});
            return res;
          })
        )
      );
    }
    // Everything else (backend API, Google Fonts…) goes straight to the network.
    return;
  }

  const isAppPage =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/voicewrite-app/');

  if (isAppPage) {
    event.respondWith(appPageResponse(req));
    return;
  }

  // Static shell assets (icons, manifest): saved copy first, refreshed in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
