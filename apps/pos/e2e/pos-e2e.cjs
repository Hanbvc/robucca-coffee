/* E2E POS React terhadap API (mode server) + mode demo. Bukan bagian `pnpm test`; jalankan manual:
     1. Postgres + DB khusus (bukan robucca_dev/robucca_test): migrate deploy, SEED_DEMO=1 seed
     2. API: PORT=3310 DATABASE_URL=… node apps/api/dist/main.js  (perintahnya di E2E_API_CMD, PID di E2E_API_PID; port lain: E2E_API_PORT/E2E_POS_PORT)
     3. POS: pnpm --filter @robucca/pos build && API_PROXY_TARGET=http://localhost:3310 npx vite preview --port 4310
     4. E2E_DB=postgresql://… E2E_API_CMD=/path/start-api.sh node apps/pos/e2e/pos-e2e.cjs
   Butuh paket playwright (PLAYWRIGHT_PATH) + Chromium (PLAYWRIGHT_BROWSERS_PATH). Tangkapan layar → apps/pos/docs/screenshots. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execSync, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WT = path.resolve(__dirname, '../../..');
const SP = process.env.E2E_TMP || require('node:os').tmpdir();
const SHOTS = process.env.SHOTS || `${WT}/apps/pos/docs/screenshots`;
const API_PORT = process.env.E2E_API_PORT || '3310';
const BASE = `http://localhost:${process.env.E2E_POS_PORT || '4310'}/?nosw`;
const DB = process.env.E2E_DB || 'postgresql://postgres@localhost:54329/robucca_posapp?host=/tmp';
fs.mkdirSync(SHOTS, { recursive: true });

const sql = (q) => execFileSync('psql', [DB.replace(/\?.*$/, ''), '-h', '/tmp', '-At', '-c', q]).toString().trim();
const log = (...a) => console.log('•', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function apiPid() {
  try { return Number(fs.readFileSync(process.env.E2E_API_PID || `${SP}/api.pid`, 'utf8')); } catch { return 0; }
}
function stopApi() {
  const pid = apiPid();
  try { process.kill(pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 40; i++) {
    try { execSync(`curl -sf localhost:${API_PORT}/health`, { stdio: 'ignore' }); } catch { return; }
    execSync('sleep 0.25');
  }
  throw new Error('API tidak berhenti');
}
async function startApi() {
  const out = fs.openSync(`${SP}/api.log`, 'a');
  const p = spawn(process.env.E2E_API_CMD || `${SP}/api.sh`, { detached: true, stdio: ['ignore', out, out] });
  p.unref();
  fs.writeFileSync(process.env.E2E_API_PID || `${SP}/api.pid`, String(p.pid));
  for (let i = 0; i < 60; i++) {
    try { execSync(`curl -sf localhost:${API_PORT}/health`, { stdio: 'ignore' }); return; } catch {}
    await wait(500);
  }
  throw new Error('API tidak menyala');
}

async function pin(page, digits) {
  for (const d of digits) await page.click(`.modal-bd:last-child .keypad [data-k="${d}"], .split .keypad [data-k="${d}"]`);
}
const top = (page) => page.locator('.modal').last();

async function sellLatte(page, optName) {
  await page.locator('.prod', { has: page.locator('.pn', { hasText: /^Caffe Latte$/ }) }).first().click();
  const m = top(page);
  await m.locator(`.opt[data-c="${optName}"]`).click();
  await m.locator('.opt[data-c="Less Sugar"]').click();
  await m.locator('[data-ok]').click();
  await page.waitForSelector('.cart-lines [data-line]');
}
async function payCash(page, shotName) {
  await page.click('[data-a="pay"]');
  const m = top(page);
  await m.locator('[data-pm="cash"]').click();
  await m.locator('[data-quick]').last().click();
  if (shotName) await page.screenshot({ path: `${SHOTS}/${shotName}` });
  await m.locator('[data-finish]').click();
  await page.waitForSelector('.modal:has-text("Pembayaran berhasil")');
  const txt = await page.locator('.done-box').innerText();
  return txt;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 1. Pasang perangkat
  const pairOut = execSync(`DATABASE_URL='${DB}' node ${WT}/apps/api/dist/cli/pair.js --branch IJN --terminal 1 --name "Kasir 1"`).toString();
  const code = pairOut.match(/Kode pasang: (\d{6})/)[1];
  log('kode pasang', code);
  await page.goto(BASE);
  await page.waitForSelector('#f-code');
  await page.fill('#f-code', code);
  await page.fill('#f-name', 'Kasir 1');
  await page.screenshot({ path: `${SHOTS}/01-pasang-perangkat.png` });
  await page.click('[data-go="pair"]');
  await page.waitForSelector('.staff-grid', { timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/02-login.png` });
  log('terpasang, layar login');

  // 2. Login Sari + buka shift
  await page.click('.staff:has-text("Sari")');
  await pin(page, '3333');
  await page.click('.split .keypad [data-k="ok"]').catch(() => {});
  await page.waitForSelector('.modal:has-text("Buka shift")', { timeout: 10000 });
  await page.click('.modal [data-q="300000"]');
  await page.click('.modal [data-ok]');
  await page.waitForSelector('.prod');
  log('login Sari & shift dibuka');

  // 3. Jual iced latte + opsi, tunai
  await page.locator('.prod', { has: page.locator('.pn', { hasText: /^Caffe Latte$/ }) }).first().click();
  await top(page).locator('.opt[data-c="Iced · Regular"]').click();
  await top(page).locator('.opt[data-c="Less Sugar"]').click();
  await page.screenshot({ path: `${SHOTS}/03-opsi-iced-latte.png` });
  await top(page).locator('[data-ok]').click();
  await page.waitForSelector('.cart-lines [data-line]');
  await page.screenshot({ path: `${SHOTS}/04-kasir-keranjang.png` });
  const done1 = await payCash(page, '05-pembayaran-tunai.png');
  await page.screenshot({ path: `${SHOTS}/06-pembayaran-berhasil.png` });
  const num1 = done1.match(/[A-Z0-9-]{10,}/)[0];
  log('terjual', num1, done1.replace(/\s+/g, ' '));
  await page.click('.modal [data-new]');

  // tunggu sinkron
  let st = '';
  for (let i = 0; i < 40 && !st; i++) { await wait(500); st = sql(`select status from "Order" where number = '${num1}'`); }
  if (st !== 'PAID') throw new Error(`pesanan ${num1} di server: '${st}'`);
  const mods = sql(`select string_agg(m."optionName", ',') from "OrderItemModifier" m join "OrderItem" i on i.id=m."orderItemId" join "Order" o on o.id=i."orderId" where o.number='${num1}'`);
  log('server: PAID, opsi =', mods);

  // 4. Riwayat & dapur
  await page.goto(BASE.replace('?nosw', '?nosw#/riwayat'));
  await page.waitForSelector(`[data-o]:has-text("${num1}")`);
  await page.click(`[data-o]:has-text("${num1}")`);
  await page.waitForSelector('#h-detail [data-od="void"]');
  await page.screenshot({ path: `${SHOTS}/07-riwayat.png` });
  await page.goto(BASE.replace('?nosw', '?nosw#/dapur'));
  await page.waitForSelector('.ticket');
  const tk = await page.locator('.ticket').first().innerText();
  if (!/Caffe Latte/.test(tk) || !/Iced/.test(tk)) throw new Error('tiket dapur tidak memuat iced latte: ' + tk);
  await page.screenshot({ path: `${SHOTS}/08-dapur.png` });
  log('muncul di riwayat & dapur');

  // 5. Void dengan persetujuan Dewi
  await page.goto(BASE.replace('?nosw', '?nosw#/riwayat'));
  await page.click(`[data-o]:has-text("${num1}")`);
  await page.click('#h-detail [data-od="void"]');
  const ap = top(page);
  await ap.locator('[data-s]:has-text("Dewi")').click().catch(() => {});
  await page.screenshot({ path: `${SHOTS}/09-persetujuan-manajer.png` });
  for (const d of '2222') await ap.locator(`.keypad [data-k="${d}"]`).click();
  await ap.locator('.keypad [data-k="ok"]').click().catch(() => {});
  await page.waitForSelector('.modal:has-text("Alasan void")');
  await top(page).locator('[data-p="Pelanggan batal"]').click();
  await top(page).locator('[data-ok]').click();
  await page.waitForSelector(`[data-o]:has-text("${num1}") .tag:has-text("Void")`, { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: `${SHOTS}/10-void.png` });
  st = '';
  for (let i = 0; i < 40 && st !== 'VOIDED'; i++) { await wait(500); st = sql(`select status from "Order" where number = '${num1}'`); }
  const voider = sql(`select s.name from "Order" o join "User" s on s.id=o."voidedById" where o.number='${num1}'`);
  if (st !== 'VOIDED') throw new Error('void tidak sampai ke server: ' + st);
  log('void di server, disetujui', voider);

  // 6. Offline → jual → online → outbox terkirim
  stopApi();
  log('API dihentikan');
  await page.goto(BASE.replace('?nosw', '?nosw#/kasir'));
  await page.waitForSelector('.prod');
  await page.locator('.prod', { has: page.locator('.pn', { hasText: /^Caffe Latte$/ }) }).first().click();
  await top(page).locator('.opt[data-c="Iced · Large"]').click();
  await top(page).locator('[data-ok]').click();
  const done2 = await payCash(page);
  const num2 = done2.match(/[A-Z0-9-]{10,}/)[0];
  await page.click('.modal [data-new]');
  await wait(1500);
  const pend = await page.locator('[data-pending]').innerText();
  await page.screenshot({ path: `${SHOTS}/11-offline-antre.png` });
  log('terjual offline', num2, 'indikator:', JSON.stringify(pend));
  if (sql(`select count(*) from "Order" where number='${num2}'`) !== '0') throw new Error('pesanan offline sudah di server?');
  await startApi();
  log('API menyala lagi');
  let ok2 = '';
  for (let i = 0; i < 90 && ok2 !== 'PAID'; i++) { await wait(500); ok2 = sql(`select status from "Order" where number='${num2}'`); }
  if (ok2 !== 'PAID') throw new Error('outbox tidak terkirim: ' + ok2);
  for (let i = 0; i < 30; i++) { if (!(await page.locator('[data-pending]').innerText())) break; await wait(500); }
  const pend2 = await page.locator('[data-pending]').innerText();
  await page.screenshot({ path: `${SHOTS}/12-online-tersinkron.png` });
  log('outbox terkirim; indikator sekarang', JSON.stringify(pend2));
  if (pend2) throw new Error('outbox masih ada: ' + pend2);


  // 6b. Pesanan aplikasi pelanggan (PWA, CLICK_COLLECT, OPEN, belum bayar) → tagihan, dapur, dibayar di kasir
  const pwaId = execSync('node -e "console.log(crypto.randomUUID())"').toString().trim();
  const pwaNo = `A-IJN-${Date.now().toString().slice(-6)}`;
  const bid = sql(`select id from "Branch" where code='IJN'`);
  const pid = sql(`select id from "Product" where name='Kopi Susu Essentials'`);
  sql(`insert into "Order" (id,"branchId",number,"queueNumber",source,type,status,"customerName","customerPhone","businessDate","pickupAt",subtotal,"taxTotal",total,"taxRateBp","taxInclusive","createdAt","updatedAt")
       values ('${pwaId}','${bid}','${pwaNo}','A01','PWA','CLICK_COLLECT','OPEN','Budi PWA','081234567890',(now() at time zone 'Asia/Jakarta')::date, now()+interval '20 min',24000,2182,24000,1000,true,now(),now())`);
  sql(`insert into "OrderItem" (id,"orderId","productId","productName",quantity,"unitPrice","lineTotal",station,"sentToKitchenAt")
       values (gen_random_uuid(),'${pwaId}','${pid}','Kopi Susu Essentials',1,24000,24000,'BAR',now())`);
  execSync(`curl -s -o /dev/null localhost:${API_PORT}/health`);
  log('pesanan PWA dibuat', pwaNo);
  await page.goto(BASE.replace('?nosw', '?nosw#/tagihan'));
  let seen = false;
  for (let i = 0; i < 60 && !seen; i++) {
    seen = (await page.locator(`text=Budi PWA`).count()) > 0;
    if (!seen) { await wait(1000); if (i % 10 === 9) await page.reload(); }
  }
  if (!seen) throw new Error('pesanan PWA tidak muncul di tagihan');
  await page.screenshot({ path: `${SHOTS}/12b-tagihan-pwa.png` });
  await page.goto(BASE.replace('?nosw', '?nosw#/dapur'));
  await page.waitForSelector('.ticket:has-text("Kopi Susu Essentials")');
  await page.screenshot({ path: `${SHOTS}/12c-dapur-pwa.png` });
  await page.goto(BASE.replace('?nosw', `?nosw#/kasir?bill=${pwaId}`));
  await page.waitForSelector('.cart-lines [data-line]');
  await payCash(page);
  await page.click('.modal [data-new]');
  let pst = '';
  for (let i = 0; i < 40 && pst !== 'PAID'; i++) { await wait(500); pst = sql(`select status from "Order" where id='${pwaId}'`); }
  if (pst !== 'PAID') throw new Error('PWA belum lunas di server: ' + pst);
  log('pesanan PWA tampil di tagihan & dapur, dibayar di kasir → PAID di server');


  // 6c. Refund (online) pesanan offline tadi, disetujui Dewi
  await page.goto(BASE.replace('?nosw', '?nosw#/riwayat'));
  // refund hanya untuk transaksi lunas di luar shift berjalan (di shift berjalan → void); pakai transaksi run sebelumnya
  await page.waitForSelector('[data-o]');
  const rows = page.locator('[data-o]:has(.tag:has-text("Lunas"))');
  let refNo = '';
  for (let i = 0; i < (await rows.count()) && !refNo; i++) {
    await rows.nth(i).click();
    if (await page.locator('#h-detail [data-od="refund"]').count()) refNo = (await rows.nth(i).innerText()).match(/[A-Z0-9]+-[A-Z0-9-]{6,}/)[0];
  }
  if (!refNo) { log('LEWATI refund: belum ada transaksi lunas dari shift sebelumnya (jalankan ulang skrip)'); }
  else {
  await page.click('#h-detail [data-od="refund"]');
  const ap2 = top(page);
  await ap2.locator('[data-s]:has-text("Dewi")').click().catch(() => {});
  for (const d of '2222') await ap2.locator(`.keypad [data-k="${d}"]`).click();
  await ap2.locator('.keypad [data-k="ok"]').click().catch(() => {});
  await page.waitForSelector('.modal:has-text("Alasan refund")');
  await top(page).locator('[data-p="Pesanan salah"]').click();
  await top(page).locator('[data-ok]').click();
  let rst = '';
  for (let i = 0; i < 30 && rst !== 'REFUNDED'; i++) { await wait(500); rst = sql(`select status from "Order" where number='${refNo}'`); }
  if (rst !== 'REFUNDED') throw new Error('refund tidak sampai server: ' + rst);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/12d-refund.png` });
  log('refund tercatat di server:', sql(`select amount||' '||reason from "Refund" r join "Order" o on o.id=r."orderId" where o.number='${refNo}'`));
  }

  // 7. Mode demo (konteks browser baru)
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errs.push('demo pageerror: ' + e.message));
  await p2.goto(BASE);
  await p2.waitForSelector('.mode-card');
  await p2.click('[data-mode="demo"]');
  await p2.click('[data-go="demo"]');
  await p2.waitForSelector('.staff-grid', { timeout: 30000 });
  await p2.click('.staff:has-text("Sari")');
  for (const d of '3333') await p2.click(`.keypad [data-k="${d}"]`);
  await p2.click('.keypad [data-k="ok"]').catch(() => {});
  await p2.waitForSelector('.modal:has-text("Buka shift")');
  await p2.click('.modal [data-q="300000"]');
  await p2.click('.modal [data-ok]');
  await p2.waitForSelector('.prod');
  await p2.locator('.prod', { has: p2.locator('.pn', { hasText: /^Caffe Latte$/ }) }).first().click();
  await top(p2).locator('.opt[data-c="Iced · Regular"]').click();
  await top(p2).locator('[data-ok]').click();
  await payCash(p2);
  await p2.click('.modal [data-new]');
  await p2.screenshot({ path: `${SHOTS}/13-demo-kasir.png` });
  await p2.goto(BASE.replace('?nosw', '?nosw#/riwayat'));
  await p2.waitForSelector('[data-o]');
  const nDemo = await p2.locator('[data-o]').count();
  await p2.screenshot({ path: `${SHOTS}/14-demo-riwayat.png` });
  log('demo: riwayat hari ini', nDemo, 'baris');

  console.log('errors:', errs.filter((e) => !/Failed to load resource|ERR_CONNECTION|502|503|504/.test(e)));
  await browser.close();
})().catch((e) => { console.error('GAGAL', e); process.exit(1); });
