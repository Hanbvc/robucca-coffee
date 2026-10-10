/* =========================================================
   Service worker Robucca POS: aplikasi tetap bisa dibuka saat internet putus.
   HTML/JS/CSS diambil dari jaringan dulu (selalu versi terbaru) lalu jatuh ke
   cache bila offline; gambar dari cache dulu. API (/api/) tidak pernah di-cache.
   Nama berkas hasil build memakai hash, jadi cache diisi saat dipakai (runtime).
   ========================================================= */
const VERSION = 'robucca-pos-v4';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', 'index.html', 'boot.js', 'manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('robucca-pos-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(req), timeout(5000)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw e;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('/api/')) return; // data selalu langsung ke server
    if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
    e.respondWith(networkFirst(req));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});
