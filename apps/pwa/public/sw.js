/* Service worker aplikasi pelanggan Robucca: aplikasi tetap terbuka saat sinyal hilang.
   - Hanya permintaan GET ke origin aplikasi ini. API (origin lain), pembayaran, dan status pesanan TIDAK pernah di-cache.
   - Halaman & data navigasi Next: jaringan dulu, cadangan dari cache bila offline.
   - /_next/static (nama berkas memuat hash, tidak pernah berubah): cache dulu.
   - /assets (foto menu, logo): tampilkan dari cache, perbarui di latar.
   - Saat dipasang, halaman-halaman tab beserta skrip & CSS-nya langsung disimpan, jadi semua tab tetap terbuka
     saat offline walau belum pernah dibuka.
   Path mengikuti scope pendaftaran, jadi bekerja juga di sub-path (NEXT_PUBLIC_BASE_PATH). */
const VERSION = 'v1';
const PAGES = `rbc-pages-${VERSION}`;
const STATIC = `rbc-static-${VERSION}`;
const ASSETS = `rbc-assets-${VERSION}`;
const KEEP = [PAGES, STATIC, ASSETS];
const LIMIT = { [PAGES]: 60, [STATIC]: 200, [ASSETS]: 250 };
const BASE = new URL(self.registration.scope).pathname; // "/" atau "/sub/path/"
/** Halaman aplikasi (relatif terhadap BASE) yang disimpan saat pemasangan. */
const SHELLS = ['', 'menu/', 'checkout/', 'pesanan/', 'pesanan/status/', 'reservasi/', 'reservasi/tiket/', 'akun/'];

/** Simpan halaman tab + skrip/CSS yang dirujuknya. Gagal di satu halaman tidak menggagalkan pemasangan. */
async function precache() {
  const pages = await caches.open(PAGES);
  const stat = await caches.open(STATIC);
  const refs = new Set();
  await Promise.all(
    SHELLS.map(async (p) => {
      try {
        const url = new URL(BASE + p, self.location.origin);
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!cacheable(res)) return;
        const html = await res.clone().text();
        await pages.put(url.origin + url.pathname, res);
        for (const m of html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)) refs.add(new URL(m[1], url).href);
      } catch {
        /* disimpan nanti saat halaman dibuka */
      }
    }),
  );
  await Promise.all(
    [...refs].map(async (u) => {
      try {
        if (await stat.match(u)) return;
        const res = await fetch(u);
        if (cacheable(res)) await stat.put(u, res);
      } catch {
        /* noop */
      }
    }),
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rbc-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Batasi jumlah isi cache (yang paling lama dibuang dulu). */
async function trim(name) {
  const c = await caches.open(name);
  const keys = await c.keys();
  const over = keys.length - LIMIT[name];
  for (let i = 0; i < over; i++) await c.delete(keys[i]);
}

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected && !res.headers.get('cache-control')?.includes('no-store');

/** Kunci halaman tanpa query (?id=… memakai HTML statis yang sama); data navigasi Next (header RSC) disimpan terpisah. */
const pageKey = (req, url) => url.origin + url.pathname + (req.headers.get('rsc') ? '?rsc' : '');

/** Halaman yang belum pernah dibuka di perangkat ini, saat offline. */
const offlinePage = () =>
  new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Offline · Robucca</title></head>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;text-align:center;font-family:Poppins,system-ui,sans-serif;background:#FAEEDA;color:#1C1B19">` +
      `<div><h1 style="font-size:20px;margin:0 0 8px">Kamu sedang offline</h1><p style="margin:0;color:#5B574F;font-size:14px;line-height:1.5">Halaman ini belum pernah dibuka di perangkat ini.<br>Sambungkan internet lalu coba lagi.</p>` +
      `<a href="${BASE}" style="display:inline-block;margin-top:18px;padding:12px 22px;border-radius:999px;background:#01512C;color:#fff;font-weight:600;text-decoration:none">Ke beranda</a></div></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

async function networkFirst(req, url) {
  const key = pageKey(req, url);
  const c = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (cacheable(res)) {
      await c.put(key, res.clone());
      void trim(PAGES);
    }
    return res;
  } catch (err) {
    const hit = await c.match(key);
    if (hit) return hit;
    if (req.mode === 'navigate') return offlinePage();
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    await c.put(req, res.clone());
    void trim(STATIC);
  }
  return res;
}

async function staleWhileRevalidate(e, req) {
  const c = await caches.open(ASSETS);
  const hit = await c.match(req);
  const fresh = fetch(req)
    .then(async (res) => {
      if (cacheable(res)) {
        await c.put(req, res.clone());
        void trim(ASSETS);
      }
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    e.waitUntil(fresh);
    return hit;
  }
  return (await fresh) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (req.headers.get('accept')?.includes('text/event-stream')) return;
  const path = url.pathname.slice(BASE.length - 1); // "/menu/", "/_next/static/…"
  if (path === '/sw.js') return;
  if (path.startsWith('/_next/static/')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (path.startsWith('/assets/')) {
    e.respondWith(staleWhileRevalidate(e, req));
    return;
  }
  // Halaman, data navigasi Next (.txt), manifes, ikon.
  e.respondWith(networkFirst(req, url));
});
