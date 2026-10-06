/* =========================================================
   Tes ujung-ke-ujung di browser (Playwright + Chromium):
   1) Mode demo  : buka shift, jual dengan opsi, bayar tunai, simpan tagihan,
                   dapur, void dengan PIN manajer, tutup shift.
   2) Mode server: komputer kantor & kasir dipasangkan ke server pusat,
                   transaksi kasir sampai ke laporan kantor.
   Butuh paket playwright:  npm i -D playwright && npx playwright install chromium
   Jalankan:                npm run test:e2e
   ========================================================= */
import http from 'node:http';
import assert from 'node:assert/strict';
import { serveStatic } from '../../server/static.js';
import { ROOT } from '../../server/data-loader.js';
import { Store } from '../../server/store.js';
import { createApp, bootstrap } from '../../server/server.js';

let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) {
  try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs')); } catch (x) {
    console.error('Playwright belum terpasang. Jalankan: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const listen = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;
const results = [];
const SHOTS = process.env.E2E_SHOTS || '';
let current = null; // halaman aktif untuk tangkapan layar saat gagal
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log(`  ✓ ${name}`); } catch (e) {
    results.push([false, name, e]); console.log(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 3).join('\n    ')}`);
    if (SHOTS && current) await current.screenshot({ path: `${SHOTS}/gagal-${results.length}.png` }).catch(() => {});
    throw e;
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function newPage(name, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  current = page;
  return { ctx, page };
}
async function pin(page, staffId, digits) {
  await page.click(`[data-staff="${staffId}"]`);
  for (const d of digits) await page.click(`[data-k="${d}"]`);
  await page.click('[data-k="ok"]');
}
/** Dialog persetujuan manajer: pilih penyetuju lalu PIN */
async function approve(page, staffId, digits) {
  await page.click(`.modal [data-s="${staffId}"]`);
  for (const d of digits) await page.click(`.modal [data-k="${d}"]`);
  await page.click('.modal [data-k="ok"]');
}

/* ---------- 1) Mode demo (situs statis, tanpa server) ---------- */
const stat = await listen((req, res) => { const u = new URL(req.url, 'http://x'); if (!serveStatic(ROOT, req, res, u.pathname)) { res.writeHead(404); res.end(); } });
console.log('Mode demo');
try {
  const { page } = await newPage('demo');
  const base = `${url(stat)}/pos/`;
  await step('penyiapan demo & login kasir', async () => {
    await page.goto(base);
    await page.click('[data-go="demo"]');
    await page.waitForSelector('.staff', { timeout: 60000 });
    await pin(page, 'st-ijn-k1', '3333');
    await page.waitForSelector('.modal [data-q="500000"]');
  });
  await step('buka shift dengan kas awal Rp500.000', async () => {
    await page.click('.modal [data-q="500000"]');
    await page.click('.modal [data-ok]');
    await page.waitForFunction(() => document.querySelector('#s-shift').textContent.includes('Shift'));
  });
  await step('pesanan dengan opsi & harga Large', async () => {
    await page.click('[data-item="caffe-latte"]');
    await page.click('.modal [data-c="Iced · Large"]');
    await page.click('.modal [data-ok]');
    await page.click('[data-item="shoyu-ramen"]');
    await page.fill('[data-f="table"]', '4');
    const total = await page.textContent('.pay-btn');
    assert.match(total, /Rp58\.000/); // 23.000 + 35.000
  });
  await step('bayar tunai Rp100.000 → kembalian Rp42.000', async () => {
    await page.click('[data-a="pay"]');
    await page.click('[data-quick="100000"]');
    await page.click('[data-finish]');
    await page.waitForSelector('.done-box');
    assert.match(await page.textContent('.done-box'), /Rp42\.000/);
    assert.match(await page.textContent('.done-box'), /IJN1-\d{6}-0001/);
    await page.click('.modal [data-close]');
  });
  await step('simpan tagihan terbuka (take away)', async () => {
    await page.click('[data-item="gyu-don"]');
    await page.click('[data-ch="takeaway"]');
    await page.fill('[data-f="name"]', 'Rani');
    await page.click('[data-a="hold"]');
    await page.waitForFunction(() => document.querySelector('[data-badge="bills"]') && document.querySelector('[data-badge="bills"]').textContent === '1');
  });
  await step('dapur menerima 2 tiket lalu menandai selesai', async () => {
    await page.goto(`${base}#/dapur`);
    await page.waitForSelector('.ticket');
    assert.equal((await page.$$('.ticket')).length, 2);
    await page.click('.ticket [data-bump]');
    await page.waitForFunction(() => document.querySelectorAll('.ticket').length === 1);
  });
  await step('void tagihan dengan PIN manajer', async () => {
    await page.goto(`${base}#/riwayat`);
    await page.waitForSelector('.li');
    await page.click('.li:has-text("Belum dibayar")');
    await page.click('[data-od="void"]');
    await approve(page, 'st-ijn-m', '2222');
    await page.fill('.modal [data-in]', 'Pelanggan batal');
    await page.click('.modal [data-ok]');
    await page.waitForSelector('.li:has-text("Dibatalkan")');
  });
  await step('tutup shift: kas seharusnya Rp558.000, selisih 0', async () => {
    await page.goto(`${base}#/shift`);
    await page.waitForSelector('[data-a="close"]');
    assert.match(await page.textContent('.kpis'), /Rp558\.000/);
    await page.click('[data-a="close"]');
    await page.click('.modal [data-mode="direct"]');
    for (const d of ['5', '5', '8', '000']) await page.click(`.modal [data-np="${d}"]`);
    assert.match(await page.textContent('.modal'), /Kas cocok|Rp0/);
    await page.click('.modal [data-ok]');
    await page.waitForSelector('.done-box');
    assert.match(await page.textContent('.done-box'), /Kas cocok/);
  });
  await step('dasbor kantor (pemilik) memuat data contoh', async () => {
    await page.click('.modal [data-close]');
    await page.waitForSelector('.staff');
    await pin(page, 'st-owner', '1111');
    await page.waitForSelector('.rail');
    await page.goto(`${base}#/kantor/dasbor`);
    await page.waitForSelector('[data-preset="30d"]');
    await page.click('[data-preset="30d"]');
    await page.waitForFunction(() => document.querySelectorAll('#c-trend .bar').length >= 28, null, { timeout: 30000 });
    assert.match(await page.textContent('.kpi.hero .k-value'), /Rp[\d.]{9,}/);
  });
} catch (e) { /* dicatat di results */ }

/* ---------- 2) Mode server ---------- */
console.log('Mode server');
const store = new Store(':memory:');
const boot = await bootstrap(store, { demo: true, log: () => {} });
const app = createApp({ store, log: () => {} });
const srv = await listen(app.handler);
try {
  const base = `${url(srv)}/pos/`;
  const hq = await newPage('kantor', { viewport: { width: 1366, height: 860 } });
  let kasirCode;
  await step('komputer kantor dipasangkan & pemilik membuat kode kasir', async () => {
    await hq.page.goto(base);
    await hq.page.waitForSelector('#f-code');
    await hq.page.fill('#f-code', boot.code);
    await hq.page.click('[data-go="pair"]');
    await hq.page.waitForSelector('.staff');
    await pin(hq.page, 'st-owner', '1111');
    await hq.page.waitForSelector('.rail');
    await hq.page.goto(`${base}#/kantor/perangkat`);
    await hq.page.click('[data-new]');
    await hq.page.selectOption('#d-b', 'br-ijn');
    await hq.page.click('.modal [data-ok]');
    await hq.page.waitForSelector('.code-box');
    kasirCode = (await hq.page.textContent('.code-box')).trim();
    assert.match(kasirCode, /^\d{6}$/);
  });
  const kasir = await newPage('kasir');
  await step('perangkat kasir dipasangkan, berjualan, transaksi tersinkron', async () => {
    await kasir.page.goto(base);
    await kasir.page.waitForSelector('#f-code');
    await kasir.page.fill('#f-code', kasirCode);
    await kasir.page.click('[data-go="pair"]');
    await kasir.page.waitForSelector('.staff');
    await pin(kasir.page, 'st-ijn-k1', '3333');
    await kasir.page.waitForSelector('.modal [data-q="0"]');
    await kasir.page.click('.modal [data-q="0"]');
    await kasir.page.click('.modal [data-ok]');
    await kasir.page.click('[data-item="shoyu-ramen"]');
    await kasir.page.click('[data-a="pay"]');
    await kasir.page.click('[data-pm="qris"]');
    await kasir.page.click('[data-finish]');
    await kasir.page.waitForSelector('.done-box');
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const n = store.ordersRange(['br-ijn'], '0000-01-01', '9999-12-31').filter((o) => o.number && o.number.startsWith('IJN1-')).length;
      if (n === 1) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('Transaksi kasir tidak sampai ke server');
  });
  await step('transaksi kasir tampil di Kantor › Transaksi', async () => {
    await hq.page.goto(`${base}#/kantor/transaksi`);
    await hq.page.click('[data-preset="today"]');
    await hq.page.waitForSelector('tr[data-id]:has-text("IJN1-")', { timeout: 10000 });
  });
} catch (e) { /* dicatat */ }

await browser.close();
app.close(); srv.close(); stat.close(); store.close();
const failed = results.filter((r) => !r[0]);
if (errors.length) console.log(`\nError halaman:\n${errors.join('\n')}`);
console.log(`\n${results.length - failed.length}/${results.length} langkah lulus`);
process.exit(failed.length || errors.length ? 1 : 0);
