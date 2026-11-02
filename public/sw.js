/* NOCLIP service worker. The version and precache constants below are stamped at build time (see vite.config.ts).
   Strategy: precache the app shell; cache-first for same-origin assets; network-first for navigations
   so players get updates; old caches are deleted on activate (cache-versioning). */
const VERSION = '__VERSION__';
const CACHE = `noclip-${VERSION}`;
const PRECACHE = '__PRECACHE__';

self.addEventListener('install', (event) => {
  const list = Array.isArray(PRECACHE) ? PRECACHE : [];
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(list.map((f) => new URL(f, self.registration.scope).href))).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('noclip-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((r) => r || caches.match(new URL('./', self.registration.scope).href))));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
});
