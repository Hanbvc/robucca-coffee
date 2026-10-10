/* Tes integrasi API publik PWA (/public/*) terhadap PostgreSQL sungguhan.
   Database: PUBLIC_TEST_DATABASE_URL, atau turunan TEST_DATABASE_URL dengan nama "<nama>_public" (dibuat otomatis).
   Migrasi (deploy) & seed demo dijalankan otomatis; tes menambah data, tidak menghapus apa pun. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivedDb, ensureDb } from './test-db.mjs';

const target = derivedDb('_public', process.env.PUBLIC_TEST_DATABASE_URL);
const URL_ = target?.url;

const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '..');
const dbPkg = path.resolve(here, '../../../packages/db');
const PORT = 3250 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: URL_, AUTH_SECRET: 'tes-rahasia-yang-panjangnya-lebih-dari-32-karakter', PORT: String(PORT), PUBLIC_ORDER_IP_LIMIT: '200', PUBLIC_OTP_IP_LIMIT: '200', PUBLIC_RSV_IP_LIMIT: '200' };

let server; let db; let device; let menu; let sari; let shift;
const run = Math.floor(Math.random() * 9e6) + 1e6;
/** Nomor WhatsApp unik per jalannya tes (batas OTP per nomor tidak saling mengganggu). */
const phone = (n) => `0812${String(run).slice(0, 6)}${String(n).padStart(2, '0')}`;

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  if (!URL_) return;
  await ensureDb(target);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbPkg, env, stdio: 'ignore' });
  execFileSync('node', ['dist/seed/index.js'], { cwd: dbPkg, env: { ...env, SEED_DEMO: '1' }, stdio: 'ignore' });
  const out = execFileSync('node', ['dist/cli/pair.js', '--branch', 'IJN', '--terminal', String(10 + Math.floor(Math.random() * 80)), '--name', 'Kasir tes PWA'], { cwd: api, env }).toString();
  const code = out.match(/(\d{6})/)[1];
  server = spawn('node', ['dist/main.js'], { cwd: api, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  device = (await call('POST', '/pos/pair', { code, name: 'Kasir tes PWA' })).body.token;
  const { createPrismaClient } = await import('@robucca/db');
  db = createPrismaClient(URL_);
  menu = (await call('GET', '/public/branches/IJN/menu')).body;
  sari = await db.user.findFirst({ where: { name: 'Sari' } });
  shift = randomUUID();
  await call('POST', '/pos/sync', { shifts: [{ id: shift, status: 'OPEN', openedAt: new Date().toISOString(), openingCash: 100000, openedById: sari.id }] }, { 'x-device-token': device });
});

after(async () => {
  server?.kill();
  await db?.$disconnect();
});

const skip = !URL_ && 'TEST_DATABASE_URL belum diisi';
const product = (slug) => menu.categories.flatMap((c) => c.products).find((p) => p.slug === slug);
const opt = (p, name) => p.modifierGroups.flatMap((g) => g.options).find((o) => o.name === name).id;

async function login(n, name = 'Dinda') {
  const r = await call('POST', '/public/auth/otp', { phone: phone(n) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await call('POST', '/public/auth/verify', { phone: phone(n), code: r.body.devCode, name });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.token;
}

test('katalog publik: cabang, menu + pajak, banner, kurir, metode bayar', { skip }, async () => {
  const cfg = (await call('GET', '/public/config')).body;
  assert.equal(cfg.otpLogin, true, 'di luar produksi masuk OTP tersedia (kode dev)');
  assert.ok(cfg.org.name);
  const b = await call('GET', '/public/branches');
  assert.ok(b.body.find((x) => x.code === 'IJN' && x.acceptsDelivery && x.lat));
  assert.equal(menu.branch.code, 'IJN');
  assert.equal(menu.taxConfig.taxRateBp, 1000);
  assert.equal(menu.categories.reduce((a, c) => a + c.products.length, 0), 95);
  // Kategori untuk beranda PWA: kode tautan, keterangan, foto kisi, tanda Signature
  const cat = (slug) => menu.categories.find((c) => c.slug === slug);
  assert.equal(cat('donburi').description, 'Donburi & curry');
  assert.equal(cat('coffee').imageUrl, 'assets/img/ice-caffe-latte.jpg');
  assert.equal(cat('tea').imageUrl, null, 'tidak di kisi beranda');
  assert.equal(cat('signature').isSignature, true);
  assert.equal(menu.categories.filter((c) => c.imageUrl).length, 8);
  assert.ok('tiktok' in cfg.org && 'tagline' in menu.org);
  assert.equal((await call('GET', '/public/banners')).body.length, 5);
  assert.deepEqual((await call('GET', '/public/couriers')).body.map((c) => c.code), ['gosend', 'grab']);
  const pays = (await call('GET', '/public/payment-options')).body.map((p) => p.code);
  assert.ok(pays.includes('qris') && pays.includes('gopay') && pays.includes('cashier'));
  assert.ok(!pays.includes('cash') && !pays.includes('debit'), 'metode khusus kasir tidak tampil di PWA');
});

test('OTP: kode salah ditolak, kode benar memberi token pelanggan; /me butuh token', { skip }, async () => {
  assert.equal((await call('GET', '/public/me')).status, 401);
  const r = await call('POST', '/public/auth/otp', { phone: phone(1) });
  assert.equal(r.status, 200);
  assert.match(r.body.devCode, /^\d{6}$/);
  // Disimpan di DB sebagai HMAC berkunci (bukan teks biasa), berlaku 5 menit
  const row = await db.customerOtp.findUnique({ where: { phone: `62${phone(1).slice(1)}` } });
  assert.match(row.codeHash, /^[0-9a-f]{64}$/);
  assert.ok(!row.codeHash.includes(r.body.devCode));
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 300_000) < 10_000);
  const wrong = r.body.devCode === '000000' ? '111111' : '000000';
  assert.equal((await call('POST', '/public/auth/verify', { phone: phone(1), code: wrong })).status, 401);
  assert.equal((await db.customerOtp.findUnique({ where: { phone: `62${phone(1).slice(1)}` } })).attempts, 1, 'percobaan salah tercatat');
  const ok = await call('POST', '/public/auth/verify', { phone: phone(1), code: r.body.devCode, name: 'Dinda Ayu' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.customer.phone, `62${phone(1).slice(1)}`);
  assert.equal((await call('POST', '/public/auth/verify', { phone: phone(1), code: r.body.devCode })).status, 401, 'kode sekali pakai');
  assert.equal(await db.customerOtp.count({ where: { phone: `62${phone(1).slice(1)}` } }), 0, 'kode terpakai dihapus dari DB');
  const me = await call('GET', '/public/me', null, { 'x-customer-token': ok.body.token });
  assert.equal(me.body.name, 'Dinda Ayu');
  assert.ok(me.body.phoneVerifiedAt);
  // Token staf/perangkat bukan token pelanggan
  assert.equal((await call('GET', '/public/me', null, { 'x-customer-token': device })).status, 401);
  const c = await db.customer.findUnique({ where: { phone: `62${phone(1).slice(1)}` } });
  assert.ok(c.phoneVerifiedAt);
});

test('rate limit: permintaan OTP per nomor & tebakan kode dibatasi (429)', { skip }, async () => {
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await call('POST', '/public/auth/otp', { phone: phone(2) })).status);
  assert.deepEqual(codes, [200, 200, 200]);
  assert.equal((await call('POST', '/public/auth/otp', { phone: phone(2) })).status, 429);
  // 5 tebakan salah → nomor dikunci, kode benar pun ditolak
  const r = await call('POST', '/public/auth/otp', { phone: phone(3) });
  const wrong = r.body.devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/public/auth/verify', { phone: phone(3), code: wrong })).status, 401);
  assert.equal((await call('POST', '/public/auth/verify', { phone: phone(3), code: r.body.devCode })).status, 429);
});

const latte = () => product('caffe-latte');
const latteLarge = () => {
  const p = latte();
  return { productId: p.id, optionIds: [opt(p, 'Iced · Large'), opt(p, 'Less Sugar'), opt(p, 'Less Ice')], quantity: 2 };
};
const fries = () => ({ productId: product('truffle-fries').id, optionIds: [], quantity: 1, note: 'saus dipisah' });

let pickup; let token;
test('pesanan Pick Up: total dihitung server (harga + opsi + pajak termasuk), status OPEN, bayar di kasir', { skip }, async () => {
  token = await login(4, 'Raka');
  const r = await call('POST', '/public/orders', {
    branchCode: 'ijn', type: 'CLICK_COLLECT', name: 'Raka', phone: phone(4), payment: 'cashier', cutlery: true,
    items: [latteLarge(), fries()],
  }, { 'x-customer-token': token });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  pickup = r.body;
  const o = r.body.order;
  // Caffe Latte 19.000 + Large 4.000 = 23.000 × 2 + Truffle Fries 27.000 = 73.000 (PB1 10% sudah termasuk)
  assert.equal(o.subtotal, 73000);
  assert.equal(o.total, 73000);
  assert.equal(o.taxTotal, Math.round(73000 * 1000 / 11000));
  assert.equal(o.status, 'OPEN');
  assert.equal(o.stage, 'received');
  assert.equal(o.payment.state, 'cashier');
  assert.match(o.number, /^IJN0-\d{6}-\d{4}$/);
  assert.match(o.queueNumber, /^A\d{3}$/);
  assert.equal(o.items[0].summary, 'Iced · Large · Less Sugar · Less Ice');
  // "Pesan lagi": menu & opsi yang sama
  assert.equal(o.items[0].productId, latte().id);
  assert.deepEqual(new Set(o.items[0].optionIds), new Set(latteLarge().optionIds));
  assert.ok(r.body.accessToken);
  const saved = await db.order.findUnique({ where: { id: o.id }, include: { items: { include: { modifiers: true } }, payments: true } });
  assert.equal(saved.source, 'PWA');
  assert.equal(saved.items[0].modifiers.length, 3);
  assert.ok(saved.items.every((i) => i.sentToKitchenAt), 'bayar di kasir: tiket langsung ke dapur');
  assert.equal(saved.payments.length, 0);
  assert.match(saved.note, /alat makan/);
  assert.ok(saved.customerId);
});

test('ditolak: opsi asing, pilihan wajib kosong, harga satuan & total dimanipulasi, bayar online di delivery saja', { skip }, async () => {
  const p = latte();
  const baseOrder = { branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Iseng', phone: phone(5), payment: 'cashier' };
  // Opsi dari grup yang tidak dimiliki Caffe Latte (grup identik dipakai bersama antarmenu, jadi cari grup lain).
  const latteGroups = new Set(p.modifierGroups.map((g) => g.id));
  const foreignOpt = menu.categories.flatMap((c) => c.products).flatMap((x) => x.modifierGroups).find((g) => !latteGroups.has(g.id)).options[0].id;
  const foreign = await call('POST', '/public/orders', { ...baseOrder, items: [{ productId: p.id, optionIds: [opt(p, 'Iced · Regular'), foreignOpt], quantity: 1 }] });
  assert.equal(foreign.status, 400);
  assert.match(foreign.body.message, /pilihan tidak cocok/);
  const random = await call('POST', '/public/orders', { ...baseOrder, items: [{ productId: p.id, optionIds: [randomUUID()], quantity: 1 }] });
  assert.equal(random.status, 400);
  // "Penyajian & ukuran" wajib; dua pilihan di grup tunggal juga ditolak
  const missing = await call('POST', '/public/orders', { ...baseOrder, items: [{ productId: p.id, optionIds: [], quantity: 1 }] });
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /wajib dipilih/);
  const two = await call('POST', '/public/orders', { ...baseOrder, items: [{ productId: p.id, optionIds: [opt(p, 'Iced · Regular'), opt(p, 'Hot')], quantity: 1 }] });
  assert.equal(two.status, 400);
  const cheap = await call('POST', '/public/orders', { ...baseOrder, items: [{ ...latteLarge(), unitPrice: 1000 }] });
  assert.equal(cheap.status, 409);
  assert.match(cheap.body.message, /Harga/);
  const total = await call('POST', '/public/orders', { ...baseOrder, items: [latteLarge()], expectedTotal: 1000 });
  assert.equal(total.status, 409);
  const unknownPay = await call('POST', '/public/orders', { ...baseOrder, payment: 'cash', items: [fries()] });
  assert.equal(unknownPay.status, 400, 'tunai hanya di kasir, bukan metode PWA');
  const dlvCashier = await call('POST', '/public/orders', { ...baseOrder, type: 'DELIVERY', items: [fries()], delivery: { courierCode: 'gosend', addressText: 'Jl. Soekarno Hatta No. 27, Malang', lat: -7.9420837, lng: 112.6220393 } });
  assert.equal(dlvCashier.status, 400);
  // Harga satuan & total yang benar diterima
  const okPrice = latte().price + 4000;
  const ok = await call('POST', '/public/orders', { ...baseOrder, items: [{ ...latteLarge(), unitPrice: okPrice }], expectedTotal: okPrice * 2 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const count = await db.order.count({ where: { customerPhone: `62${phone(5).slice(1)}` } });
  assert.equal(count, 1, 'pesanan yang ditolak tidak tersimpan');
});

test('status pesanan: token akses atau pemilik; tanpa token / token pesanan lain → 404', { skip }, async () => {
  const id = pickup.order.id;
  assert.equal((await call('GET', `/public/orders/${id}`)).status, 404);
  assert.equal((await call('GET', `/public/orders/${id}?token=palsu`)).status, 404);
  const g = await call('GET', `/public/orders/${id}?token=${encodeURIComponent(pickup.accessToken)}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.number, pickup.order.number);
  assert.equal((await call('GET', `/public/orders/${id}`, null, { 'x-customer-token': token })).status, 200);
  const other = await login(6);
  assert.equal((await call('GET', `/public/orders/${id}`, null, { 'x-customer-token': other })).status, 404);
  const mine = await call('GET', '/public/me/orders', null, { 'x-customer-token': token });
  assert.ok(mine.body.some((o) => o.id === id && o.accessToken));
  const look = await call('POST', '/public/orders/lookup', { refs: [{ id, token: pickup.accessToken }, { id: randomUUID(), token: pickup.accessToken }] });
  assert.deepEqual(look.body.map((o) => o.id), [id]);
});

let qris; let qrisToken;
test('QRIS: pesanan tetap menunggu konfirmasi kasir; muncul di feed POS seketika (SSE) tanpa dianggap lunas', { skip }, async () => {
  // Dengarkan SSE perangkat POS sebelum pesanan dibuat
  const ctrl = new AbortController();
  const sse = await fetch(`${base}/pos/stream?device=${encodeURIComponent(device)}`, { signal: ctrl.signal });
  const reader = sse.body.getReader();
  const got = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buf;
      buf += new TextDecoder().decode(value);
      if (/event: feed/.test(buf) && /event: order/.test(buf)) return buf;
    }
  })();
  const p = latte();
  const r = await call('POST', '/public/orders', {
    id: (await import('@robucca/core')).uuidv7(),
    branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Raka', phone: phone(4), payment: 'qris',
    items: [{ productId: p.id, optionIds: [opt(p, 'Hot'), opt(p, 'Normal')], quantity: 1 }],
  }, { 'x-customer-token': token });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  qris = r.body.order; qrisToken = r.body.accessToken;
  assert.equal(qris.total, 21000);
  assert.equal(qris.stage, 'awaiting_payment');
  assert.equal(qris.payment.state, 'pending');
  assert.equal(qris.payment.code, 'qris');
  assert.equal(qris.items[0].imageUrl, 'assets/img/caffe-latte-hot.jpg', 'foto mengikuti opsi Hot');
  const events = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('SSE POS tidak menerima event')), 3000))]);
  ctrl.abort();
  assert.match(events, /event: order/);
  // Kirim ulang dengan ID sama tidak dobel
  const again = await call('POST', '/public/orders', {
    id: qris.id, branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Raka', phone: phone(4), payment: 'qris',
    items: [{ productId: p.id, optionIds: [opt(p, 'Hot')], quantity: 1 }],
  });
  assert.equal(again.status, 201);
  assert.equal(again.body.order.number, qris.number);
  const feed = await call('GET', '/pos/feed', null, { 'x-device-token': device });
  const f = feed.body.orders.find((x) => x.id === qris.id);
  assert.ok(f, 'pesanan PWA ada di feed POS');
  assert.equal(f.source, 'PWA');
  assert.equal(f.status, 'OPEN');
  assert.deepEqual(f.payments, [], 'pembayaran PENDING tidak tampil sebagai pembayaran');
  assert.match(f.note, /QRIS — menunggu konfirmasi kasir/);
  assert.ok(f.items.every((i) => !i.sentToKitchenAt), 'belum dibayar: belum ke dapur');
  // Tidak ada endpoint untuk pelanggan menandai lunas
  assert.equal((await call('POST', `/public/orders/${qris.id}/paid?token=${encodeURIComponent(qrisToken)}`)).status, 404);
});

test('kasir mengonfirmasi pembayaran lewat /pos/sync (ID sama, versi naik) → status pelanggan berubah via SSE', { skip }, async () => {
  const feed = await call('GET', '/pos/feed', null, { 'x-device-token': device });
  const f = feed.body.orders.find((x) => x.id === qris.id);
  // Stream status pelanggan
  const ctrl = new AbortController();
  const sse = await fetch(`${base}/public/orders/${qris.id}/stream?token=${encodeURIComponent(qrisToken)}`, { signal: ctrl.signal });
  assert.equal(sse.status, 200);
  const reader = sse.body.getReader();
  const statuses = [];
  const got = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += new TextDecoder().decode(value);
      for (const m of buf.matchAll(/event: status\n(?:id: .*\n)?data: (.+)\n/g)) statuses.push(JSON.parse(m[1]));
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      if (statuses.some((s) => s.stage !== 'awaiting_payment')) return;
    }
  })();
  const now = new Date().toISOString();
  const doc = {
    id: f.id, number: f.number, queueNumber: f.queueNumber, type: f.type, channelCode: 'takeaway', status: 'PAID', createdAt: f.createdAt, paidAt: now,
    cashierId: sari.id, shiftId: shift, version: f.version + 1, customerName: f.customerName,
    items: f.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, optionIds: i.modifiers.map((m) => m.modifierOptionId), sentToKitchenAt: now })),
    payments: [{ id: randomUUID(), optionCode: 'qris', amount: f.total, at: now }],
  };
  const r = await call('POST', '/pos/sync', { orders: [doc] }, { 'x-device-token': device });
  assert.equal(r.body.orders[0].status, 'saved', JSON.stringify(r.body));
  await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('status SSE tidak berubah')), 3000))]);
  ctrl.abort();
  assert.equal(statuses[0].stage, 'awaiting_payment');
  assert.equal(statuses.at(-1).stage, 'received');
  assert.equal(statuses.at(-1).payment.state, 'paid');
  const saved = await db.order.findUnique({ where: { id: qris.id }, include: { payments: true } });
  assert.equal(saved.status, 'PAID');
  assert.equal(saved.source, 'PWA');
  assert.equal(saved.number, qris.number, 'nomor struk PWA tetap');
  assert.equal(saved.type, 'CLICK_COLLECT');
  assert.equal(saved.total, 21000);
  assert.deepEqual(saved.payments.map((p) => [p.status, p.amount]), [['SUCCEEDED', 21000]]);
  // Versi lama dari perangkat lain = konflik
  const stale = await call('POST', '/pos/sync', { orders: [{ ...doc, version: 1 }] }, { 'x-device-token': device });
  assert.equal(stale.body.orders[0].status, 'conflict');
  // Dapur selesai → siap diambil → pelanggan menandai sudah diambil
  await call('POST', '/pos/sync', { kitchen: [{ orderId: qris.id, done: true, at: new Date().toISOString() }] }, { 'x-device-token': device });
  const ready = await call('GET', `/public/orders/${qris.id}?token=${encodeURIComponent(qrisToken)}`);
  assert.equal(ready.body.stage, 'ready');
  const done = await call('POST', `/public/orders/${qris.id}/received?token=${encodeURIComponent(qrisToken)}`);
  assert.equal(done.body.stage, 'completed');
});

test('bayar di kasir: kasir menyelesaikan pesanan Pick Up dengan tunai lewat /pos/sync', { skip }, async () => {
  const feed = await call('GET', '/pos/feed', null, { 'x-device-token': device });
  const f = feed.body.orders.find((x) => x.id === pickup.order.id);
  const now = new Date().toISOString();
  const r = await call('POST', '/pos/sync', { orders: [{
    id: f.id, number: f.number, queueNumber: f.queueNumber, type: f.type, status: 'PAID', createdAt: f.createdAt, paidAt: now,
    cashierId: sari.id, shiftId: shift, version: f.version + 1,
    items: f.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, optionIds: i.modifiers.map((m) => m.modifierOptionId), note: i.note ?? undefined, sentToKitchenAt: i.sentToKitchenAt })),
    payments: [{ id: randomUUID(), optionCode: 'cash', amount: f.total, tendered: 100000, at: now }],
  }] }, { 'x-device-token': device });
  assert.equal(r.body.orders[0].status, 'saved', JSON.stringify(r.body));
  const s = await call('GET', `/public/orders/${pickup.order.id}?token=${encodeURIComponent(pickup.accessToken)}`);
  assert.equal(s.body.payment.state, 'paid');
  assert.equal(s.body.customerName, 'Raka', 'data pelanggan PWA dipertahankan');
  const pay = await db.payment.findFirst({ where: { orderId: pickup.order.id } });
  assert.equal(pay.changeAmount, 100000 - 73000);
});

test('delivery: ongkir & jarak dihitung server, di luar jangkauan ditolak, alamat tersimpan, total + ongkir lewat /pos/sync', { skip }, async () => {
  const t = await login(7, 'Dinda');
  const body = {
    branchCode: 'IJN', type: 'DELIVERY', name: 'Dinda', phone: phone(7), payment: 'gopay', items: [fries()],
    delivery: { courierCode: 'gosend', addressText: 'Jl. Soekarno Hatta No. 27, Jatimulyo, Malang', addressNote: 'Ruko lantai 2', lat: -7.9420837, lng: 112.6220393, saveAddress: true },
  };
  const far = await call('POST', '/public/orders', { ...body, delivery: { ...body.delivery, lat: -7.25, lng: 112.75 } }, { 'x-customer-token': t });
  assert.equal(far.status, 422);
  const r = await call('POST', '/public/orders', body, { 'x-customer-token': t });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = r.body.order;
  // ±5,4 km × GoSend (5.000 + 2.500/km, min 12.000) → 18.500
  assert.equal(o.delivery.distanceKm, 5.4);
  assert.equal(o.deliveryFee, 18500);
  assert.equal(o.total, 27000 + 18500);
  assert.equal(o.stage, 'awaiting_payment');
  const addrs = await call('GET', '/public/me/addresses', null, { 'x-customer-token': t });
  assert.equal(addrs.body.length, 1);
  assert.equal(addrs.body[0].isDefault, true);
  // Kasir konfirmasi GoPay: pembayaran harus sama dengan total termasuk ongkir
  const f = (await call('GET', '/pos/feed', null, { 'x-device-token': device })).body.orders.find((x) => x.id === o.id);
  assert.equal(f.delivery.fee, 18500);
  const now = new Date().toISOString();
  const doc = (amount) => ({
    id: f.id, number: f.number, queueNumber: f.queueNumber, type: f.type, status: 'PAID', createdAt: f.createdAt, paidAt: now,
    cashierId: sari.id, shiftId: shift, version: f.version + 1,
    items: f.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, optionIds: [] })),
    payments: [{ id: randomUUID(), optionCode: 'gopay', amount, at: now }],
  });
  const short = await call('POST', '/pos/sync', { orders: [doc(27000)] }, { 'x-device-token': device });
  assert.equal(short.body.orders[0].status, 'rejected', 'ongkir tidak boleh hilang');
  const ok = await call('POST', '/pos/sync', { orders: [doc(45500)] }, { 'x-device-token': device });
  assert.equal(ok.body.orders[0].status, 'saved', JSON.stringify(ok.body));
  const saved = await db.order.findUnique({ where: { id: o.id } });
  assert.equal(saved.total, 45500);
  assert.equal(saved.deliveryFee, 18500);
});

test('alamat tersimpan: tambah, ubah default, hapus; milik pelanggan lain tidak bisa diubah', { skip }, async () => {
  const t = await login(8);
  const a = { label: 'Rumah', addressText: 'Jl. Ijen No. 1, Malang', lat: -7.97, lng: 112.62, recipientName: 'Budi', recipientPhone: phone(8) };
  const r1 = await call('POST', '/public/me/addresses', a, { 'x-customer-token': t });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.isDefault, true);
  const r2 = await call('POST', '/public/me/addresses', { ...a, label: 'Kantor', isDefault: true }, { 'x-customer-token': t });
  const list = (await call('GET', '/public/me/addresses', null, { 'x-customer-token': t })).body;
  assert.deepEqual(list.map((x) => [x.label, x.isDefault]), [['Kantor', true], ['Rumah', false]]);
  const other = await login(9);
  assert.equal((await call('PATCH', `/public/me/addresses/${r2.body.id}`, a, { 'x-customer-token': other })).status, 404);
  assert.equal((await call('DELETE', `/public/me/addresses/${r2.body.id}`, null, { 'x-customer-token': other })).status, 404);
  const upd = await call('PATCH', `/public/me/addresses/${r1.body.id}`, { ...a, addressNote: 'Pagar hijau' }, { 'x-customer-token': t });
  assert.equal(upd.body.addressNote, 'Pagar hijau');
  assert.equal((await call('DELETE', `/public/me/addresses/${r1.body.id}`, null, { 'x-customer-token': t })).status, 200);
  assert.equal((await call('GET', '/public/me/addresses', null, { 'x-customer-token': t })).body.length, 1);
});

const rsvBody = (n) => ({
  branchCode: 'IJN', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() + 2 * 24 * 3600e3)),
  time: '10:00', guests: 4, area: 'Indoor', occasion: 'Ulang Tahun', note: 'Dekat jendela', name: 'Dinda', phone: phone(n),
});

test('reservasi akun: dibuat dengan kode, pre-order, lalu dibatalkan (pre-order belum bayar ikut batal, versi melompat)', { skip }, async () => {
  const body = rsvBody(10);
  const t = await login(10);
  const bad = await call('POST', '/public/reservations', { ...body, time: '22:00' }, { 'x-customer-token': t });
  assert.equal(bad.status, 400);
  const tooMany = await call('POST', '/public/reservations', { ...body, guests: 99 }, { 'x-customer-token': t });
  assert.equal(tooMany.status, 400);
  const r = await call('POST', '/public/reservations', body, { 'x-customer-token': t });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.code, /^RSV-[A-Z2-9]{4}$/);
  assert.equal(r.body.status, 'PENDING');
  // Pre-order untuk reservasi ini
  const pre = await call('POST', '/public/orders', { branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Dinda', phone: phone(10), payment: 'cashier', reservationId: r.body.id, items: [fries()] }, { 'x-customer-token': t });
  assert.equal(pre.status, 201, JSON.stringify(pre.body));
  assert.equal(pre.body.order.type, 'DINE_IN');
  assert.equal(pre.body.order.reservation.code, r.body.code);
  assert.equal(pre.body.order.stage, 'scheduled');
  const dup = await call('POST', '/public/orders', { branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Dinda', phone: phone(10), payment: 'cashier', reservationId: r.body.id, items: [fries()] }, { 'x-customer-token': t });
  assert.equal(dup.status, 409);
  const list = await call('GET', '/public/reservations', null, { 'x-customer-token': t });
  assert.equal(list.body[0].preOrders.length, 1);
  const other = await login(11);
  assert.equal((await call('POST', `/public/reservations/${r.body.id}/cancel`, null, { 'x-customer-token': other })).status, 404);
  const c = await call('POST', `/public/reservations/${r.body.id}/cancel`, null, { 'x-customer-token': t });
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'CANCELLED');
  const o = await db.order.findUnique({ where: { id: pre.body.order.id } });
  assert.equal(o.status, 'VOIDED');
  assert.equal(o.version, 1 + 1000, 'perubahan dari server melompati versi perangkat');
});

test('reservasi tamu: token akses untuk lihat, lookup, pre-order, batal; nomor yang sama melihatnya setelah masuk', { skip }, async () => {
  const g = await call('POST', '/public/reservations', rsvBody(13));
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.match(g.body.code, /^RSV-/);
  const tok = g.body.accessToken;
  assert.ok(tok);
  // Tanpa token, atau dengan token pesanan (jenis lain) → 404
  assert.equal((await call('GET', `/public/reservations/${g.body.id}`)).status, 404);
  assert.equal((await call('GET', `/public/reservations/${g.body.id}?token=${encodeURIComponent(pickup.accessToken)}`)).status, 404);
  const got = await call('GET', `/public/reservations/${g.body.id}`, null, { 'x-reservation-token': tok });
  assert.equal(got.status, 200);
  assert.equal(got.body.code, g.body.code);
  const lk = await call('POST', '/public/reservations/lookup', { refs: [{ id: g.body.id, token: tok }, { id: randomUUID(), token: tok }] });
  assert.deepEqual(lk.body.map((r) => r.id), [g.body.id]);
  // Pre-order tamu: wajib token reservasi
  const order = { branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Dinda', phone: phone(13), payment: 'cashier', reservationId: g.body.id, items: [fries()] };
  assert.equal((await call('POST', '/public/orders', order)).status, 400);
  const pre = await call('POST', '/public/orders', { ...order, reservationToken: tok });
  assert.equal(pre.status, 201, JSON.stringify(pre.body));
  assert.equal(pre.body.order.reservation.code, g.body.code);
  // Nomor yang sama masuk dengan WhatsApp → reservasi tamunya ikut tampil (dengan token)
  const t = await login(13);
  const mine = await call('GET', '/public/reservations', null, { 'x-customer-token': t });
  const m = mine.body.find((r) => r.id === g.body.id);
  assert.ok(m && m.accessToken && m.preOrders.length === 1);
  assert.equal((await call('GET', `/public/reservations/${g.body.id}`, null, { 'x-customer-token': t })).status, 200);
  const c = await call('POST', `/public/reservations/${g.body.id}/cancel?token=${encodeURIComponent(tok)}`);
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'CANCELLED');
  assert.equal((await db.order.findUnique({ where: { id: pre.body.order.id } })).status, 'VOIDED');
});

test('ganti ke bayar di kasir: e-wallet belum dikonfirmasi → bayar di kasir, tiket ke dapur, versi melompat (salinan POS lama = konflik)', { skip }, async () => {
  const p = latte();
  const r = await call('POST', '/public/orders', {
    branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Raka', phone: phone(14), payment: 'gopay', note: 'Bayar pakai uang pas',
    items: [{ productId: p.id, optionIds: [opt(p, 'Hot'), opt(p, 'Normal')], quantity: 1 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { id } = r.body.order;
  const tok = r.body.accessToken;
  // POS sudah memuat versi 1 sebelum pelanggan mengganti
  const f = (await call('GET', '/pos/feed', null, { 'x-device-token': device })).body.orders.find((x) => x.id === id);
  assert.equal(f.version, 1);
  assert.equal((await call('POST', `/public/orders/${id}/pay-at-cashier`)).status, 404, 'tanpa token');
  const s = await call('POST', `/public/orders/${id}/pay-at-cashier`, null, { 'x-order-token': tok });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.payment.state, 'cashier');
  assert.equal(s.body.stage, 'received');
  assert.equal(s.body.version, 1001);
  const saved = await db.order.findUnique({ where: { id }, include: { items: true, payments: true } });
  assert.ok(saved.items.every((i) => i.sentToKitchenAt), 'langsung ke dapur seperti bayar di kasir');
  assert.deepEqual(saved.payments.map((x) => x.status), ['FAILED']);
  assert.equal(saved.note, 'Bayar di kasir (pelanggan batal bayar online) · Bayar pakai uang pas', 'catatan pelanggan utuh');
  assert.equal((await call('POST', `/public/orders/${id}/pay-at-cashier`, null, { 'x-order-token': tok })).status, 200, 'diulang aman');
  // Salinan POS dari versi 1 (versi 2) tidak boleh dianggap duplikat lalu terbuang diam-diam
  const now = new Date().toISOString();
  const doc = {
    id, number: f.number, queueNumber: f.queueNumber, type: f.type, status: 'PAID', createdAt: f.createdAt, paidAt: now, cashierId: sari.id, shiftId: shift, version: 2,
    items: f.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, optionIds: i.modifiers.map((x) => x.modifierOptionId) })),
    payments: [{ id: randomUUID(), optionCode: 'gopay', amount: f.total, at: now }],
  };
  assert.equal((await call('POST', '/pos/sync', { orders: [doc] }, { 'x-device-token': device })).body.orders[0].status, 'conflict');
  // Kasir memakai versi server lalu menerima tunai
  const ok = await call('POST', '/pos/sync', { orders: [{ ...doc, version: 1002, payments: [{ id: randomUUID(), optionCode: 'cash', amount: f.total, tendered: f.total, at: now }] }] }, { 'x-device-token': device });
  assert.equal(ok.body.orders[0].status, 'saved', JSON.stringify(ok.body));
  // Setelah lunas tidak bisa diganti lagi; delivery tidak bisa bayar di kasir
  assert.equal((await call('POST', `/public/orders/${id}/pay-at-cashier`, null, { 'x-order-token': tok })).status, 409);
  const dl = await call('POST', '/public/orders', {
    branchCode: 'IJN', type: 'DELIVERY', name: 'Raka', phone: phone(14), payment: 'qris', items: [fries()],
    delivery: { courierCode: 'grab', addressText: 'Jl. Soekarno Hatta No. 27, Malang', lat: -7.9420837, lng: 112.6220393 },
  });
  assert.equal(dl.status, 201, JSON.stringify(dl.body));
  assert.equal((await call('POST', `/public/orders/${dl.body.order.id}/pay-at-cashier`, null, { 'x-order-token': dl.body.accessToken })).status, 409);
});

test('rate limit pesanan: per nomor dibatasi (429)', { skip }, async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await call('POST', '/public/orders', { branchCode: 'IJN', type: 'CLICK_COLLECT', name: 'Spam', phone: phone(12), payment: 'cashier', items: [{ productId: randomUUID(), optionIds: [], quantity: 1 }] })).status);
  }
  assert.ok(statuses.slice(0, 10).every((s) => s === 400), statuses.join());
  assert.equal(statuses[10], 429);
});
