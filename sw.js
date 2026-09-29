'use strict';

/* =========================================================================
 * SERVICE WORKER
 * Makes Jedris an installable app that opens without a connection.
 * Network first: when online you always get the latest version from the
 * server, and every response is kept as the offline copy. Offline, the saved
 * copy is used, so 40 Lines, Blitz, Zen and Local Versus still work.
 * Online Versus, accounts and the leaderboard need the server.
 * ========================================================================= */
const CACHE = 'jedris-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    // Also save every script and stylesheet the page loads, so the first visit already works offline.
    const html = await (await cache.match('index.html')).text();
    const files = [...html.matchAll(/(?:src|href)="((?:js|css|assets)\/[^"]+)"/g)].map(m => m[1]);
    await cache.addAll([...new Set(files)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.endsWith('/ws')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html');
      throw e;
    }
  })());
});
