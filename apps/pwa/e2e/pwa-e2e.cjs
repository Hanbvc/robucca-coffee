/* E2E aplikasi pelanggan (Next.js, ekspor statis) terhadap API + kasir React. Bukan bagian `pnpm test`; jalankan manual:
     1. Postgres + DB uji (bukan robucca_dev/robucca_test): migrate deploy, SEED_DEMO=1 seed. API di :3310 dengan
        NODE_ENV=development (kode OTP dikembalikan sebagai devCode) dan CORS_ORIGINS memuat origin PWA & POS.
     2. PWA: NEXT_PUBLIC_API_URL=http://localhost:3310 pnpm --filter @robucca/pwa build (server statisnya dinyalakan skrip
        ini sendiri di :3311 dan dimatikan saat uji offline, karena mode offline Chromium tidak berlaku untuk service worker)
     3. POS: pnpm --filter @robucca/pos build && API_PROXY_TARGET=http://localhost:3310 npx vite preview --port 4310
     4. E2E_DB=postgresql://… node apps/pwa/e2e/pwa-e2e.cjs
   Selama uji, jam buka cabang IJN diatur 00:00–23:59 dan gambar QRIS contoh dipasang; nilai asli dikembalikan di akhir.
   Butuh paket playwright (PLAYWRIGHT_PATH) + Chromium (PLAYWRIGHT_BROWSERS_PATH). Tangkapan layar → apps/pwa/docs/screenshots. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || `${WT}/apps/pwa/docs/screenshots`;
const PWA_PORT = process.env.E2E_PWA_PORT || '3311';
const PWA = `http://localhost:${PWA_PORT}`;
const POS = `http://localhost:${process.env.E2E_POS_PORT || '4310'}/?nosw`;
const DB = process.env.E2E_DB || 'postgresql://postgres@localhost:54329/robucca_posapp?host=/tmp';
const BRANCH = 'IJN';
const PHONE = '081298765432';
fs.mkdirSync(SHOTS, { recursive: true });

const sql = (q) => execFileSync('psql', [DB.replace(/\?.*$/, ''), '-h', '/tmp', '-At', '-c', q]).toString().trim();
const log = (...a) => console.log('•', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/'/g, "''");

// QRIS contoh (gambar statis cabang yang biasanya diunggah dari dasbor kantor). Kolom qrisImageUrl maks. 500 karakter.
const QRIS =
  'data:image/svg+xml,' +
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -1 23 23'><rect x='-1' y='-1' width='23' height='23' fill='white'/>" +
  "<path d='M0 0h7v7H0zm1 1v5h5V1zm1 1h3v3H2zM14 0h7v7h-7zm1 1v5h5V1zm1 1h3v3h-3zM0 14h7v7H0zm1 1v5h5v-5zm1 1h3v3H2zM9 0h2v3H9zm0 5h3v2H9zm-1 4h4v2H8zm5 0h3v3h-3zm4 1h4v2h-4zM9 13h2v4H9zm3 2h3v2h-3zm4-2h5v2h-5zm1 4h4v4h-4zm-4 2h3v2h-3z'/></svg>";

const sheet = (page) => page.locator('.sheet.in').last();
const toastIs = (page, text, timeout = 15000) => page.waitForSelector(`#toast.in:has-text("${text}")`, { timeout });
/** Halaman penuh: viewport sementara diperpanjang setinggi isi, supaya header & tombol bawah (fixed) tetap di tempatnya. */
async function shot(page, name, full = false) {
  if (!full) return page.screenshot({ path: `${SHOTS}/${name}` });
  const vp = page.viewportSize();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, h) });
  await wait(300);
  await page.screenshot({ path: `${SHOTS}/${name}` });
  await page.setViewportSize(vp);
  await wait(200);
}
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await wait(400);
}

/** Buka detail menu, pilih opsi (bila ada), tambah ke keranjang. */
async function addItem(page, name, opts = []) {
  await page.locator('.item', { has: page.locator('h3', { hasText: new RegExp(`^${name}(\\s*★)?$`) }) }).first().click();
  const s = sheet(page);
  await s.locator('.sheet-foot .btn.grow').waitFor();
  for (const o of opts) await s.locator('.opt, .chip', { hasText: o }).first().click();
  return s;
}
async function confirmAdd(page) {
  await sheet(page).locator('.sheet-foot .btn.grow').click();
  await page.waitForSelector('.sheet.in', { state: 'detached', timeout: 5000 }).catch(() => {});
  await wait(500);
}
const TAB_HREF = { Beranda: '/', Menu: '/menu/', Reservasi: '/reservasi/', Pesanan: '/pesanan/', Akun: '/akun/' };
/** Pindah tab lewat tab bar; layar tanpa tab bar (status, keranjang) → buka alamatnya langsung. */
async function goTab(page, label) {
  const a = page.locator('.tabbar a', { hasText: label });
  if (await a.isVisible()) await a.click();
  else await page.goto(`${PWA}${TAB_HREF[label]}`);
  await settle(page);
}
async function payWith(page, name) {
  await page.locator('.card', { has: page.locator('h3', { hasText: 'Metode pembayaran' }) }).locator('.pay', { hasText: name }).first().click();
}
const orderIdOf = (url) => new URL(url).searchParams.get('id');

// --- Kasir (POS React) -----------------------------------------------------------------
async function posLogin(pos) {
  const resumed = sql(`select count(*) from "Shift" s join "Device" d on d.id=s."deviceId" join "Branch" b on b.id=d."branchId" where b.code='${BRANCH}' and d."terminalNo"=2 and s.status='OPEN'`) !== '0';
  const out = execFileSync('node', [`${WT}/apps/api/dist/cli/pair.js`, '--branch', BRANCH, '--terminal', '2', '--name', 'Kasir 2'], {
    env: { ...process.env, DATABASE_URL: DB },
  }).toString();
  const code = out.match(/Kode pasang: (\d{6})/)[1];
  await pos.goto(POS);
  await pos.waitForSelector('#f-code');
  await pos.fill('#f-code', code);
  await pos.fill('#f-name', 'Kasir 2');
  await pos.click('[data-go="pair"]');
  await pos.waitForSelector('.staff-grid', { timeout: 20000 });
  await pos.click('.staff:has-text("Sari")');
  for (const d of '3333') await pos.click(`.split .keypad [data-k="${d}"]`);
  await pos.click('.split .keypad [data-k="ok"]').catch(() => {});
  if (!resumed) {
    await pos.waitForSelector('.modal:has-text("Buka shift")', { timeout: 15000 });
    await pos.click('.modal [data-q="300000"]');
    await pos.click('.modal [data-ok]');
  }
  await pos.waitForSelector('.prod', { timeout: 15000 });
}
async function posPayBill(pos, orderId, customer) {
  await pos.goto(POS.replace('?nosw', '?nosw#/tagihan'));
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    seen = (await pos.locator(`text=${customer}`).count()) > 0;
    if (!seen) {
      await wait(1000);
      if (i % 10 === 9) await pos.reload();
    }
  }
  if (!seen) throw new Error(`pesanan ${customer} tidak muncul di tagihan kasir`);
  await pos.goto(POS.replace('?nosw', `?nosw#/kasir?bill=${orderId}`));
  await pos.waitForSelector('.cart-lines [data-line]');
  await pos.click('[data-a="pay"]');
  const m = pos.locator('.modal').last();
  await m.locator('[data-pm="qris"]').click();
  if (await m.locator('#pay-ref').count()) await m.locator('#pay-ref').fill('QRIS-E2E-001');
  await m.locator('[data-finish]').click();
  await pos.waitForSelector('.modal:has-text("Pembayaran berhasil")');
  await pos.click('.modal [data-new]');
}
async function posBump(pos, orderId) {
  await pos.goto(POS.replace('?nosw', '?nosw#/dapur'));
  const btn = pos.locator(`[data-bump="${orderId}"]`);
  for (let i = 0; i < 30 && !(await btn.count()); i++) {
    await wait(1000);
    if (i % 10 === 9) await pos.reload();
  }
  await btn.click();
}

/** Server statis hasil ekspor (out/); dimatikan di uji offline. */
async function startPwaServer() {
  if (await fetch(`${PWA}/`).then(() => true, () => false)) throw new Error(`port ${PWA_PORT} sudah dipakai; matikan server PWA lain dulu`);
  const srv = spawn(process.execPath, [`${WT}/apps/pwa/scripts/serve.mjs`, PWA_PORT], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${PWA}/`).then(() => true, () => false)) return srv;
    await wait(100);
  }
  srv.kill();
  throw new Error('server PWA tidak menyala (sudah build?)');
}

(async () => {
  const srv = await startPwaServer();
  process.on('exit', () => srv.kill());
  const orig = sql(`select coalesce("openTime",'')||'|'||coalesce("closeTime",'')||'|'||coalesce("qrisImageUrl",'') from "Branch" where code='${BRANCH}'`).split('|');
  const bid = sql(`select id from "Branch" where code='${BRANCH}'`);
  const croissant = sql(`select id from "Product" where name='Almond Croissant'`);
  const pbBefore = sql(`select "isAvailable" from "ProductBranch" where "productId"='${croissant}' and "branchId"='${bid}'`);
  sql(`update "Branch" set "openTime"='00:00', "closeTime"='23:59', "qrisImageUrl"='${esc(QRIS)}' where code='${BRANCH}'`);
  sql(`insert into "ProductBranch" ("productId","branchId","isAvailable","updatedAt") values ('${croissant}','${bid}',false,now())
       on conflict ("productId","branchId") do update set "isAvailable"=false, "updatedAt"=now()`);
  const restore = () => {
    sql(`update "Branch" set "openTime"=${orig[0] ? `'${orig[0]}'` : 'null'}, "closeTime"=${orig[1] ? `'${orig[1]}'` : 'null'}, "qrisImageUrl"=${orig[2] ? `'${esc(orig[2])}'` : 'null'} where code='${BRANCH}'`);
    if (pbBefore) sql(`update "ProductBranch" set "isAvailable"=${pbBefore === 't'} where "productId"='${croissant}' and "branchId"='${bid}'`);
    else sql(`delete from "ProductBranch" where "productId"='${croissant}' and "branchId"='${bid}'`);
  };

  const browser = await chromium.launch();
  const errs = [];
  let offline = false;
  const pages = [];
  const watch = (p, tag) => {
    pages.push([tag, p]);
    p.on('pageerror', (e) => errs.push(`${tag} pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() !== 'error' || /Failed to load resource: the server responded with a status of (401|404|409)/.test(m.text())) return;
      if (offline && /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) return;
      errs.push(`${tag} console: ${m.text()}`);
    });
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
    const page = await ctx.newPage();
    watch(page, 'pwa');
    const posCtx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const pos = await posCtx.newPage();
    watch(pos, 'pos');

    // 1. Kunjungan pertama: pilih cabang, beranda, menu
    await page.goto(`${PWA}/`);
    await page.waitForSelector('.sheet.in:has-text("Pilih cabang")', { timeout: 15000 });
    await shot(page, '01-pilih-cabang.png');
    await sheet(page).locator('.pay', { hasText: 'Ijen Nirwana' }).click();
    await page.waitForSelector('.store-card:has-text("Ijen Nirwana")');
    await settle(page);
    await shot(page, '02-beranda.png');
    log('beranda: cabang Ijen Nirwana dipilih');

    await goTab(page, 'Menu');
    await page.waitForSelector('.item');
    await shot(page, '03-menu.png');

    // 2. Pick Up, bayar di kasir
    await addItem(page, 'Caffe Latte', ['Iced · Regular']);
    await shot(page, '04-detail-menu.png');
    await confirmAdd(page);
    await page.waitForSelector('#cartbar:not([hidden])');
    await page.click('#cartbar');
    await page.waitForURL(/\/checkout\/$/);
    await page.fill('#f-name', 'Budi Uji');
    await page.fill('#f-phone', PHONE);
    await payWith(page, 'Bayar di Kasir');
    await settle(page);
    await shot(page, '05-keranjang-pickup.png', true);
    await page.locator('.paybar .btn', { hasText: 'Pesan Sekarang' }).click();
    await page.waitForURL(/\/pesanan\/status\/\?id=/, { timeout: 20000 });
    const o1 = orderIdOf(page.url());
    await page.waitForSelector('#st-title');
    await settle(page);
    await shot(page, '06-status-bayar-di-kasir.png');
    const st1 = sql(`select status||'|'||"customerName"||'|'||coalesce("sentToKitchenAt"::text,'-') from "Order" o join "OrderItem" i on i."orderId"=o.id where o.id='${o1}' limit 1`);
    if (!st1.startsWith('OPEN|Budi Uji|') || st1.endsWith('|-')) throw new Error('pesanan bayar di kasir: ' + st1);
    log('pick up + bayar di kasir → OPEN, tiket dapur langsung', o1);

    // 3. Bayar QRIS → menunggu kasir → kasir konfirmasi → status langsung berubah (SSE)
    await goTab(page, 'Menu');
    await addItem(page, 'Americano');
    await confirmAdd(page);
    await page.click('#cartbar');
    await page.waitForURL(/\/checkout\/$/);
    await payWith(page, 'QRIS');
    await page.locator('.paybar .btn', { hasText: 'Pesan & Bayar' }).click();
    await page.waitForURL(/\/pesanan\/status\/\?id=/, { timeout: 20000 });
    const o2 = orderIdOf(page.url());
    await page.waitForSelector('.sheet.in .qris-img', { timeout: 10000 });
    await wait(600);
    await shot(page, '07-bayar-qris.png');
    if (await sheet(page).locator('button', { hasText: 'Saya sudah bayar' }).count()) throw new Error('tombol tandai lunas sendiri muncul');
    const pend = sql(`select status||'|'||coalesce((select count(*)::text from "OrderItem" where "orderId"=o.id and "sentToKitchenAt" is not null),'0') from "Order" o where id='${o2}'`);
    if (pend !== 'OPEN|0') throw new Error('pesanan QRIS sebelum dibayar: ' + pend);
    log('QRIS: lembar bayar tampil (gambar QRIS cabang), menunggu kasir; belum ke dapur');

    await posLogin(pos);
    log('kasir 2 masuk');
    await posPayBill(pos, o2, 'Budi Uji');
    await toastIs(page, 'Pembayaran diterima kasir', 30000);
    await page.waitForSelector('.sheet.in .qris-img', { state: 'detached', timeout: 5000 }).catch(() => {});
    await settle(page);
    await shot(page, '08-pembayaran-diterima.png');
    log('kasir mengonfirmasi QRIS → status di aplikasi berubah sendiri');

    await posBump(pos, o2);
    await page.waitForSelector('#st-title:has-text("Siap")', { timeout: 30000 });
    await settle(page);
    await shot(page, '09-siap-diambil.png');
    await page.locator('button', { hasText: /Pesanan sudah (diambil|diterima)/ }).click();
    await page.waitForSelector('#st-title:has-text("Selesai")', { timeout: 15000 });
    log('dapur selesai → "Siap diambil" → pelanggan tandai diambil → Selesai');

    // 4. Masuk dengan WhatsApp (OTP)
    await goTab(page, 'Akun');
    await page.waitForSelector('.acc-head');
    await shot(page, '10-akun-tamu.png', true);
    await page.locator('.ml', { hasText: 'Masuk dengan WhatsApp' }).click();
    await sheet(page).locator('input[type="tel"]').fill(PHONE);
    await sheet(page).locator('button', { hasText: 'Kirim kode' }).click();
    const dev = await page.waitForSelector('.otp-dev', { timeout: 15000 });
    const code = (await dev.innerText()).match(/(\d{6})/)[1];
    await shot(page, '11-kode-otp.png');
    await sheet(page).locator('.otp-input').fill(code);
    await toastIs(page, 'Berhasil masuk');
    await page.waitForSelector('.ml:has-text("Keluar")');
    log('masuk dengan WhatsApp (OTP)');

    // 5. Delivery: alamat dari titik Google Maps, ongkir dari jarak, bayar online
    await goTab(page, 'Menu');
    await page.locator('.seg button', { hasText: 'Delivery' }).first().click();
    await addItem(page, 'Caffe Latte', ['Hot']);
    await confirmAdd(page);
    await page.click('#cartbar');
    await page.waitForURL(/\/checkout\/$/);
    await page.locator('.paybar .btn').click(); // belum ada alamat → lembar alamat
    await page.waitForSelector('#f-addr');
    await page.fill('#f-addr', '-7.9420837, 112.6220393');
    await page.waitForSelector('.addr-km');
    await page.fill('#f-addr', 'Jl. Soekarno Hatta No. 27, Jatimulyo, Lowokwaru, Kota Malang');
    await sheet(page).locator('input[placeholder^="No. rumah"]').fill('Ruko lantai 2');
    await shot(page, '12-alamat-delivery.png');
    await sheet(page).locator('button', { hasText: 'Simpan alamat' }).click();
    await page.waitForSelector('.sheet.in', { state: 'detached', timeout: 5000 }).catch(() => {});
    await payWith(page, 'QRIS');
    await settle(page);
    await shot(page, '13-keranjang-delivery.png', true);
    await page.locator('.paybar .btn', { hasText: 'Pesan & Bayar' }).click();
    await page.waitForURL(/\/pesanan\/status\/\?id=/, { timeout: 20000 });
    const o3 = orderIdOf(page.url());
    await page.waitForSelector('.sheet.in .qris-img', { timeout: 10000 });
    if (await sheet(page).locator('button', { hasText: 'Bayar di kasir saja' }).count()) throw new Error('delivery menawarkan bayar di kasir');
    await page.keyboard.press('Escape');
    await settle(page);
    await shot(page, '14-status-delivery.png', true);
    const dl = sql(`select d.fee||'|'||d."distanceKm"||'|'||o."deliveryFee"||'|'||(o."customerId" is not null) from "Order" o join "Delivery" d on d."orderId"=o.id where o.id='${o3}'`);
    log('delivery: ongkir|km|ongkir pesanan|milik akun =', dl);
    if (!/^\d+\|[\d.]+\|\d+\|true$/.test(dl)) throw new Error('data delivery: ' + dl);

    // 6. Alamat tersimpan di akun (tersimpan otomatis saat delivery), lalu hapus
    await goTab(page, 'Akun');
    await page.locator('.ml', { hasText: 'Alamat tersimpan' }).click();
    await page.waitForSelector('.sheet.in .saved-addr');
    await shot(page, '15-alamat-tersimpan.png');
    await sheet(page).locator('.saved-addr .icon-btn').first().click();
    await sheet(page).locator('button', { hasText: 'Hapus' }).click();
    await toastIs(page, 'Alamat dihapus');
    await page.keyboard.press('Escape');
    log('alamat tersimpan tampil & bisa dihapus');

    // 7. Reservasi meja + pre-order + batal
    await goTab(page, 'Reservasi');
    await page.locator('#dates .date', { hasText: 'Besok' }).click();
    await page.locator('.slots .chip:not([disabled])', { hasText: /^1[2-4]\./ }).first().click();
    await page.locator('button[aria-label="Tambah tamu"]').click();
    await page.locator('.area', { hasText: 'Indoor' }).click();
    await page.locator('.occ .chip', { hasText: 'Keluarga' }).click();
    await shot(page, '16-reservasi.png', true);
    await page.locator('.paybar .btn', { hasText: 'Lanjut' }).click();
    await page.waitForSelector('.sheet.in:has-text("Konfirmasi Reservasi")');
    await shot(page, '17-konfirmasi-reservasi.png');
    await sheet(page).locator('button', { hasText: 'Konfirmasi Reservasi' }).click();
    await page.waitForURL(/\/reservasi\/tiket\/\?id=/, { timeout: 20000 });
    const ticketUrl = page.url();
    await page.waitForSelector('.ticket .tk-code b');
    await settle(page);
    await shot(page, '18-tiket-reservasi.png', true);
    const rsvCode = await page.locator('.ticket .tk-code b').innerText();
    log('reservasi', rsvCode);

    await page.locator('button', { hasText: 'Pre-order' }).click();
    await page.waitForURL(/\/menu\/$/);
    await addItem(page, 'Almond Croissant').catch(() => {});
    // Almond Croissant ditandai habis untuk uji menu baca-saja: tidak bisa ditambah.
    if (await sheet(page).locator('button', { hasText: 'Sedang habis' }).count()) {
      await page.keyboard.press('Escape');
      await wait(400);
    } else throw new Error('menu habis masih bisa ditambah');
    await addItem(page, 'Kopi Susu Essentials');
    await confirmAdd(page);
    await page.click('#cartbar');
    await page.waitForURL(/\/checkout\/$/);
    await page.waitForSelector(`text=${rsvCode}`);
    await payWith(page, 'Bayar di Kasir');
    await shot(page, '19-keranjang-preorder.png', true);
    await page.locator('.paybar .btn', { hasText: 'Pesan Sekarang' }).click();
    await page.waitForURL(/\/pesanan\/status\/\?id=/, { timeout: 20000 });
    const o4 = orderIdOf(page.url());
    await page.goto(ticketUrl);
    await page.waitForSelector('.live:has-text("Pre-order")');
    await shot(page, '20-tiket-dengan-preorder.png', true);
    await page.locator('button', { hasText: 'Batalkan reservasi' }).click();
    await sheet(page).locator('button', { hasText: 'Ya, batalkan' }).click();
    await toastIs(page, 'Reservasi dibatalkan');
    await page.waitForSelector('.ticket .tag:has-text("Dibatalkan")');
    const rs = sql(`select r.status||'|'||o.status from "Reservation" r join "Order" o on o."reservationId"=r.id where o.id='${o4}'`);
    if (rs !== 'CANCELLED|VOIDED') throw new Error('batal reservasi: ' + rs);
    log('pre-order tercatat; batal reservasi → pre-order belum bayar ikut batal');

    // 8. Aktivitas + pesan lagi
    await goTab(page, 'Pesanan');
    await page.waitForSelector('.oc');
    await settle(page);
    await shot(page, '21-aktivitas.png', true);
    await page.locator('.oc', { hasText: 'Selesai' }).first().locator('[role="button"]', { hasText: 'Pesan lagi' }).click();
    await page.waitForURL(/\/checkout\/$/);
    await toastIs(page, 'ditambahkan ke keranjang');
    await settle(page);
    await shot(page, '22-pesan-lagi.png');
    await page.locator('button[aria-label="Kosongkan keranjang"]').click();
    await sheet(page).locator('button', { hasText: /^Kosongkan$|Hapus|Ya/ }).last().click();
    log('pesan lagi → keranjang terisi ulang');
    await page.goto(`${PWA}/pesanan/?tab=rsv`);
    await page.waitForSelector('.oc');
    await shot(page, '23-aktivitas-reservasi.png');

    // 9. Tautan lama prototipe (#/…) diarahkan ke alamat baru
    await page.goto(`${PWA}/#/pesanan?tab=rsv`);
    await page.waitForURL(/\/pesanan\/\?tab=rsv$/, { timeout: 10000 });
    log('tautan lama #/pesanan?tab=rsv → /pesanan/?tab=rsv');

    // 10. Menu baca-saja (QR di meja)
    const ro = await ctx.newPage();
    watch(ro, 'daftar-menu');
    await ro.goto(`${PWA}/daftar-menu/`);
    await ro.waitForSelector('.picks a');
    await shot(ro, '24-daftar-menu-pilih-cabang.png');
    await ro.locator('.picks a', { hasText: 'Ijen Nirwana' }).click();
    await ro.waitForSelector('.grp');
    await settle(ro);
    await shot(ro, '25-daftar-menu.png');
    await ro.locator('.tab', { hasText: 'Pastry' }).click();
    await wait(1500);
    const habis = await ro.locator('.item.out', { hasText: 'Almond Croissant' }).locator('.habis').innerText();
    if (!/Habis/i.test(habis)) throw new Error('tanda habis tidak tampil');
    await shot(ro, '26-daftar-menu-habis.png');
    await ro.click('button[aria-label="Cari menu"]');
    await ro.fill('#q', 'latte');
    await ro.waitForSelector('#results .item');
    const found = await ro.locator('#results [role="status"]').first().innerText();
    await shot(ro, '27-daftar-menu-cari.png');
    log('menu baca-saja: pilih cabang, kelompok, tanda Habis, cari →', found);
    await ro.close();

    // 11. Offline sungguhan: server PWA dimatikan + jaringan halaman diputus (API ikut tak terjangkau).
    //     Halaman tab tersimpan service worker saat dipasang, jadi tetap terbuka walau belum pernah dibuka penuh.
    await page.goto(`${PWA}/`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    offline = true;
    srv.kill();
    for (let i = 0; i < 30 && (await fetch(`${PWA}/`).then(() => true, () => false)); i++) await wait(100);
    await ctx.setOffline(true);
    try {
      await page.goto(`${PWA}/menu/`);
      await page.waitForSelector('.item', { timeout: 8000 });
      await page.locator('.tabbar a', { hasText: 'Pesanan' }).click();
      await page.waitForSelector('h1:has-text("Aktivitas")', { timeout: 8000 });
      await page.goto(`${PWA}/reservasi/`);
      await page.waitForSelector('h1:has-text("Reservasi")', { timeout: 8000 });
      await page.goto(`${PWA}/halaman-tidak-ada/`);
      const off = await page.locator('h1').first().innerText();
      if (!/offline/i.test(off)) throw new Error(`halaman offline tidak tampil: ${off}`);
      await shot(page, '28-offline.png');
      log('offline: menu, tab Pesanan & Reservasi tetap terbuka; alamat lain →', JSON.stringify(off));
    } finally {
      await ctx.setOffline(false);
    }

    if (errs.length) {
      console.log('\nGalat di browser:\n' + errs.map((e) => '  ' + e).join('\n'));
      process.exitCode = 1;
    } else log('tanpa galat di browser');
  } catch (e) {
    // Tangkapan layar saat gagal (untuk menelusuri), lalu teruskan galatnya.
    for (const [tag, p] of pages) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}/zz-gagal-${tag}.png` }).catch(() => {});
    if (errs.length) console.log('\nGalat di browser:\n' + errs.map((x) => '  ' + x).join('\n'));
    throw e;
  } finally {
    restore();
    await browser.close();
  }
})().catch((e) => {
  console.error('GAGAL:', e);
  process.exit(1);
});
