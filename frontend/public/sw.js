/* Zauberkoch Service Worker.
 * Cache version — BUMP on every app-shell change (+ update CLAUDE.md).
 */
const CACHE = 'zauberkoch-v110';
const API_CACHE = 'zauberkoch-api-v1';
const SHELL = ['/', '/icon.svg', '/manifest.webmanifest', '/theme-init.js', '/fonts/inter.woff2', '/fonts/bricolage.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// The API cache holds ONE account's recipes. It must not survive a change of
// account: on a shared device the next person, once offline, would be served
// the previous one's list from `caches.match()` — same URL for every user.
// The app posts {type:'zk-clear-api-cache'} on login and on logout.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'zk-clear-api-cache') return;
  event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never intercept auth or the generation stream
  if (url.pathname.startsWith('/api/v1/auth') || url.pathname.includes('/generate')) return;

  // Favorites & recipe details: network-first with cache fallback -> offline readable
  if (url.pathname.startsWith('/api/v1/recipes')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Other API calls: network only
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first (fresh shell), cache fallback for offline.
  // cache: 'reload' bypasses the browser HTTP cache — a heuristically
  // cached index.html would otherwise pin users to old chunk references.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Static assets (hashed filenames): cache-first
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
          // Transient network failure on a cache miss → don't leave the
          // respondWith promise rejected (uncaught "Failed to fetch"); retry the
          // cache, else surface a plain network error.
          .catch(() => caches.match(request).then((c) => c ?? Response.error())),
    ),
  );
});
