/* E2E modul Kantor (mode server). Bukan bagian `pnpm test`; jalankan manual dengan lingkungan yang sama seperti pos-e2e.cjs:
     API + DB khusus (SEED_DEMO=1), `vite preview` dengan API_PROXY_TARGET, lalu
     E2E_DB=postgresql://… E2E_API_PORT=3310 E2E_POS_PORT=4310 node apps/pos/e2e/office-e2e.cjs
   Alur: pemilik (1111) → dasbor, transaksi, laporan + CSV, ubah harga cabang → terlihat di kasir, stok masuk & opname,
   karyawan baru → login sebagai karyawan itu, promo → dipakai di kasir; manajer Dewi (2222) → hanya cabangnya.
   Tangkapan layar → apps/pos/docs/screenshots/office. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || `${WT}/apps/pos/docs/screenshots/office`;
const API_PORT = process.env.E2E_API_PORT || '3310';
const ROOT = `http://localhost:${process.env.E2E_POS_PORT || '4310'}/?nosw`;
const DB = process.env.E2E_DB || 'postgresql://postgres@localhost:54329/robucca_posapp?host=/tmp';
fs.mkdirSync(SHOTS, { recursive: true });

const sql = (q) => execFileSync('psql', [DB.replace(/\?.*$/, ''), '-h', '/tmp', '-At', '-c', q]).toString().trim();
const log = (...a) => console.log('•', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const top = (page) => page.locator('.modal, .drawer').last();
const go = (page, hash) => page.goto(`${ROOT}#/${hash}`);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const RUN = Date.now().toString().slice(-5);

async function login(page, name, pin) {
  await go(page, 'masuk');
  await page.waitForSelector('.staff-grid');
  await page.locator('.staff', { hasText: name }).first().click();
  for (const d of pin) await page.click(`.keypad [data-k="${d}"]`);
  await page.click('.keypad [data-k="ok"]').catch(() => {});
  await page.waitForSelector('.staff-grid', { state: 'detached', timeout: 15000 });
  await wait(600);
}
/** Kasir: buka shift bila diminta (kas awal 300rb) atau tutup dialog bila hanya ke kantor. */
async function shiftGate(page, open) {
  const m = page.locator('.modal:has-text("Buka shift")');
  if (!(await m.count())) return;
  if (open) {
    await m.locator('[data-q="300000"]').click();
    await m.locator('[data-ok]').click();
  } else await page.keyboard.press('Escape');
  await wait(400);
}
async function logout(page) {
  await page.click('[data-act="user"]');
  await page.click('[data-u="logout"]');
  await page.waitForSelector('.staff-grid');
}
async function office(page, id, ready) {
  await go(page, `kantor/${id}`);
  await page.waitForSelector(`.subnav [data-page="${id}"].on`, { timeout: 15000 });
  if (ready) await page.waitForSelector(ready, { timeout: 15000 });
  await idle(page);
}
/** Tunggu sampai data kantor selesai dimuat (tanpa pemutar / konten redup). */
async function idle(page) {
  await wait(150);
  await page.waitForSelector('.office-main .spinner, .office-main .loading', { state: 'detached', timeout: 15000 }).catch(() => {});
}
async function prodPrice(page, name) {
  const card = page.locator('.prod', { has: page.locator('.pn', { hasText: new RegExp(`^${name}(\\s*★)?$`) }) }).first();
  return (await card.locator('.pp').innerText()).replace(/\D/g, '');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  global.__page = page;
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 0. Pasang perangkat terminal 2 cabang IJN
  const pairOut = execFileSync('node', [`${WT}/apps/api/dist/cli/pair.js`, '--branch', 'IJN', '--terminal', '2', '--name', `Kasir Kantor ${RUN}`], { env: { ...process.env, DATABASE_URL: DB } }).toString();
  const code = pairOut.match(/Kode pasang: (\d{6})/)[1];
  await page.goto(ROOT);
  await page.waitForSelector('#f-code');
  await page.fill('#f-code', code);
  await page.fill('#f-name', `Kasir Kantor ${RUN}`);
  await page.click('[data-go="pair"]');
  await page.waitForSelector('.staff-grid', { timeout: 20000 });
  log('perangkat terpasang (IJN T2)');

  // 1. Pemilik → dasbor
  await login(page, 'Pemilik', '1111');
  await shiftGate(page, false);
  await office(page, 'dasbor', '[data-kpi="total"]');
  await page.click('[data-preset="today"]');
  await idle(page);
  await page.waitForSelector('[data-top-items]', { timeout: 15000 });
  const kpi = (await page.locator('[data-kpi="total"]').innerText()).replace(/\s+/g, ' ');
  const branchOpts = await page.locator('.filters [data-branch] option').count();
  await shot(page, '01-dasbor-pemilik');
  log('dasbor pemilik:', kpi, '· pilihan cabang', branchOpts);
  if (branchOpts < 5) throw new Error('pemilik seharusnya melihat semua cabang + "Semua cabang"');

  // 2. Transaksi + detail, laporan + CSV, shift
  await office(page, 'transaksi', '#t-table');
  await shot(page, '02-transaksi');
  const firstTx = page.locator('#t-table tbody tr[data-id]').first();
  if (await firstTx.count()) {
    await firstTx.click();
    await page.waitForSelector('.drawer');
    await wait(600);
    await shot(page, '03-transaksi-detail');
    await page.keyboard.press('Escape');
  }
  await office(page, 'laporan', '#r-table');
  await page.click('[data-tab="menu"]');
  await idle(page);
  await shot(page, '04-laporan-item');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('[data-csv]')]);
  const csvPath = path.join(require('node:os').tmpdir(), `office-${RUN}.csv`);
  await dl.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  fs.rmSync(csvPath, { force: true });
  const csvLines = csvText.replace(/^﻿/, '').trim().split('\n');
  log('CSV', dl.suggestedFilename(), csvLines.length, 'baris; kepala:', csvLines[0].slice(0, 90));
  if (!csvText.startsWith('﻿') || !csvLines[0].includes(';')) throw new Error('CSV tidak berformat BOM + titik koma');
  await office(page, 'shift', '#s-table');
  await shot(page, '05-shift');

  // 3. Ubah harga cabang IJN untuk Kopi Susu Essentials
  await office(page, 'menu', '[data-row="kopi-susu-essentials"]');
  await page.fill('[data-q]', 'Kopi Susu Essentials');
  await page.locator('[data-row="kopi-susu-essentials"] [data-edit]').click();
  const dr = top(page);
  await dr.locator('[data-ovp="IJN"]').waitFor();
  const newPrice = 26000 + (Number(RUN) % 5) * 500;
  await dr.locator('[data-ovp="IJN"]').fill(String(newPrice));
  await dr.locator('[data-ovp="IJN"]').scrollIntoViewIfNeeded();
  await shot(page, '06-menu-harga-cabang');
  await dr.locator('[data-save]').click();
  await page.waitForSelector('.drawer', { state: 'detached' });
  await wait(800);
  const cell = (await page.locator('[data-row="kopi-susu-essentials"] [data-branch-price]').innerText()).replace(/\D/g, '');
  await shot(page, '07-menu-setelah-ubah');
  const dbPrice = sql(`select pbs."priceOverride" from "ProductBranch" pbs join "Product" p on p.id=pbs."productId" join "Branch" b on b.id=pbs."branchId" where p.slug='kopi-susu-essentials' and b.code='IJN'`);
  log('harga cabang IJN tersimpan:', dbPrice, '· sel tabel', cell);
  if (Number(dbPrice) !== newPrice) throw new Error('harga cabang tidak tersimpan');

  // 4. Stok: bahan baru → masuk 5000 g → opname 4200 g
  const sku = `SUSU-E2E-${RUN}`;
  await office(page, 'stok', '[data-a="new-item"]');
  await page.click('[data-a="new-item"]');
  await top(page).locator('#i-name').fill(`Susu uji ${RUN}`);
  await top(page).locator('#i-sku').fill(sku);
  await top(page).locator('#i-unit').selectOption('MILLILITER');
  await top(page).locator('[data-ok]').click();
  await page.waitForSelector(`[data-item="${sku}"]`);
  await page.locator(`[data-item="${sku}"] [data-op="in"]`).click();
  await top(page).locator('#op-q').fill('5000');
  await top(page).locator('#op-n').fill('kiriman uji');
  await shot(page, '08-stok-masuk');
  await top(page).locator('[data-ok]').click();
  await page.waitForFunction((s) => /5[.,]?000/.test(document.querySelector(`[data-item="${s}"] [data-qty]`)?.textContent || ''), sku, { timeout: 10000 });
  await page.locator(`[data-item="${sku}"] [data-op="opname"]`).click();
  await top(page).locator('#op-q').fill('4200');
  await top(page).locator('[data-ok]').click();
  await page.waitForFunction((s) => /4[.,]?200/.test(document.querySelector(`[data-item="${s}"] [data-qty]`)?.textContent || ''), sku, { timeout: 10000 });
  await wait(300);
  await shot(page, '09-stok-opname');
  const lvl = sql(`select l.quantity from "InventoryStock" l join "InventoryItem" i on i.id=l."inventoryItemId" join "Branch" b on b.id=l."branchId" where i.sku='${sku}' and b.code='IJN'`);
  const mv = sql(`select string_agg(m.type::text, ',' order by m."createdAt") from "StockMovement" m join "InventoryItem" i on i.id=m."inventoryItemId" where i.sku='${sku}'`);
  log('stok', sku, '=', lvl, '· mutasi', mv);
  if (Number(lvl) !== 4200) throw new Error('stok setelah opname bukan 4200: ' + lvl);

  // 5. Promo baru 10% semua cabang
  const promoName = `Uji Kantor ${RUN}`;
  await office(page, 'promo');
  await page.click('[data-new]');
  await top(page).locator('#p-name').fill(promoName);
  await top(page).locator('[data-t="PERCENT"]').click();
  await top(page).locator('#p-val').fill('10');
  if (!(await top(page).locator('#p-all').isChecked())) await top(page).locator('#p-all').check();
  await shot(page, '10-promo-baru');
  await top(page).locator('[data-ok]').click();
  await page.waitForSelector(`[data-promo="${promoName}"]`);
  await shot(page, '11-promo-daftar');
  log('promo dibuat', promoName);

  // 6. Karyawan baru (kasir IJN) dengan PIN acak yang belum dipakai
  const staffName = `Rina ${RUN}`;
  await office(page, 'karyawan', '#k-table');
  await page.click('[data-new]');
  const sd = top(page);
  await sd.locator('#s-name').fill(staffName);
  await sd.locator('#s-role').selectOption('CASHIER');
  const ijn = sd.locator('[data-b="IJN"]');
  if (!(await ijn.isChecked())) await ijn.check();
  let staffPin = '';
  for (let i = 0; i < 10 && !staffPin; i++) {
    const p = String(500000 + Math.floor(Math.random() * 499999));
    await sd.locator('#s-pin').fill(p);
    if (i === 0) { await wait(400); await shot(page, '12-karyawan-baru'); }
    await sd.locator('[data-save]').click();
    await wait(800);
    if (!(await page.locator('.drawer').count())) staffPin = p;
  }
  if (!staffPin) throw new Error('gagal membuat karyawan');
  await page.waitForSelector(`[data-staff-row="${staffName}"]`);
  await shot(page, '13-karyawan-daftar');
  log('karyawan dibuat', staffName);

  // 7. Log aktivitas & halaman lain
  await office(page, 'log', '#a-table');
  await shot(page, '14-log-aktivitas');
  await office(page, 'cabang', '#b-table');
  await shot(page, '15-cabang');
  await office(page, 'perangkat', '#dv-table');
  await shot(page, '16-perangkat');
  await office(page, 'pengaturan', '[data-save]');
  await shot(page, '17-pengaturan');

  // 8. Login sebagai karyawan baru → harga baru & promo di kasir
  await logout(page);
  // daftar staf di perangkat ikut master; tunggu karyawan baru muncul
  for (let i = 0; i < 20 && !(await page.locator('.staff', { hasText: staffName }).count()); i++) { await wait(1000); if (i % 5 === 4) await page.reload(); }
  await shot(page, '18-login-karyawan-baru');
  await login(page, staffName, staffPin);
  await shiftGate(page, true);
  await page.waitForSelector('.prod');
  await page.fill('#s-q', 'Kopi Susu Essentials');
  let shown = '';
  for (let i = 0; i < 20 && Number(shown) !== newPrice; i++) {
    shown = await prodPrice(page, 'Kopi Susu Essentials');
    if (Number(shown) !== newPrice) { await wait(1000); if (i % 5 === 4) { await page.reload(); await page.waitForSelector('.prod'); await page.fill('#s-q', 'Kopi Susu Essentials'); } }
  }
  log('kasir (', staffName, ') harga Kopi Susu Essentials =', shown);
  if (Number(shown) !== newPrice) throw new Error(`harga di kasir ${shown}, diharapkan ${newPrice}`);
  await page.locator('.prod', { has: page.locator('.pn', { hasText: /^Kopi Susu Essentials(\s*★)?$/ }) }).first().click();
  const opt = top(page);
  if (await opt.locator('[data-ok]').count()) await opt.locator('[data-ok]').click().catch(() => {});
  await page.waitForSelector('.cart-lines [data-line]');
  await page.click('[data-a="disc"]');
  await top(page).locator('.li', { hasText: promoName }).click();
  await wait(400);
  await shot(page, '19-kasir-harga-promo');
  await page.click('[data-a="pay"]');
  const pm = top(page);
  await pm.locator('[data-pm="cash"]').click();
  await pm.locator('[data-quick]').last().click();
  await pm.locator('[data-finish]').click();
  await page.waitForSelector('.modal:has-text("Pembayaran berhasil")');
  const num = (await page.locator('.done-box').innerText()).match(/[A-Z0-9]+-\d{6}-\d{4}/)[0];
  await page.click('.modal [data-new]');
  let row = '';
  for (let i = 0; i < 40 && !row; i++) {
    await wait(500);
    row = sql(`select o."discountTotal"||'|'||o.total||'|'||coalesce(p.name,'')||'|'||u.name from "Order" o left join "Promotion" p on p.id=o."promotionId" left join "User" u on u.id=o."cashierId" where o.number='${num}'`);
  }
  log('pesanan', num, 'di server: diskon|total|promo|kasir =', row);
  const [disc, , pname, cashier] = row.split('|');
  if (Number(disc) !== Math.round(newPrice * 0.1) || pname !== promoName || cashier !== staffName) throw new Error('diskon promo / kasir tidak sesuai: ' + row);

  // 9. Manajer Dewi: hanya cabang Ijen; karyawan hanya kasir/dapur
  await logout(page);
  await login(page, 'Dewi', '2222');
  await shiftGate(page, false);
  await office(page, 'dasbor', '[data-kpi="total"]');
  await page.waitForSelector('[data-top-items]', { timeout: 15000 });
  await wait(500);
  const dewiBranches = await page.locator('.filters [data-branch] option').count();
  const pages = await page.locator('.subnav [data-page]').evaluateAll((a) => a.map((x) => x.getAttribute('data-page')));
  await shot(page, '20-dasbor-manajer');
  log('Dewi: pilihan cabang', dewiBranches, '· halaman', pages.join(','));
  if (dewiBranches > 1) throw new Error('manajer melihat cabang lain');
  if (pages.includes('cabang') || pages.includes('pengaturan')) throw new Error('manajer melihat halaman pemilik');
  await office(page, 'karyawan', '#k-table');
  await page.click('[data-new]');
  const roles = await top(page).locator('#s-role option').allInnerTexts();
  await wait(500);
  await shot(page, '21-manajer-karyawan');
  await page.keyboard.press('Escape');
  log('Dewi boleh memberi peran:', roles.join(', '));
  if (roles.some((r) => /Pemilik|Manajer/i.test(r))) throw new Error('manajer bisa memberi peran manajer/pemilik');
  await office(page, 'stok', '[data-item]');
  await shot(page, '22-manajer-stok');

  const bad = errs.filter((e) => !/Failed to load resource|ERR_CONNECTION|502|503|504/.test(e));
  console.log('errors:', bad);
  await browser.close();
  if (bad.length) process.exit(1);
})().catch(async (e) => {
  console.error('GAGAL', e);
  await global.__page?.screenshot({ path: `${SHOTS}/gagal.png` }).catch(() => {});
  process.exit(1);
});
