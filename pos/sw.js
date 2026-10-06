/* =========================================================
   Service worker Robucca POS: aplikasi tetap bisa dibuka & dipakai saat
   internet putus. Kode (HTML/JS/CSS) diambil dari jaringan dulu supaya selalu
   versi terbaru, lalu jatuh ke cache bila offline. API tidak pernah di-cache.
   Tambah berkas baru ke SHELL (tes tests/sw.test.js memeriksanya).
   ========================================================= */
const VERSION = 'robucca-pos-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/pos.css',
  'js/app.js', 'js/boot.js', 'js/ops.js', 'js/state.js',
  'js/components/approve.js', 'js/components/charts.js', 'js/components/numpad.js', 'js/components/orderDetail.js', 'js/components/receipt.js',
  'js/core/calc.js', 'js/core/dates.js', 'js/core/ids.js', 'js/core/money.js', 'js/core/perms.js', 'js/core/pin.js', 'js/core/report.js', 'js/core/seed.js', 'js/core/validate.js',
  'js/data/backend.js', 'js/data/bus.js', 'js/data/demo.js', 'js/data/local.js', 'js/data/master.js', 'js/data/remote.js',
  'js/lib/idb.js', 'js/lib/ui.js',
  'js/views/bills.js', 'js/views/history.js', 'js/views/kds.js', 'js/views/login.js', 'js/views/queue.js', 'js/views/sell.js', 'js/views/setup.js', 'js/views/shift.js',
  'js/views/office/audit.js', 'js/views/office/branches.js', 'js/views/office/common.js', 'js/views/office/dashboard.js', 'js/views/office/devices.js', 'js/views/office/index.js',
  'js/views/office/menu.js', 'js/views/office/promos.js', 'js/views/office/reports.js', 'js/views/office/settings.js', 'js/views/office/shifts.js', 'js/views/office/staff.js',
  'js/views/office/stock.js', 'js/views/office/transactions.js',
  '../js/data.js', '../assets/brand/wordmark-light.png', '../assets/brand/lockup-dark.png', '../assets/brand/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
    if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
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
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req));
});
