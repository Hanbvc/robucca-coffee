/* Tes integrasi server pusat: perangkat, sesi, sinkronisasi, hak akses, laporan, SSE. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Store } from '../server/store.js';
import { createApp, bootstrap } from '../server/server.js';
import { hashPin } from '../pos/js/core/pin.js';
import { applyTotals, buildLine } from '../pos/js/core/calc.js';
import { uuid } from '../pos/js/core/ids.js';
import { bizDate } from '../pos/js/core/dates.js';

let store; let app; let server; let base; let boot;
const T = {}; // token & sesi

async function call(method, path, { body, token, session, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (session) h['X-Session'] = session;
  const r = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
const today = () => bizDate(Date.now(), 'Asia/Jakarta');

function makeOrder(branchId, over = {}) {
  const m = store.master();
  const item = m.items.find((i) => i.id === 'shoyu-ramen');
  const line = buildLine(item, {}, { id: 'l1', qty: 2, station: 'kitchen' });
  const now = Date.now();
  let o = {
    id: uuid(), kind: 'sale', status: 'paid', branchId, deviceId: 'x', terminalNo: 1, number: `IJN1-${today().slice(2).replace(/-/g, '')}-0001`, queueNo: '001',
    channel: 'dinein', channelName: 'Dine In', table: '5', customer: { name: '', phone: '' }, lines: [{ ...line, kAt: now }], discount: null,
    cashierId: 'st-k', cashierName: 'Kasir Uji', createdAt: now, paidAt: now, updatedAt: now, bizDate: today(), bizHour: 10, rev: 1, ...over,
  };
  o = applyTotals(o, { taxPct: 10, taxIncl: true, servicePct: 0, roundUnit: 100, roundMode: 'down' });
  o.payments = [{ method: 'cash', name: 'Tunai', type: 'cash', amount: o.totals.total, tendered: 100000 }];
  return o;
}

before(async () => {
  store = new Store(':memory:');
  boot = await bootstrap(store, { ownerPin: '246810', log: () => {} });
  app = createApp({ store, log: () => {} });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { app.close(); server.close(); store.close(); });

test('bootstrap: master awal, PIN pemilik, kode pasang kantor', () => {
  assert.equal(boot.pin, '246810');
  assert.match(boot.code, /^\d{6}$/);
  const m = store.master();
  assert.equal(m.branches.length, 1);
  assert.equal(m.items.length, 95);
  assert.equal(m.staff.length, 1);
});

test('health & berkas statis aman', async () => {
  const h = await call('GET', '/api/health');
  assert.equal(h.status, 200); assert.equal(h.body.app, 'robucca-pos');
  const pos = await fetch(`${base}/pos/`);
  assert.equal(pos.status, 200);
  assert.match(pos.headers.get('content-security-policy'), /script-src 'self'/);
  for (const p of ['/server/server.js', '/package.json', '/data/robucca-pos.db', '/pos/%2e%2e/server/server.js', '/pos/..%2fserver/store.js', '/.git/config']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await fetch(`${base}/assets/brand/favicon.png`)).status, 200);
});

test('pasang perangkat kantor (kode sekali pakai)', async () => {
  const r = await call('POST', '/api/pair', { body: { code: boot.code, name: 'PC Kantor' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.device.branchId, null);
  T.hq = r.body.token;
  const again = await call('POST', '/api/pair', { body: { code: boot.code, name: 'Lagi' } });
  assert.equal(again.status, 400);
  const noAuth = await call('GET', '/api/master');
  assert.equal(noAuth.status, 401);
});

test('master + ETag', async () => {
  const r = await call('GET', '/api/master', { token: T.hq });
  assert.equal(r.status, 200);
  assert.equal(r.body.master.items.length, 95);
  const etag = r.headers.get('etag');
  const r2 = await fetch(`${base}/api/master`, { headers: { Authorization: `Bearer ${T.hq}`, 'If-None-Match': etag } });
  assert.equal(r2.status, 304);
});

test('login PIN pemilik + batas percobaan', async () => {
  const bad = await call('POST', '/api/login', { token: T.hq, body: { staffId: 'st-owner', pin: '000000' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/login', { token: T.hq, body: { staffId: 'st-owner', pin: '246810' } });
  assert.equal(ok.status, 200);
  T.owner = ok.body.session;
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { token: T.hq, body: { staffId: 'nobody', pin: '1234' } });
  const locked = await call('POST', '/api/login', { token: T.hq, body: { staffId: 'nobody', pin: '1234' } });
  assert.equal(locked.status, 429);
});

test('pemilik menambah cabang, staf, dan perangkat cabang', async () => {
  const br = { id: 'br-cb2', code: 'CB2', name: 'Cabang Dua', address: '', phone: '', tz: 'Asia/Makassar', dayStart: 0, taxPct: 10, taxIncl: false, taxService: true, servicePct: 5, taxLabel: 'PBJT', open: '08:00', close: '22:00', paper: 58, active: true };
  assert.equal((await call('PUT', '/api/master/branches', { token: T.hq, session: T.owner, body: br })).status, 200);
  const dup = await call('PUT', '/api/master/branches', { token: T.hq, session: T.owner, body: { ...br, id: 'br-x', code: 'CB2' } });
  assert.equal(dup.status, 400);
  const pin = await hashPin('1357');
  for (const s of [
    { id: 'st-k', name: 'Kasir Uji', role: 'cashier', branchIds: ['br-ijn'], pin, active: true },
    { id: 'st-m2', name: 'Manajer Dua', role: 'manager', branchIds: ['br-cb2'], pin, active: true },
  ]) assert.equal((await call('PUT', '/api/master/staff', { token: T.hq, session: T.owner, body: s })).status, 200);
  const badHash = await call('PUT', '/api/master/staff', { token: T.hq, session: T.owner, body: { id: 'st-z', name: 'Z', role: 'cashier', branchIds: ['br-ijn'], pin: 'pbkdf2$99999999$00112233445566778899aabbccddeeff$' + '0'.repeat(64), active: true } });
  assert.equal(badHash.status, 400);
  for (const [k, branchId, t] of [['ijn1', 'br-ijn', 1], ['ijn2', 'br-ijn', 2], ['cb2', 'br-cb2', 1]]) {
    const c = await call('POST', '/api/devices', { token: T.hq, session: T.owner, body: { branchId, name: k, terminalNo: t } });
    assert.equal(c.status, 200);
    const p = await call('POST', '/api/pair', { body: { code: c.body.code, name: k } });
    assert.equal(p.status, 200);
    assert.equal(p.body.device.branchId, branchId);
    T[k] = p.body.token;
  }
  const m = await call('GET', '/api/master', { token: T.cb2 });
  assert.ok(m.body.master.staff.every((s) => s.role === 'owner' || s.branchIds.includes('br-cb2')), 'staf cabang lain tidak dikirim');
});

test('sinkron: diterima, ditolak bila total dimanipulasi atau beda cabang, LWW', async () => {
  const o = makeOrder('br-ijn');
  const r = await call('POST', '/api/sync', { token: T.ijn1, body: { docs: [{ coll: 'orders', doc: o }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.accepted, [o.id]);
  T.order = o;
  const tampered = makeOrder('br-ijn'); tampered.totals.total -= 5000; tampered.payments[0].amount -= 5000;
  const r2 = await call('POST', '/api/sync', { token: T.ijn1, body: { docs: [{ coll: 'orders', doc: tampered }] } });
  assert.equal(r2.body.rejected.length, 1);
  assert.match(r2.body.rejected[0].errors.join(), /total/);
  const other = makeOrder('br-cb2');
  const r3 = await call('POST', '/api/sync', { token: T.ijn1, body: { docs: [{ coll: 'orders', doc: other }] } });
  assert.match(r3.body.rejected[0].errors.join(), /cabang/);
  // dokumen cabang lain dengan ID yang sama tidak bisa ditimpa
  const hijack = { ...makeOrder('br-cb2'), id: o.id };
  const r4 = await call('POST', '/api/sync', { token: T.cb2, body: { docs: [{ coll: 'orders', doc: hijack }] } });
  assert.match(r4.body.rejected[0].errors.join(), /cabang lain/);
  // versi lama tidak menimpa versi baru
  const old = { ...o, table: '99', updatedAt: o.updatedAt - 10000 };
  await call('POST', '/api/sync', { token: T.ijn1, body: { docs: [{ coll: 'orders', doc: old }] } });
  assert.equal(store.getDoc('orders', o.id).doc.table, '5');
});

test('feed: terminal lain di cabang sama menerima pesanan & stok', async () => {
  const f = await call('GET', '/api/feed?since=0', { token: T.ijn2 });
  assert.equal(f.status, 200);
  assert.ok(f.body.orders.some((x) => x.id === T.order.id));
  const f2 = await call('GET', `/api/feed?since=${f.body.seq}`, { token: T.ijn2 });
  assert.equal(f2.body.orders.length, 0);
  const fc = await call('GET', '/api/feed?since=0', { token: T.cb2 });
  assert.ok(!fc.body.orders.some((x) => x.id === T.order.id), 'cabang lain tidak menerima');
});

test('laporan: pemilik melihat semua, manajer hanya cabangnya, kasir ditolak', async () => {
  const q = `from=${today()}&to=${today()}`;
  const rep = await call('GET', `/api/report?${q}`, { token: T.hq, session: T.owner });
  assert.equal(rep.status, 200);
  assert.equal(rep.body.kpi.orders, 1);
  assert.equal(rep.body.kpi.total, T.order.totals.total);
  const mgr = await call('POST', '/api/login', { token: T.cb2, body: { staffId: 'st-m2', pin: '1357' } });
  assert.equal(mgr.status, 200);
  T.mgr = mgr.body.session;
  const repM = await call('GET', `/api/report?${q}&branches=br-ijn,br-cb2`, { token: T.cb2, session: T.mgr });
  assert.equal(repM.body.kpi.orders, 0, 'manajer cabang 2 tidak melihat penjualan IJN');
  assert.equal((await call('GET', `/api/orders/${T.order.id}`, { token: T.cb2, session: T.mgr })).status, 404);
  const kasir = await call('POST', '/api/login', { token: T.ijn1, body: { staffId: 'st-k', pin: '1357' } });
  T.kasir = kasir.body.session;
  assert.equal((await call('GET', `/api/report?${q}`, { token: T.ijn1, session: T.kasir })).status, 403);
  // kasir tidak bisa login di perangkat cabang lain
  assert.equal((await call('POST', '/api/login', { token: T.cb2, body: { staffId: 'st-k', pin: '1357' } })).status, 401);
});

test('hak data master per peran', async () => {
  const avail = { id: 'br-ijn:truffle-fries', branchId: 'br-ijn', itemId: 'truffle-fries', price: null, available: false };
  assert.equal((await call('PUT', '/api/master/itemBranch', { token: T.ijn1, session: T.kasir, body: avail })).status, 200, 'kasir boleh menandai habis');
  assert.equal((await call('PUT', '/api/master/itemBranch', { token: T.ijn1, session: T.kasir, body: { ...avail, price: 1000 } })).status, 403, 'kasir tidak boleh ubah harga');
  assert.equal((await call('PUT', '/api/master/itemBranch', { token: T.cb2, session: T.mgr, body: { ...avail } })).status, 403, 'manajer cabang lain ditolak');
  const pin = await hashPin('9999');
  assert.equal((await call('PUT', '/api/master/staff', { token: T.cb2, session: T.mgr, body: { id: 'st-new-owner', name: 'X', role: 'owner', branchIds: ['*'], pin, active: true } })).status, 403);
  assert.equal((await call('PUT', '/api/master/staff', { token: T.cb2, session: T.mgr, body: { id: 'st-k2', name: 'Kasir CB2', role: 'cashier', branchIds: ['br-cb2'], pin, active: true } })).status, 200);
  assert.equal((await call('PUT', '/api/master/settings', { token: T.cb2, session: T.mgr, body: { id: 'org', orgName: 'X' } })).status, 403);
  assert.equal((await call('DELETE', '/api/master/branches/br-ijn', { token: T.hq, session: T.owner })).status, 400, 'cabang tidak dihapus, hanya dinonaktifkan');
});

test('menu publik pelanggan: tanpa login, urutan kelompok, harga & habis per cabang, tanpa data internal', async () => {
  // dua cabang aktif → tanpa kode cabang: daftar pilihan
  const pick = await call('GET', '/api/public/menu');
  assert.equal(pick.status, 200);
  assert.equal(pick.body.menu, null);
  assert.deepEqual(pick.body.branches.map((b) => b.code).sort(), ['CB2', 'IJN']);
  assert.equal(pick.headers.get('access-control-allow-origin'), '*');

  const r = await call('GET', '/api/public/menu?cabang=ijn');
  assert.equal(r.status, 200);
  const m = r.body.menu;
  assert.equal(m.branch.code, 'IJN');
  assert.deepEqual(m.groups.map((g) => g.name), ['Minuman', 'Snack', 'Makanan Berat', 'Pastry & Dessert']);
  const flat = (menu) => menu.groups.flatMap((g) => g.cats.flatMap((c) => c.items));
  assert.equal(flat(m).length, 95);
  assert.equal(flat(m).find((i) => i.id === 'truffle-fries').soldOut, true, 'ditandai habis oleh kasir IJN');
  assert.match(m.priceNote, /sudah termasuk PB1 10%/);
  const text = JSON.stringify(r.body);
  for (const k of ['"pin"', '"staff', 'pbkdf2$', '"token', '"track"', '"low"', '"station"', '"devices', '"discounts']) assert.ok(!text.includes(k), `data internal bocor: ${k}`);

  // harga khusus cabang langsung terlihat setelah diubah (hasil tersimpan ikut diperbarui)
  const before = flat((await call('GET', '/api/public/menu?cabang=CB2')).body.menu).find((i) => i.id === 'kopi-susu-essentials');
  assert.equal(before.price, 24000);
  const ov = { id: 'br-cb2:kopi-susu-essentials', branchId: 'br-cb2', itemId: 'kopi-susu-essentials', price: 26500, available: true };
  assert.equal((await call('PUT', '/api/master/itemBranch', { token: T.hq, session: T.owner, body: ov })).status, 200);
  const c2 = (await call('GET', '/api/public/menu?cabang=CB2')).body.menu;
  assert.equal(flat(c2).find((i) => i.id === 'kopi-susu-essentials').price, 26500);
  assert.equal(flat(c2).find((i) => i.id === 'truffle-fries').soldOut, false, 'habis hanya di IJN');
  assert.match(c2.priceNote, /belum termasuk PBJT 10%\. Biaya layanan 5%/);

  // kode salah & cabang nonaktif → 404 berisi daftar cabang
  const bad = await call('GET', '/api/public/menu?cabang=ZZZ');
  assert.equal(bad.status, 404);
  assert.ok(Array.isArray(bad.body.branches));
  const cb2 = store.master().branches.find((b) => b.id === 'br-cb2');
  assert.equal((await call('PUT', '/api/master/branches', { token: T.hq, session: T.owner, body: { ...cb2, active: false } })).status, 200);
  assert.equal((await call('GET', '/api/public/menu?cabang=CB2')).status, 404);
  const one = await call('GET', '/api/public/menu');
  assert.equal(one.body.menu.branch.code, 'IJN', 'satu cabang aktif → langsung menunya');
  assert.equal((await call('PUT', '/api/master/branches', { token: T.hq, session: T.owner, body: { ...cb2, active: true } })).status, 200);

  // halaman menu disajikan dengan CSP; /menu dialihkan ke /menu/
  const page = await fetch(`${base}/menu/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const redir = await fetch(`${base}/menu`, { redirect: 'manual' });
  assert.equal(redir.status, 301);
  for (const f of ['/menu/menu.js', '/menu/menu.css', '/pos/js/core/menu.js']) assert.equal((await fetch(base + f)).status, 200, f);
});

test('jalur kantor: refund dari pusat, log harus atas nama sendiri', async () => {
  const o = T.order;
  const refund = {
    ...o, id: uuid(), kind: 'refund', status: 'paid', refOf: o.id, number: `R-${o.number}`, reason: 'Uji',
    totals: Object.fromEntries(Object.entries(o.totals).map(([k, v]) => [k, -v])), lines: o.lines.map((l) => ({ ...l, qty: -l.qty, gross: -l.gross, discAmt: -l.discAmt, amount: -l.amount })),
    payments: o.payments.map((p) => ({ method: p.method, name: p.name, type: p.type, amount: -p.amount })), updatedAt: Date.now(),
  };
  const r = await call('POST', '/api/office/docs', { token: T.hq, session: T.owner, body: { docs: [{ coll: 'orders', doc: refund }, { coll: 'orders', doc: { ...o, status: 'refunded', updatedAt: Date.now() } }] } });
  assert.equal(r.body.accepted.length, 2, JSON.stringify(r.body.rejected));
  const fake = await call('POST', '/api/office/docs', { token: T.hq, session: T.owner, body: { docs: [{ coll: 'audit', doc: { id: uuid(), branchId: 'br-ijn', at: Date.now(), action: 'order.void', detail: {}, by: 'st-k' } }] } });
  assert.equal(fake.body.rejected.length, 1);
  const rep = await call('GET', `/api/report?from=${today()}&to=${today()}`, { token: T.hq, session: T.owner });
  assert.equal(rep.body.kpi.total, 0);
  assert.equal(rep.body.kpi.refunds, 1);
});

test('SSE: perangkat cabang menerima event saat ada pesanan baru', async () => {
  const events = [];
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers: { Authorization: `Bearer ${T.ijn2}` }, signal: ctrl.signal });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(dec.decode(value)); } } catch (e) { /* aborted */ } })();
  await new Promise((r) => setTimeout(r, 100));
  const o = makeOrder('br-ijn', { number: 'IJN1-000000-0002' });
  await call('POST', '/api/sync', { token: T.ijn1, body: { docs: [{ coll: 'orders', doc: o }] } });
  await new Promise((r) => setTimeout(r, 150));
  ctrl.abort(); await pump;
  const all = events.join('');
  assert.match(all, /event: hello/);
  assert.match(all, /event: feed/);
});

test('cabut perangkat → akses ditolak', async () => {
  const list = await call('GET', '/api/devices', { token: T.hq, session: T.owner });
  const d = list.body.rows.find((x) => x.name === 'ijn2');
  assert.equal((await call('DELETE', `/api/devices/${d.id}`, { token: T.hq, session: T.owner })).status, 200);
  assert.equal((await call('GET', '/api/feed?since=0', { token: T.ijn2 })).status, 401);
});

test('kode pasang salah berulang → dibatasi', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/pair', { body: { code: '000000' } });
  assert.equal(last.status, 429);
});
