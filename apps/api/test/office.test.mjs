/* Tes integrasi API kantor (/office/*) terhadap PostgreSQL sungguhan.
   Database: OFFICE_TEST_DATABASE_URL, atau turunan TEST_DATABASE_URL dengan nama "<nama>_office"
   (dibuat otomatis bila belum ada) agar tidak bentrok dengan pos.test.mjs yang berjalan paralel.
   Migrasi (deploy) & seed demo dijalankan otomatis; tes menambah data, tidak menghapus apa pun. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '..');
const dbPkg = path.resolve(here, '../../../packages/db');

function officeUrl() {
  if (process.env.OFFICE_TEST_DATABASE_URL) return process.env.OFFICE_TEST_DATABASE_URL;
  const src = process.env.TEST_DATABASE_URL;
  if (!src) return null;
  const u = new URL(src);
  const name = u.pathname.replace(/^\//, '');
  u.pathname = `/${name}_office`;
  return { url: u.toString(), name: `${name}_office`, admin: src };
}
const target = officeUrl();
const URL_ = typeof target === 'string' ? target : target?.url;
const PORT = 3260 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATABASE_URL: URL_, AUTH_SECRET: 'tes-rahasia-yang-panjangnya-lebih-dari-32-karakter', PORT: String(PORT) };

let server; let db; let device; let master; const ses = {}; const ids = {};
const run = Math.floor(Math.random() * 9000) + 1000;

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, body: data, headers: r.headers };
};
const dev = () => ({ 'x-device-token': device });
const as = (who) => ({ ...dev(), 'x-session': ses[who] });
const get = (who, p) => call('GET', p, null, as(who));
const pullMaster = async () => (await call('GET', '/pos/master', null, dev())).body.master;
const product = (m, slug) => m.menu.flatMap((c) => c.products).find((p) => p.slug === slug);
/** Buat staf dengan PIN acak yang belum dipakai di cabangnya (data putaran tes sebelumnya tetap ada). */
const mkStaff = async (who, body) => {
  for (let i = 0; i < 30; i++) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    if (['1111', '2222', '3333', '4444'].includes(pin)) continue;
    const r = await call('POST', '/office/staff', { ...body, pin }, as(who));
    if (r.status !== 409) return { ...r, pin };
  }
  throw new Error('tidak menemukan PIN kosong');
};
const optionId = (p, name) => p.modifierGroups.flatMap((g) => g.options).find((o) => o.name === name).id;

before(async () => {
  if (!URL_) return;
  if (typeof target === 'object') {
    const { createPrismaClient } = await import('@robucca/db');
    const admin = createPrismaClient(target.admin);
    const exists = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', target.name);
    if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${target.name.replace(/"/g, '')}"`);
    await admin.$disconnect();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbPkg, env, stdio: 'ignore' });
  execFileSync('node', ['dist/seed/index.js'], { cwd: dbPkg, env: { ...env, SEED_DEMO: '1' }, stdio: 'ignore' });
  const { createPrismaClient } = await import('@robucca/db');
  db = createPrismaClient(URL_);
  // Terminal tes sendiri; shift terbuka dari putaran tes sebelumnya ditutup dulu.
  await db.shift.updateMany({ where: { status: 'OPEN', device: { terminalNo: 9, branch: { code: 'IJN' } } }, data: { status: 'CLOSED', closedAt: new Date(), countedCash: 0 } });
  const out = execFileSync('node', ['dist/cli/pair.js', '--branch', 'IJN', '--terminal', '9', '--name', 'Kasir tes kantor'], { cwd: api, env }).toString();
  const code = out.match(/(\d{6})/)[1];
  server = spawn('node', ['dist/main.js'], { cwd: api, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  device = (await call('POST', '/pos/pair', { code })).body.token;
  master = await pullMaster();
  ids.ijn = master.branch.id;
  ids.cb2 = (await db.branch.findUnique({ where: { code: 'CB2' } })).id;
  for (const [who, name, pin] of [['owner', 'Pemilik (demo)', '1111'], ['dewi', 'Dewi', '2222'], ['sari', 'Sari', '3333']]) {
    const s = master.staff.find((x) => x.name === name);
    ids[who] = s.id;
    const r = await call('POST', '/pos/login', { userId: s.id, pin }, dev());
    assert.equal(r.status, 200, `login ${name}`);
    ses[who] = r.body.session;
  }
});

after(async () => {
  server?.kill();
  await db?.$disconnect();
});

const skip = !URL_ && 'TEST_DATABASE_URL belum diisi';

test('hak akses & cakupan cabang', { skip }, async () => {
  assert.equal((await get('sari', '/office/dashboard')).status, 403, 'kasir tidak membuka kantor');
  assert.equal((await call('GET', '/office/dashboard', null, dev())).status, 401, 'tanpa sesi');
  const me = await get('dewi', '/office/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.branches.map((b) => b.code), ['IJN']);
  assert.equal(me.body.allBranches, false);
  assert.equal((await get('owner', '/office/me')).body.branches.length, 4);
  assert.equal((await get('dewi', `/office/dashboard?branchId=${ids.cb2}`)).status, 403, 'manajer tidak melihat cabang lain');
  assert.equal((await get('dewi', `/office/stock?branchId=${ids.cb2}`)).status, 403);
  const branches = await get('dewi', '/office/branches');
  assert.deepEqual(branches.body.map((b) => b.code), ['IJN']);
  const latte = product(master, 'kopi-susu-essentials');
  assert.equal((await call('PATCH', `/office/products/${latte.id}`, { basePrice: 1000 }, as('dewi'))).status, 403, 'manajer tidak mengubah menu/harga pusat');
  assert.equal((await call('PUT', `/office/products/${latte.id}/branches/${ids.ijn}`, { priceOverride: 1000 }, as('dewi'))).status, 403, 'harga cabang butuh price.manage');
  assert.equal((await call('PATCH', '/office/settings', { kdsWarnMinutes: 9 }, as('dewi'))).status, 403);
  assert.equal((await call('PATCH', `/office/branches/${ids.ijn}`, { taxRateBp: 1100 }, as('dewi'))).status, 403);
  // ketersediaan menu cabang boleh untuk manajer
  const av = await call('PUT', `/office/products/${latte.id}/branches/${ids.ijn}`, { isAvailable: true }, as('dewi'));
  assert.equal(av.status, 200, JSON.stringify(av.body));
  // perangkat: manajer hanya cabangnya
  const devs = await get('dewi', '/office/devices');
  assert.ok(devs.body.length && devs.body.every((d) => d.branchId === ids.ijn));
  assert.equal((await call('POST', '/office/devices', { branchId: ids.cb2, terminalNo: 5, name: 'x' }, as('dewi'))).status, 403);
  assert.equal((await call('POST', '/devices', { branchCode: 'CB2', terminalNo: 5, name: 'x' }, as('dewi'))).status, 403, 'rute lama /devices juga dibatasi');
  // validasi DTO
  assert.equal((await call('POST', '/office/inventory-items', { sku: 'x', name: '', unit: 'KG' }, as('owner'))).status, 400);
});

test('perubahan harga cabang sampai ke /pos/master dan memicu event master', { skip }, async () => {
  const latte = product(master, 'kopi-susu-essentials');
  ids.latte = latte.id;
  // dengarkan SSE perangkat
  const ctrl = new AbortController();
  const events = [];
  const res = await fetch(`${base}/pos/stream?device=${encodeURIComponent(device)}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const reading = (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(dec.decode(value));
      }
    } catch { /* dihentikan */ }
  })();
  await new Promise((r) => setTimeout(r, 200));
  const r = await call('PUT', `/office/products/${latte.id}/branches/${ids.ijn}`, { priceOverride: 25000 }, as('owner'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await new Promise((r2) => setTimeout(r2, 300));
  ctrl.abort();
  await reading;
  assert.ok(events.join('').includes('event: master'), 'event master dikirim ke perangkat cabang');
  master = await pullMaster();
  assert.equal(product(master, 'kopi-susu-essentials').price, 25000);
  const log = await get('owner', '/office/audit?action=menu.price.branch&preset=today');
  assert.ok(log.body.rows.some((a) => a.entityId === latte.id && a.actorName === 'Pemilik (demo)' && a.detail.to === 25000));
});

test('stok: bahan baru, stok masuk, opname, transfer antarcabang, menipis, riwayat', { skip }, async () => {
  const it = await call('POST', '/office/inventory-items', { sku: `CROI-${run}`, name: 'Croissant jadi', unit: 'PIECE' }, as('owner'));
  assert.equal(it.status, 201, JSON.stringify(it.body));
  ids.item = it.body.id;
  assert.equal((await call('POST', '/office/inventory-items', { sku: `X-${run}`, name: 'x', unit: 'PIECE' }, as('dewi'))).status, 403, 'bahan baku pusat hanya pemilik');
  const inn = await call('POST', '/office/stock/in', { branchId: ids.ijn, lines: [{ inventoryItemId: ids.item, quantity: 50 }], note: 'kiriman pusat' }, as('dewi'));
  assert.equal(inn.status, 201, JSON.stringify(inn.body));
  assert.equal(inn.body.lines[0].after, 50);
  const op = await call('POST', '/office/stock/opname', { branchId: ids.ijn, lines: [{ inventoryItemId: ids.item, counted: 47 }] }, as('dewi'));
  assert.equal(op.status, 201);
  assert.equal(op.body.lines[0].difference, -3);
  assert.equal((await call('POST', '/office/stock/transfer', { fromBranchId: ids.cb2, toBranchId: ids.ijn, lines: [{ inventoryItemId: ids.item, quantity: 1 }] }, as('dewi'))).status, 403);
  const tr = await call('POST', '/office/stock/transfer', { fromBranchId: ids.ijn, toBranchId: ids.cb2, lines: [{ inventoryItemId: ids.item, quantity: 10 }] }, as('dewi'));
  assert.equal(tr.status, 201, JSON.stringify(tr.body));
  const lv = async (b) => (await get('owner', `/office/stock?branchId=${b}`)).body.rows.find((r) => r.inventoryItemId === ids.item);
  assert.equal((await lv(ids.ijn)).quantity, 37);
  assert.equal((await lv(ids.cb2)).quantity, 10);
  assert.equal((await call('PUT', `/office/stock/${ids.ijn}/${ids.item}/reorder-level`, { reorderLevel: 40 }, as('dewi'))).status, 200);
  const low = await get('dewi', '/office/stock/low');
  assert.ok(low.body.some((r) => r.inventoryItemId === ids.item && r.status === 'LOW'));
  assert.ok(low.body.every((r) => r.branchId === ids.ijn), 'manajer hanya melihat cabangnya');
  const mv = await get('owner', `/office/stock/movements?inventoryItemId=${ids.item}`);
  assert.deepEqual(mv.body.rows.map((m) => m.type).sort(), ['ADJUSTMENT', 'PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT']);
  const audit = await get('dewi', '/office/audit?preset=today&action=stock.');
  assert.deepEqual([...new Set(audit.body.rows.map((a) => a.action))].sort(), ['stock.adjust', 'stock.receive', 'stock.reorder_level', 'stock.transfer']);
});

test('resep (BoM): simpan, baca, hapus', { skip }, async () => {
  const pastry = product(master, 'kopi-kelapa');
  const r = await call('PUT', `/office/products/${pastry.id}/recipe`, { lines: [{ inventoryItemId: ids.item, quantity: 1 }], note: 'tes' }, as('owner'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.lines[0].quantity, 1);
  assert.equal((await call('PUT', `/office/products/${pastry.id}/recipe`, { lines: [{ inventoryItemId: ids.item, quantity: -1 }] }, as('owner'))).status, 400);
  assert.equal((await get('owner', `/office/products/${pastry.id}/recipe`)).body.lines.length, 1);
  assert.equal((await call('DELETE', `/office/products/${pastry.id}/recipe`, null, as('owner'))).status, 200);
});

test('karyawan baru (PIN bcrypt) lalu masuk di POS; manajer hanya kasir/dapur di cabangnya', { skip }, async () => {
  assert.equal((await call('POST', '/office/staff', { name: 'Manajer X', role: 'BRANCH_MANAGER', branchIds: [ids.ijn], pin: '8765' }, as('dewi'))).status, 403);
  assert.equal((await call('POST', '/office/staff', { name: 'Kasir CB2', role: 'CASHIER', branchIds: [ids.cb2], pin: '8765' }, as('dewi'))).status, 403);
  assert.equal((await call('POST', '/office/staff', { name: 'Kasir dobel', role: 'CASHIER', branchIds: [ids.ijn], pin: '3333' }, as('dewi'))).status, 409, 'PIN sama dengan Sari');
  const r = await mkStaff('dewi', { name: `Budi ${run}`, role: 'CASHIER', branchIds: [ids.ijn] });
  const { pin } = r;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.hasPin, true);
  ids.budi = r.body.id;
  const u = await db.user.findUnique({ where: { id: ids.budi } });
  assert.match(u.pinHash, /^\$2[aby]\$/);
  master = await pullMaster();
  assert.ok(master.staff.some((s) => s.id === ids.budi && s.pinHash), 'kasir baru ada di master perangkat (boleh login offline)');
  const login = await call('POST', '/pos/login', { userId: ids.budi, pin }, dev());
  assert.equal(login.status, 200);
  ses.budi = login.body.session;
  // nonaktifkan → tidak bisa masuk lagi
  const tmp = await mkStaff('owner', { name: `Sementara ${run}`, role: 'KITCHEN', branchIds: [ids.ijn] });
  assert.equal(tmp.status, 201);
  assert.equal((await call('DELETE', `/office/staff/${tmp.body.id}`, null, as('dewi'))).status, 200);
  assert.equal((await call('POST', '/pos/login', { userId: tmp.body.id, pin: tmp.pin }, dev())).status, 401);
  // login dasbor email/password (sesi tanpa perangkat)
  const email = `kantor${run}@robucca.test`;
  const mgr = await mkStaff('owner', { name: `Area ${run}`, role: 'BRANCH_MANAGER', branchIds: [ids.ijn, ids.cb2], email, password: 'rahasia-kantor-1' });
  assert.equal(mgr.status, 201, JSON.stringify(mgr.body));
  const pw = await call('POST', '/auth/login', { email, password: 'rahasia-kantor-1' });
  assert.equal(pw.status, 200);
  const me = await call('GET', '/office/me', null, { 'x-session': pw.body.session });
  assert.deepEqual(me.body.branches.map((b) => b.code).sort(), ['CB2', 'IJN']);
  const staffList = await get('dewi', '/office/staff');
  assert.ok(staffList.body.every((s) => s.role.code !== 'SUPER_ADMIN'));
});

test('promo cabang dengan PIN manajer sampai ke master; promo semua cabang khusus pemilik', { skip }, async () => {
  assert.equal((await call('POST', '/office/promos', { name: 'Semua', type: 'PERCENT', value: 1000, allBranches: true }, as('dewi'))).status, 403);
  const r = await call('POST', '/office/promos', { name: `Member ${run}`, type: 'PERCENT', value: 1500, branchIds: [ids.ijn], requiresApproval: true }, as('dewi'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  ids.promo = r.body.id;
  master = await pullMaster();
  const p = master.promotions.find((x) => x.id === ids.promo);
  assert.ok(p && p.requiresApproval && p.value === 1500);
  const list = await get('dewi', '/office/promos');
  assert.ok(list.body.some((x) => x.id === ids.promo));
});

test('dasbor & laporan cocok dengan pesanan tersinkron; transaksi & shift dengan pecahan & selisih', { skip }, async () => {
  const q = `?branchId=${ids.ijn}&preset=today`;
  const before = (await get('owner', `/office/dashboard${q}`)).body;
  assert.equal(before.current.hours.length, 24);
  ids.shift = randomUUID();
  const now = new Date().toISOString();
  const sh = await call('POST', '/pos/sync', { shifts: [{ id: ids.shift, status: 'OPEN', openedAt: now, openingCash: 100000, openedById: ids.budi }] }, dev());
  assert.equal(sh.body.shifts[0].status, 'saved', JSON.stringify(sh.body));
  const latte = product(master, 'kopi-susu-essentials');
  const order = {
    id: randomUUID(), number: `IJN9-${run}01-0001`, queueNumber: '901', type: 'TAKEAWAY', channelCode: 'takeaway', status: 'PAID', createdAt: now, paidAt: now,
    cashierId: ids.budi, shiftId: ids.shift, version: 1,
    items: [{ id: randomUUID(), productId: latte.id, quantity: 2, unitPrice: 25000, optionIds: [optionId(latte, 'Normal'), optionId(latte, 'Normal Ice')] }],
    payments: [{ id: randomUUID(), optionCode: 'cash', amount: 50000, tendered: 50000, at: now }],
  };
  const r = await call('POST', '/pos/sync', { orders: [order] }, dev());
  assert.equal(r.body.orders[0].status, 'saved', JSON.stringify(r.body));
  const after = (await get('owner', `/office/dashboard${q}`)).body;
  assert.equal(after.current.kpi.total - before.current.kpi.total, 50000, 'omzet dasbor naik sebesar pesanan');
  assert.equal(after.current.kpi.orders - before.current.kpi.orders, 1);
  assert.ok(after.topItems.some((i) => i.id === latte.id));
  assert.ok(after.current.payments.some((p) => p.code === 'cash'));
  assert.ok(after.current.channels.some((c) => c.code === 'takeaway'));
  assert.ok('deltaPct' in after.comparison && after.prevRange.to < after.range.from);
  // manajer melihat angka cabangnya yang sama
  assert.equal((await get('dewi', '/office/dashboard?preset=today')).body.current.kpi.total, after.current.kpi.total);
  const rep = await get('owner', `/office/reports${q}`);
  assert.equal(rep.body.kpi.total, after.current.kpi.total);
  assert.ok(rep.body.cashiers.some((c) => c.id === ids.budi && c.total === 50000));
  // CSV
  const csv = await fetch(`${base}/office/reports${q}&view=items&format=csv`, { headers: as('owner') });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text();
  assert.ok(text.includes('Menu;Kategori;Terjual') && text.includes(latte.name));
  // transaksi
  const tx = await get('dewi', `/office/transactions${q}&q=${order.number}`);
  assert.equal(tx.body.rows.length, 1);
  assert.equal(tx.body.rows[0].totals.total, 50000);
  const detail = await get('dewi', `/office/transactions/${order.id}`);
  assert.equal(detail.body.items.length, 1);
  assert.equal((await get('dewi', `/office/transactions?branchId=${ids.cb2}`)).status, 403);
  const txCsv = await fetch(`${base}/office/transactions${q}&format=csv`, { headers: as('owner') });
  assert.ok((await txCsv.text()).includes(order.number));
  // tutup shift dengan pecahan: kas seharusnya 150.000, dihitung 149.000
  const close = await call('POST', '/pos/sync', { shifts: [{ id: ids.shift, status: 'CLOSED', openedAt: now, openingCash: 100000, openedById: ids.budi, closedAt: new Date().toISOString(), closedById: ids.budi, countedCash: 149000, countedDenominations: { 100000: 1, 20000: 2, 5000: 1, 2000: 2 }, differenceNote: 'kurang seribu' }] }, dev());
  assert.equal(close.body.shifts[0].status, 'saved');
  const s = await get('dewi', `/office/shifts/${ids.shift}`);
  assert.equal(s.status, 200);
  assert.equal(s.body.expectedCash, 150000);
  assert.equal(s.body.difference, -1000);
  assert.equal(s.body.denominationsTotal, 149000);
  assert.deepEqual(s.body.denominations.map((d) => d.value), [100000, 20000, 5000, 2000]);
  assert.equal(s.body.orders.length, 1);
  const list = await get('dewi', '/office/shifts?preset=today');
  assert.ok(list.body.rows.some((x) => x.id === ids.shift && x.difference === -1000));
});

test('pengaturan, kanal & cabang oleh pemilik tercatat di log', { skip }, async () => {
  const s = await call('PATCH', '/office/settings', { kdsWarnMinutes: 7, kdsLateMinutes: 14 }, as('owner'));
  assert.equal(s.status, 200);
  assert.equal((await call('PATCH', '/office/settings', { kdsWarnMinutes: 20, kdsLateMinutes: 10 }, as('owner'))).status, 400);
  const st = await get('owner', '/office/settings');
  const gofood = st.body.channels.find((c) => c.code === 'gofood');
  assert.equal((await call('PATCH', `/office/channels/${gofood.id}`, { markupBp: 2000 }, as('owner'))).status, 200);
  assert.equal((await pullMaster()).channels.find((c) => c.code === 'gofood').markupBp, 2000);
  const b = await call('PATCH', `/office/branches/${ids.ijn}`, { serviceRateBp: 0, dayStartMinute: 0 }, as('owner'));
  assert.equal(b.status, 200);
  assert.equal((await call('PATCH', `/office/branches/${ids.ijn}`, { code: 'ZZZ' }, as('owner'))).status, 400, 'kode cabang terkunci setelah ada transaksi');
  const log = await get('owner', '/office/audit?preset=today');
  const acts = new Set(log.body.rows.map((a) => a.action));
  for (const a of ['settings.update', 'channel.markup.update', 'branch.update', 'staff.create', 'promo.create', 'inventory.create']) assert.ok(acts.has(a), a);
  assert.equal((await get('dewi', '/office/audit?central=true')).status, 403);
  // kembalikan harga cabang
  assert.equal((await call('PUT', `/office/products/${ids.latte}/branches/${ids.ijn}`, { priceOverride: null }, as('owner'))).status, 200);
  await call('PATCH', `/office/channels/${gofood.id}`, { markupBp: 0 }, as('owner'));
});
