/* FIND ME service worker — Mohsen ~ Danial
 * - App shell: network-first, cached copy when offline.
 * - Hashed build files (/assets/name-HASH.js|css|wasm): cache-first, they never change.
 * - Everything else under /assets/ (3D maps, character, pose pictures — same URL, new content
 *   after every art update): network-first, cached copy only when offline.
 * - API (/v1/): always network; never cached here.
 */
const SHELL = 'findme-shell-v2';
const ASSETS = 'findme-assets-v2'; // v2: drops caches that pinned old 3D art

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname === '/health') return;

  const hashed = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|wasm)$/.test(url.pathname);
  if (url.pathname.startsWith('/assets/') && !hashed) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(ASSETS).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(e.request)) ?? Response.error()),
    );
    return;
  }
  if (hashed || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(async () => (await caches.match(e.request)) ?? (await caches.match('/'))),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
