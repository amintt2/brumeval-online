/* Brumeval Online — service worker (installable web app + faster loading).
 *
 *  /models/ /icons/ /ui/ /pwa/  cache-first: answered from the cache, then refreshed in the background so a
 *                               deploy that upgrades a model is picked up on the next load.
 *  pages (index.html), /assets/ (JS/CSS), /sw.js, /manifest.webmanifest
 *                               network-first: web players always get the latest deploy; the cache is only
 *                               used when the network is down.
 *  everything else (/ws, /news.json, /api/*, /health, other origins) is never intercepted.
 *
 * Bump VERSION when this strategy changes: caches of older versions are deleted on activation.
 */
const VERSION = 'v1';
const ASSET_CACHE = `brumeval-assets-${VERSION}`;
const PAGE_CACHE = `brumeval-pages-${VERSION}`;
const ASSET_PREFIXES = ['/models/', '/icons/', '/ui/', '/pwa/'];
const PAGE_PREFIXES = ['/assets/'];
const MAX_PAGE_ENTRIES = 60;

self.addEventListener('install', (event) => {
  // Precache the page shell so the game can still show its interface when the connection drops.
  event.waitUntil(
    caches.open(PAGE_CACHE)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
      .catch(() => { /* offline during install: filled on the next visit */ })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([ASSET_CACHE, PAGE_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('brumeval-') && !keep.has(key)) await caches.delete(key);
    }
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg === 'brumeval:clear-caches') {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) if (key.startsWith('brumeval-')) await caches.delete(key);
    })());
  } else if (msg && msg.type === 'brumeval:warm' && Array.isArray(msg.urls)) {
    // Files the page downloaded before this worker controlled it (first visit): store them now.
    event.waitUntil(warm(msg.urls.slice(0, 400)));
  }
});

async function warm(urls) {
  const cache = await caches.open(ASSET_CACHE);
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw, self.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin || !startsWithAny(url.pathname, ASSET_PREFIXES)) continue;
    const req = new Request(url.pathname);
    if (await cache.match(req)) continue;
    try {
      const res = await fetch(req); // normally served by the HTTP cache (revalidation only)
      if (res.ok && res.status === 200 && res.type === 'basic') await cache.put(req, res);
    } catch { /* offline: next visit */ }
  }
}

const startsWithAny = (path, prefixes) => prefixes.some((p) => path.startsWith(p));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;
  const path = url.pathname;

  if (startsWithAny(path, ASSET_PREFIXES)) {
    event.respondWith(cacheFirst(event, req));
  } else if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, req, new Request('/')));
  } else if (startsWithAny(path, PAGE_PREFIXES) || path === '/manifest.webmanifest') {
    event.respondWith(networkFirst(event, req));
  }
});

async function cacheFirst(event, req) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then(async (res) => {
    // Only complete, successful responses are cached: a missing model (404) must keep falling back.
    if (res.ok && res.status === 200 && res.type === 'basic') await cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

async function networkFirst(event, req, fallbackKey) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = (req.mode === 'navigate' && (await event.preloadResponse)) || (await fetch(req));
    if (res.ok && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      event.waitUntil((async () => {
        await cache.put(fallbackKey || req, copy);
        const keys = await cache.keys();
        for (let i = 0; i < keys.length - MAX_PAGE_ENTRIES; i++) await cache.delete(keys[i]);
      })());
    }
    return res;
  } catch (err) {
    const cached = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (fallbackKey && (await cache.match(fallbackKey)));
    if (cached) return cached;
    throw err;
  }
}
