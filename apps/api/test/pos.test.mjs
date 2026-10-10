/* Tes integrasi API POS terhadap PostgreSQL sungguhan.
   Butuh database khusus tes (sebaiknya baru & kosong): TEST_DATABASE_URL=postgresql://…/robucca_test pnpm --filter @robucca/api test
   Migrasi (deploy) & seed demo dijalankan otomatis; tes menambah data, tidak menghapus apa pun. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = process.env.TEST_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '..');
const dbPkg = path.resolve(here, '../../../packages/db');
const PORT = 3190 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATABASE_URL: URL_, AUTH_SECRET: 'tes-rahasia-yang-panjangnya-lebih-dari-32-karakter', PORT: String(PORT) };

let server; let db; let device; let cashierSession; let master; const ids = {};

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const dev = () => ({ 'x-device-token': device });
const ses = () => ({ ...dev(), 'x-session': cashierSession });

before(async () => {
  if (!URL_) return;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbPkg, env, stdio: 'ignore' });
  execFileSync('node', ['dist/seed/index.js'], { cwd: dbPkg, env: { ...env, SEED_DEMO: '1' }, stdio: 'ignore' });
  const out = execFileSync('node', ['dist/cli/pair.js', '--branch', 'IJN', '--terminal', '1', '--name', 'Kasir tes'], { cwd: api, env }).toString();
  ids.code = out.match(/(\d{6})/)[1];
  server = spawn('node', ['dist/main.js'], { cwd: api, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const { createPrismaClient } = await import('@robucca/db');
  db = createPrismaClient(URL_);
});

after(async () => {
  server?.kill();
  await db?.$disconnect();
});

const skip = !URL_ && 'TEST_DATABASE_URL belum diisi';

test('pairing: kode salah ditolak, kode benar memberi token sekali pakai', { skip }, async () => {
  assert.equal((await call('POST', '/pos/pair', { code: '000000' })).status, 400);
  const r = await call('POST', '/pos/pair', { code: ids.code, name: 'Kasir tes' });
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^dev_/);
  device = r.body.token;
  assert.equal((await call('POST', '/pos/pair', { code: ids.code })).status, 400, 'kode sekali pakai');
  assert.equal((await call('GET', '/pos/master')).status, 401);
});

test('master: menu cabang, staf dengan hash PIN, ETag', { skip }, async () => {
  const r = await fetch(base + '/pos/master', { headers: dev() });
  assert.equal(r.status, 200);
  master = (await r.json()).master;
  assert.equal(master.branch.code, 'IJN');
  assert.equal(master.menu.reduce((a, c) => a + c.products.length, 0), 95);
  assert.ok(master.staff.find((s) => s.name === 'Sari').pinHash.startsWith('$2'));
  // Hash PIN penyetuju (manajer/pemilik) tidak dikirim ke perangkat: hanya bisa login & menyetujui saat online.
  const dewi = master.staff.find((s) => s.name === 'Dewi');
  assert.equal(dewi.pinHash, null);
  assert.equal(dewi.onlineOnly, true);
  assert.equal(master.staff.find((s) => s.name === 'Pemilik (demo)').pinHash, null);
  assert.equal(master.staff.find((s) => s.name === 'Sari').onlineOnly, false);
  const again = await fetch(base + '/pos/master', { headers: { ...dev(), 'if-none-match': r.headers.get('etag') } });
  assert.equal(again.status, 304);
});

test('login PIN: salah ditolak, benar memberi sesi', { skip }, async () => {
  const sari = master.staff.find((s) => s.name === 'Sari');
  ids.sari = sari.id;
  ids.dewi = master.staff.find((s) => s.name === 'Dewi').id;
  assert.equal((await call('POST', '/pos/login', { userId: sari.id, pin: '9999' }, dev())).status, 401);
  const r = await call('POST', '/pos/login', { userId: sari.id, pin: '3333' }, dev());
  assert.equal(r.status, 200);
  cashierSession = r.body.session;
});

const product = (slug) => master.menu.flatMap((c) => c.products).find((p) => p.slug === slug);
const optionId = (p, name) => p.modifierGroups.flatMap((g) => g.options).find((o) => o.name === name).id;
let seq = 0;
const run = Math.floor(Math.random() * 9000) + 1000;
const order = (over = {}) => {
  seq += 1;
  const latte = product('kopi-susu-essentials');
  return {
    id: randomUUID(), number: `IJN1-${run}${String(seq).padStart(2, '0')}-${String(seq).padStart(4, '0')}`, queueNumber: String(seq).padStart(3, '0'),
    type: 'TAKEAWAY', channelCode: 'takeaway', status: 'PAID', createdAt: new Date().toISOString(), paidAt: new Date().toISOString(),
    cashierId: ids.sari, shiftId: ids.shift, version: 1,
    items: [{ id: randomUUID(), productId: latte.id, quantity: 2, unitPrice: latte.price, optionIds: [optionId(latte, 'Normal'), optionId(latte, 'Normal Ice')] }],
    payments: [{ id: randomUUID(), optionCode: 'cash', amount: latte.price * 2, tendered: 50000, at: new Date().toISOString() }],
    ...over,
  };
};

test('shift dibuka lewat sinkron', { skip }, async () => {
  ids.shift = randomUUID();
  const r = await call('POST', '/pos/sync', { shifts: [{ id: ids.shift, status: 'OPEN', openedAt: new Date().toISOString(), openingCash: 200000, openedById: ids.sari }] }, dev());
  assert.equal(r.body.shifts[0].status, 'saved');
});

test('pesanan lunas: total dihitung ulang server, sinkron ulang tidak dobel, stok BoM terpotong', { skip }, async () => {
  const latte = product('kopi-susu-essentials');
  // Resep: 18 g kopi + 150 ml susu per cup
  const kopi = await db.inventoryItem.create({ data: { sku: `KOPI-${run}`, name: 'Biji kopi', unit: 'GRAM' } });
  const susu = await db.inventoryItem.create({ data: { sku: `SUSU-${run}`, name: 'Susu', unit: 'MILLILITER' } });
  await db.recipe.deleteMany({ where: { productId: latte.id } });
  await db.recipe.create({ data: { productId: latte.id, lines: { create: [{ inventoryItemId: kopi.id, quantity: 18 }, { inventoryItemId: susu.id, quantity: 150 }] } } });
  const o = order();
  ids.paid = o;
  const r = await call('POST', '/pos/sync', { orders: [o] }, dev());
  assert.deepEqual(r.body.orders, [{ id: o.id, status: 'saved' }]);
  const again = await call('POST', '/pos/sync', { orders: [o] }, dev());
  assert.equal(again.body.orders[0].status, 'duplicate');
  const saved = await db.order.findUnique({ where: { id: o.id }, include: { items: { include: { modifiers: true } }, payments: true } });
  assert.equal(saved.total, 48000);
  assert.equal(saved.taxTotal, 4364); // PB1 10% termasuk harga
  assert.equal(saved.items[0].productName, 'Kopi Susu Essentials');
  assert.equal(saved.payments[0].changeAmount, 2000);
  const stock = await db.inventoryStock.findMany({ where: { branchId: master.branch.id } });
  assert.equal(Number(stock.find((s) => s.inventoryItemId === kopi.id).quantity), -36);
  assert.equal(Number(stock.find((s) => s.inventoryItemId === susu.id).quantity), -300);
});

test('ditolak: total/bayar tidak cocok, opsi asing, kanal ojol tanpa kanal, diskon besar tanpa PIN', { skip }, async () => {
  const latte = product('kopi-susu-essentials');
  const other = product('kopi-kelapa');
  const bad = [
    order({ payments: [{ id: randomUUID(), optionCode: 'cash', amount: 1000, tendered: 1000, at: new Date().toISOString() }] }),
    order({ items: [{ id: randomUUID(), productId: latte.id, quantity: 1, unitPrice: latte.price, optionIds: [randomUUID()] }] }),
    order({ type: 'FOOD_PLATFORM', channelCode: 'takeaway' }),
    order({ status: 'OPEN', payments: [], paidAt: undefined, discount: { type: 'PERCENT', value: 5000 } }),
    order({ payments: [{ id: randomUUID(), optionCode: 'debit', amount: latte.price * 2, at: new Date().toISOString() }] }),
  ];
  const r = await call('POST', '/pos/sync', { orders: bad }, dev());
  assert.deepEqual(r.body.orders.map((x) => x.status), ['rejected', 'rejected', 'rejected', 'rejected', 'rejected'], JSON.stringify(r.body.orders));
  assert.match(r.body.orders[3].errors[0], /persetujuan manajer/);
  assert.match(r.body.orders[4].errors[0], /referensi/);
  assert.ok(other);
});

test('diskon besar disetujui manajer lewat PIN (token persetujuan)', { skip }, async () => {
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'discount.approve' }, ses());
  assert.equal(appr.status, 200);
  assert.equal(appr.body.approver.name, 'Dewi');
  assert.equal((await call('POST', '/pos/approve', { pin: '3333', permission: 'discount.approve' }, ses())).status, 401, 'kasir tidak bisa menyetujui');
  const latte = product('kopi-susu-essentials');
  const o = order({ discount: { type: 'PERCENT', value: 5000 }, payments: [{ id: randomUUID(), optionCode: 'qris', amount: latte.price, at: new Date().toISOString() }], discountApproval: appr.body.approval });
  const r = await call('POST', '/pos/sync', { orders: [o] }, dev());
  assert.equal(r.body.orders[0].status, 'saved', JSON.stringify(r.body.orders));
  const saved = await db.order.findUnique({ where: { id: o.id } });
  assert.equal(saved.discountApprovedById, ids.dewi);
});

test('persetujuan offline (hanya ID manajer, tanpa token server) ditolak; token hanya untuk satu pesanan', { skip }, async () => {
  const latte = product('kopi-susu-essentials');
  const pays = () => [{ id: randomUUID(), optionCode: 'qris', amount: latte.price, at: new Date().toISOString() }];
  const off = order({ discount: { type: 'PERCENT', value: 5000 }, payments: pays(), discountApprovedById: ids.dewi });
  const r = await call('POST', '/pos/sync', { orders: [off] }, dev());
  assert.equal(r.body.orders[0].status, 'rejected');
  assert.match(r.body.orders[0].errors[0], /offline tidak diterima/);
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'discount.approve' }, ses());
  const a = order({ discount: { type: 'PERCENT', value: 5000 }, payments: pays(), discountApproval: appr.body.approval });
  const ra = await call('POST', '/pos/sync', { orders: [a] }, dev());
  assert.equal(ra.body.orders[0].status, 'saved', JSON.stringify(ra.body) + JSON.stringify(appr));
  const b = order({ discount: { type: 'PERCENT', value: 5000 }, payments: pays(), discountApproval: appr.body.approval });
  const reuse = await call('POST', '/pos/sync', { orders: [b] }, dev());
  assert.equal(reuse.body.orders[0].status, 'rejected');
  assert.match(reuse.body.orders[0].errors[0], /sudah dipakai/);
});

test('shift kedua untuk terminal yang sama ditolak; shift terbuka bisa dipulihkan perangkat', { skip }, async () => {
  const dup = randomUUID();
  const r = await call('POST', '/pos/sync', { shifts: [{ id: dup, status: 'OPEN', openedAt: new Date().toISOString(), openingCash: 100000, openedById: ids.sari }] }, dev());
  assert.equal(r.body.shifts[0].status, 'rejected');
  assert.match(r.body.shifts[0].errors[0], /masih punya shift terbuka/);
  const open = await call('GET', '/pos/shift/open', null, dev());
  assert.equal(open.status, 200);
  assert.equal(open.body.shift.id, ids.shift);
  assert.equal(open.body.shift.openingCash, 200000);
});

test('tagihan terbuka diubah di versi berikut; versi lama = konflik; status dapur dipertahankan', { skip }, async () => {
  const latte = product('kopi-susu-essentials');
  const o = order({ status: 'OPEN', payments: [], paidAt: undefined, type: 'DINE_IN', channelCode: 'dinein', tableNumber: '7' });
  o.items[0].sentToKitchenAt = new Date().toISOString();
  assert.equal((await call('POST', '/pos/sync', { orders: [o] }, dev())).body.orders[0].status, 'saved');
  await call('POST', '/pos/sync', { kitchen: [{ orderId: o.id, itemId: o.items[0].id, done: true, at: new Date().toISOString() }] }, dev());
  const v2 = { ...o, version: 2, items: [...o.items, { id: randomUUID(), productId: latte.id, quantity: 1, unitPrice: latte.price, optionIds: [] }] };
  assert.equal((await call('POST', '/pos/sync', { orders: [v2] }, dev())).body.orders[0].status, 'saved');
  const items = await db.orderItem.findMany({ where: { orderId: o.id }, orderBy: { kitchenStatus: 'asc' } });
  assert.deepEqual(items.map((i) => i.kitchenStatus).sort(), ['DONE', 'QUEUED']);
  assert.equal((await call('POST', '/pos/sync', { orders: [v2] }, dev())).body.orders[0].status, 'duplicate');
  const stale = await call('POST', '/pos/sync', { orders: [{ ...o, version: 1, note: 'lama' }] }, dev());
  assert.equal(stale.body.orders[0].status, 'conflict');
  assert.equal(stale.body.orders[0].version, 2);
  const feed = await call('GET', '/pos/feed', null, dev());
  assert.ok(feed.body.orders.some((x) => x.id === o.id && x.items.length === 2));
});

test('void pesanan lunas butuh PIN manajer dan mengembalikan stok', { skip }, async () => {
  const o = ids.paid;
  const kopi = await db.inventoryItem.findUnique({ where: { sku: `KOPI-${run}` } });
  const level = async () => Number((await db.inventoryStock.findUnique({ where: { branchId_inventoryItemId: { branchId: master.branch.id, inventoryItemId: kopi.id } } })).quantity);
  const before = await level();
  const noAppr = await call('POST', '/pos/sync', { orders: [{ ...o, version: 2, status: 'VOIDED', voidReason: 'Salah input' }] }, dev());
  assert.equal(noAppr.body.orders[0].status, 'rejected');
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'order.void.approve' }, ses());
  const r = await call('POST', '/pos/sync', { orders: [{ ...o, version: 2, status: 'VOIDED', voidReason: 'Salah input', voidApproval: appr.body.approval }] }, dev());
  assert.equal(r.body.orders[0].status, 'saved', JSON.stringify(r.body));
  assert.equal(await level(), before + 36);
  assert.ok(await db.auditLog.findFirst({ where: { action: 'order.void', entityId: o.id } }));
});

test('refund: kasir butuh persetujuan, hanya sekali', { skip }, async () => {
  const o = order();
  await call('POST', '/pos/sync', { orders: [o] }, dev());
  assert.equal((await call('POST', `/orders/${o.id}/refund`, { reason: 'Pelanggan komplain' }, ses())).status, 403);
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'order.refund.approve' }, ses());
  const r = await call('POST', `/orders/${o.id}/refund`, { reason: 'Pelanggan komplain', approval: appr.body.approval }, ses());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const again = await call('POST', `/orders/${o.id}/refund`, { reason: 'Lagi', approval: appr.body.approval }, ses());
  assert.equal(again.status, 409);
});

test('jenis token: token persetujuan / token lain tidak bisa dipakai sebagai sesi staf', { skip }, async () => {
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'order.void.approve' }, ses());
  assert.equal(appr.status, 200);
  // Token persetujuan (sub = manajer, dev = perangkat ini) bukan sesi: tidak memberi akses manajer.
  assert.equal((await call('GET', '/auth/me', null, { ...dev(), 'x-session': appr.body.approval })).status, 401);
  assert.equal((await call('GET', '/office/me', null, { ...dev(), 'x-session': appr.body.approval })).status, 401);
  // Sesi kasir bukan token persetujuan.
  const o = order({ status: 'OPEN', paidAt: undefined, payments: [] });
  await call('POST', '/pos/sync', { orders: [o] }, dev());
  const r = await call('POST', '/pos/sync', { orders: [{ ...o, version: 2, status: 'VOIDED', voidReason: 'Tes', voidApproval: cashierSession }] }, dev());
  assert.equal(r.body.orders[0].status, 'rejected');
});

test('pelaku dokumen: manajer sebagai kasir hanya dengan bukti login online di perangkat ini', { skip }, async () => {
  // Tanpa bukti sesi: kasir tidak bisa mengisi ID manajer (lalu "menyetujui sendiri" void/diskon).
  const asDewi = order({ cashierId: ids.dewi });
  const r = await call('POST', '/pos/sync', { orders: [asDewi] }, dev());
  assert.equal(r.body.orders[0].status, 'rejected');
  assert.match(r.body.orders[0].errors[0], /login online/);
  const voidSelf = await call('POST', '/pos/sync', { orders: [{ ...order({ cashierId: ids.dewi }), status: 'VOIDED', voidReason: 'Iseng', paidAt: undefined }] }, dev());
  assert.equal(voidSelf.body.orders[0].status, 'rejected');
  // Kas & shift atas nama manajer juga ditolak tanpa bukti.
  const cash = await call('POST', '/pos/sync', { cashMovements: [{ id: randomUUID(), shiftId: ids.shift, type: 'CASH_OUT', amount: 5000, reason: 'Tes', createdById: ids.dewi, createdAt: new Date().toISOString() }] }, dev());
  assert.equal(cash.body.cashMovements[0].status, 'rejected');
  // Log dengan pelaku manajer tanpa bukti: pelaku dikosongkan, klaim disimpan.
  await call('POST', '/pos/sync', { audit: [{ action: 'tes.klaim', actorId: ids.dewi, at: new Date().toISOString(), detail: { run } }] }, dev());
  const log = await db.auditLog.findFirst({ where: { action: 'pos.tes.klaim' }, orderBy: { createdAt: 'desc' } });
  assert.equal(log.actorId, null);
  assert.equal(log.detail.claimedActorId, ids.dewi);
  // Dengan sesi Dewi dari /pos/login di perangkat ini: diterima.
  const login = await call('POST', '/pos/login', { userId: ids.dewi, pin: '2222' }, dev());
  assert.equal(login.status, 200);
  const ok = await call('POST', '/pos/sync', { orders: [order({ cashierId: ids.dewi })], staffSessions: [login.body.session] }, dev());
  assert.equal(ok.body.orders[0].status, 'saved', JSON.stringify(ok.body));
  // Sesi kasir lain / sesi perangkat lain tidak membuktikan Dewi.
  const wrong = await call('POST', '/pos/sync', { orders: [order({ cashierId: ids.dewi })], staffSessions: [cashierSession] }, dev());
  assert.equal(wrong.body.orders[0].status, 'rejected');
});

test('void tagihan belum lunas & item yang sudah dikirim ke dapur butuh persetujuan manajer', { skip }, async () => {
  const latte = product('kopi-susu-essentials');
  const sentAt = new Date().toISOString();
  const line = (over = {}) => ({ id: randomUUID(), productId: latte.id, quantity: 1, unitPrice: latte.price, optionIds: [optionId(latte, 'Normal'), optionId(latte, 'Normal Ice')], ...over });
  const a = line({ sentToKitchenAt: sentAt });
  const b = line({ sentToKitchenAt: sentAt });
  const o = order({ status: 'OPEN', paidAt: undefined, payments: [], items: [a, b] });
  assert.equal((await call('POST', '/pos/sync', { orders: [o] }, dev())).body.orders[0].status, 'saved');
  // Item terkirim dibatalkan tanpa persetujuan → ditolak.
  const voidedA = { ...a, voided: { reason: 'Pelanggan batal', at: new Date().toISOString() } };
  const no = await call('POST', '/pos/sync', { orders: [{ ...o, version: 2, items: [voidedA, b] }] }, dev());
  assert.equal(no.body.orders[0].status, 'rejected');
  assert.match(no.body.orders[0].errors[0], /dapur butuh persetujuan/);
  // Dengan token persetujuan → diterima, penyetuju tercatat.
  const appr = await call('POST', '/pos/approve', { pin: '2222', permission: 'order.void.approve' }, ses());
  const yes = await call('POST', '/pos/sync', { orders: [{ ...o, version: 2, items: [{ ...voidedA, voided: { ...voidedA.voided, byId: ids.dewi, approval: appr.body.approval } }, b] }] }, dev());
  assert.equal(yes.body.orders[0].status, 'saved', JSON.stringify(yes.body));
  const item = await db.orderItem.findUnique({ where: { id: a.id } });
  assert.ok(item.voidedAt);
  assert.equal(item.voidedById, ids.dewi);
  // Versi berikut tanpa token: item yang sudah batal tidak dicek ulang.
  const v3 = await call('POST', '/pos/sync', { orders: [{ ...o, version: 3, items: [{ ...voidedA }, b], note: 'tambah catatan' }] }, dev());
  assert.equal(v3.body.orders[0].status, 'saved', JSON.stringify(v3.body));
  // Membatalkan seluruh tagihan (belum lunas) tanpa persetujuan → ditolak; dengan token → diterima.
  const noVoid = await call('POST', '/pos/sync', { orders: [{ ...o, version: 4, items: [voidedA, b], status: 'VOIDED', voidReason: 'Pelanggan pergi' }] }, dev());
  assert.equal(noVoid.body.orders[0].status, 'rejected');
  const appr2 = await call('POST', '/pos/approve', { pin: '2222', permission: 'order.void.approve' }, ses());
  const okVoid = await call('POST', '/pos/sync', { orders: [{ ...o, version: 4, items: [voidedA, b], status: 'VOIDED', voidReason: 'Pelanggan pergi', voidApproval: appr2.body.approval }] }, dev());
  assert.equal(okVoid.body.orders[0].status, 'saved', JSON.stringify(okVoid.body));
});

test('kas keluar & tutup shift: kas seharusnya dihitung server', { skip }, async () => {
  await call('POST', '/pos/sync', { cashMovements: [{ id: randomUUID(), shiftId: ids.shift, type: 'CASH_OUT', amount: 10000, reason: 'Beli es batu', createdById: ids.sari, createdAt: new Date().toISOString() }] }, dev());
  const r = await call('POST', '/pos/sync', { shifts: [{ id: ids.shift, status: 'CLOSED', openedAt: new Date().toISOString(), openingCash: 200000, openedById: ids.sari, closedAt: new Date().toISOString(), closedById: ids.sari, countedCash: 238000, countedDenominations: { 100000: 2, 20000: 1, 10000: 1, 5000: 1, 2000: 1, 1000: 1 } }] }, dev());
  assert.equal(r.body.shifts[0].status, 'saved');
  const s = await db.shift.findUnique({ where: { id: ids.shift } });
  // 200.000 + tunai lunas (pesanan pertama di-void, pesanan refund 48.000 dikurangi refundnya) − 10.000
  const cash = await db.payment.aggregate({ where: { shiftId: ids.shift, method: 'CASH', order: { status: { in: ['PAID', 'REFUNDED'] } } }, _sum: { amount: true } });
  const ref = await db.refund.aggregate({ where: { shiftId: ids.shift }, _sum: { amount: true } });
  assert.equal(s.expectedCash, 200000 + cash._sum.amount - 10000 - (ref._sum.amount ?? 0));
});
