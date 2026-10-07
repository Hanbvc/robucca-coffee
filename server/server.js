#!/usr/bin/env node
/* =========================================================
   Server pusat Robucca POS (Node.js 22.13+, tanpa dependensi npm).
   Satu database untuk semua cabang: perangkat kasir/dapur/kantor dipasangkan
   dengan kode, berjualan offline-first, lalu sinkron ke sini.

   Jalankan:   npm start                     (port 8787, database ./data/robucca-pos.db)
   Perintah:   node server/server.js pair --branch IJN --name "Kasir 2" --terminal 2
               node server/server.js pair --hq
               node server/server.js reset-pin --staff "Pemilik" --pin 123456
               node server/server.js backup --out ./cadangan.db
   ========================================================= */
import http from 'node:http';
import path from 'node:path';
import { Store } from './store.js';
import { sha, token, code6, validPinHash, Limiter } from './auth.js';
import { serveStatic, CSP } from './static.js';
import { loadCustomerData, ROOT } from './data-loader.js';
import { seedMaster, MASTER_COLLS } from '../pos/js/core/seed.js';
import { validate, SYNC_COLLS } from '../pos/js/core/validate.js';
import { aggregate } from '../pos/js/core/report.js';
import { verifyPin } from '../pos/js/core/pin.js';
import { can, canBranch, staffBranches, ROLES } from '../pos/js/core/perms.js';
import { bizDate, addDays, dayDiff, TZS } from '../pos/js/core/dates.js';
import { validBranchCode, uuid } from '../pos/js/core/ids.js';
import { Master } from '../pos/js/data/master.js';
import { generateHistory } from '../pos/js/data/demo.js';
import { publicMenu, publicBranches } from '../pos/js/core/menu.js';

export const VERSION = '1.0.0';
const SESSION_MS = 12 * 3600e3;
const PAIR_MS = 30 * 60e3;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const forbid = (msg = 'Tidak punya akses untuk tindakan ini') => new HttpError(403, msg);

/* =========================================================
   Aplikasi (dipakai juga oleh tes)
   ========================================================= */
export function createApp({ store, corsOrigins = [], log = console.log, trustProxy = false }) {
  const clients = new Set();
  const pairLimit = new Limiter(10, 10 * 60e3);
  const loginLimit = new Limiter(5, 5 * 60e3);
  const ipLimit = new Limiter(30, 15 * 60e3);
  const person = (id) => store.master().staff.find((s) => s.id === id) || null;
  const names = () => new Master(store.master()).names();
  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '-';

  /* ---------- utilitas HTTP ---------- */
  const send = (res, status, body, headers = {}) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };
  const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Data terlalu besar')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(bad('JSON tidak valid')); }
    });
    req.on('error', reject);
  });

  /* ---------- otorisasi ---------- */
  function deviceAuth(req) {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'Perangkat belum dipasangkan');
    const d = store.deviceByToken(sha(m[1]));
    if (!d) throw new HttpError(401, 'Akses perangkat tidak berlaku');
    if (Date.now() - (d.last_seen || 0) > 30000) store.touchDevice(d.id);
    return d;
  }
  function staffAuth(req, device) {
    const t = req.headers['x-session'];
    if (!t) throw new HttpError(401, 'Perlu login kantor');
    const s = store.session(sha(t));
    if (!s || s.device_id !== device.id) throw new HttpError(401, 'Sesi kantor berakhir, masuk lagi');
    const staff = person(s.staff_id);
    if (!staff || staff.active === false) throw new HttpError(401, 'Akun tidak aktif');
    return staff;
  }
  /** Cabang yang diminta ∩ cabang yang boleh dilihat. null = semua cabang (pemilik). */
  function scope(staff, csv) {
    const want = csv ? String(csv).split(',').map((x) => x.trim()).filter(Boolean) : null;
    if (staffBranches(staff).includes('*')) return want;
    const mine = staff.branchIds || [];
    return want ? want.filter((b) => mine.includes(b)) : mine;
  }
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  function dates(u) {
    const from = u.searchParams.get('from'); const to = u.searchParams.get('to');
    if (!isDate(from) || !isDate(to) || from > to) throw bad('Rentang tanggal tidak valid');
    if (dayDiff(from, to) > 400) throw bad('Rentang maksimal 400 hari');
    return { from, to };
  }
  const needPerm = (staff, perm) => { if (!can(staff, perm)) throw forbid(); };

  /* ---------- menu publik untuk pelanggan (tanpa login) ----------
     Hanya data yang memang tampil di buku menu: nama, harga cabang, foto, habis/tidak.
     Hasil disimpan sampai menu, stok, atau transaksi berubah. */
  const menuCache = new Map();
  function publicMenuRoute(res, u) {
    const m = store.master();
    const settings = m.settings[0] || {};
    const org = { name: settings.orgName || 'Robucca', instagram: settings.instagram || '' };
    const branches = publicBranches(m);
    const code = String(u.searchParams.get('cabang') || '').trim().toUpperCase().slice(0, 8);
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=15' };
    let b = code ? m.branches.find((x) => x.code === code && x.active !== false) : null;
    if (code && !b) return send(res, 404, { error: 'Cabang tidak ditemukan', org, branches }, headers);
    if (!b && branches.length === 1) b = m.branches.find((x) => x.code === branches[0].code);
    if (!b) return send(res, 200, { org, branches, menu: null, at: Date.now() }, headers);
    const key = `${store.masterVersion()}:${store.seq}`;
    let c = menuCache.get(b.id);
    if (!c || c.key !== key) {
      c = { key, menu: publicMenu(m, b.id, { stock: store.stockLevels(b.id) }) };
      menuCache.set(b.id, c);
    }
    return send(res, 200, { org, branches, menu: c.menu, at: Date.now() }, headers);
  }

  /* ---------- SSE ---------- */
  const sse = (res, event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* koneksi putus */ } };
  const broadcast = (event, data, branchId = null) => { for (const c of clients) if (!branchId || c.branchId === branchId) sse(c.res, event, data); };
  const pinger = setInterval(() => { for (const c of clients) { try { c.res.write('event: ping\ndata: {}\n\n'); } catch (e) { /* noop */ } } }, 25000);

  function serverAudit(action, detail, staff, branchId, deviceId) {
    const at = Date.now();
    store.upsert('audit', { id: uuid(), branchId: branchId || null, at, updatedAt: at, action, detail, by: staff ? staff.id : null, byName: staff ? staff.name : 'Server', deviceId: deviceId || null }, deviceId);
  }

  /* ---------- validasi data master ---------- */
  const MASTER_PERM = { settings: 'settings', branches: 'branch', categories: 'menu.edit', items: 'menu.edit', channels: 'settings', payMethods: 'settings', discounts: 'promo', staff: 'staff' };
  function checkMaster(coll, d, staff) {
    if (!MASTER_COLLS.includes(coll)) throw new HttpError(404, 'Koleksi tidak dikenal');
    if (!d || typeof d !== 'object' || !/^[A-Za-z0-9:_-]{2,100}$/.test(String(d.id || ''))) throw bad('ID tidak valid');
    if (JSON.stringify(d).length > 64000) throw bad('Data terlalu besar');
    const m = store.master(); const prev = store.getMaster(coll, d.id);
    const pct = (v) => typeof v === 'number' && v >= 0 && v <= 100;
    switch (coll) {
      case 'itemBranch': {
        if (d.id !== `${d.branchId}:${d.itemId}`) throw bad('ID harga cabang tidak valid');
        if (!m.branches.some((b) => b.id === d.branchId) || !m.items.some((i) => i.id === d.itemId)) throw bad('Cabang/menu tidak dikenal');
        if (!canBranch(staff, d.branchId)) throw forbid('Cabang di luar akses Anda');
        const priceChanged = (prev ? prev.price ?? null : null) !== (d.price ?? null);
        if (d.price != null && !(Number.isInteger(d.price) && d.price >= 0)) throw bad('Harga tidak valid');
        if (priceChanged) needPerm(staff, 'menu.edit');
        else if (!can(staff, 'soldout') && !can(staff, 'menu.branch')) throw forbid();
        return;
      }
      case 'staff': {
        needPerm(staff, 'staff');
        if (!ROLES[d.role]) throw bad('Peran tidak valid');
        if (!String(d.name || '').trim()) throw bad('Nama wajib diisi');
        if (!validPinHash(d.pin)) throw bad('PIN tidak valid');
        if (!Array.isArray(d.branchIds)) throw bad('Cabang tidak valid');
        if (!can(staff, 'staff.owner')) {
          const ok = (s) => ['cashier', 'kitchen'].includes(s.role) && (s.branchIds || []).length > 0 && s.branchIds.every((b) => canBranch(staff, b));
          if (!ok(d) || (prev && !ok(prev))) throw forbid('Manajer hanya bisa mengelola kasir & dapur di cabangnya');
        }
        if (prev && prev.role === 'owner' && (d.role !== 'owner' || d.active === false) && m.staff.filter((s) => s.role === 'owner' && s.active !== false).length <= 1) throw bad('Harus ada minimal satu pemilik aktif');
        if (d.id === staff.id && d.active === false) throw bad('Tidak bisa menonaktifkan akun sendiri');
        return;
      }
      default:
        needPerm(staff, MASTER_PERM[coll]);
    }
    if (coll === 'settings' && d.id !== 'org') throw bad('ID pengaturan harus "org"');
    if (coll === 'branches') {
      if (!validBranchCode(d.code)) throw bad('Kode cabang 2–4 karakter, diawali huruf');
      if (m.branches.some((b) => b.code === d.code && b.id !== d.id)) throw bad(`Kode ${d.code} sudah dipakai`);
      if (prev && prev.code !== d.code) throw bad('Kode cabang tidak bisa diubah (dipakai di nomor struk)');
      if (!String(d.name || '').trim()) throw bad('Nama cabang wajib diisi');
      if (!pct(d.taxPct) || !pct(d.servicePct || 0)) throw bad('Tarif pajak/layanan 0–100%');
      if (!TZS.some((t) => t.id === d.tz)) throw bad('Zona waktu tidak dikenal');
    }
    if (coll === 'items') {
      if (!String(d.name || '').trim()) throw bad('Nama menu wajib diisi');
      if (!Number.isInteger(d.price) || d.price < 0) throw bad('Harga tidak valid');
      if (!m.categories.some((c) => c.id === d.catId)) throw bad('Kategori tidak dikenal');
      if (!Array.isArray(d.opts || []) || (d.opts || []).length > 12) throw bad('Opsi menu tidak valid');
    }
    if (coll === 'categories' && !String(d.name || '').trim()) throw bad('Nama kategori wajib diisi');
    if (coll === 'channels' && !pct(d.markupPct || 0)) throw bad('Markup 0–100%');
    if (coll === 'discounts' && (!['pct', 'amt'].includes(d.type) || !(d.value > 0) || (d.type === 'pct' && d.value > 100))) throw bad('Nilai promo tidak valid');
  }

  /* ---------- simpan dokumen transaksi ---------- */
  function ingest(list, { device, staff = null }) {
    const accepted = []; const rejected = []; const touched = new Set();
    store.tx(() => {
      for (const item of list) {
        const coll = item && item.coll; const d = item && item.doc;
        const id = d && d.id;
        const no = (errors) => rejected.push({ coll, id, errors: [].concat(errors) });
        if (!SYNC_COLLS.includes(coll)) { no('koleksi tidak dikenal'); continue; }
        if (JSON.stringify(d || {}).length > 120000) { no('dokumen terlalu besar'); continue; }
        const errs = validate(coll, d);
        if (errs.length) { no(errs); continue; }
        if (staff) {
          // jalur kantor: cek hak per cabang & jenis data
          if (d.branchId && !canBranch(staff, d.branchId)) { no('cabang di luar akses'); continue; }
          if (coll === 'orders' && !can(staff, 'approve')) { no('perlu hak persetujuan'); continue; }
          if (coll === 'stockMoves' && !can(staff, 'stock')) { no('perlu hak stok'); continue; }
          if (coll === 'audit' && d.by !== staff.id) { no('pelaku log tidak cocok'); continue; }
          if (!['orders', 'stockMoves', 'audit'].includes(coll)) { no('tidak boleh dari kantor'); continue; }
        } else if (!device.branch_id || d.branchId !== device.branch_id) { no('dokumen bukan milik cabang perangkat ini'); continue; }
        const r = store.upsert(coll, d, device.id);
        if (r === 'conflict') { no('ID sudah dipakai cabang lain'); continue; }
        accepted.push(id);
        if (r === 'saved' && d.branchId) touched.add(d.branchId);
      }
    });
    for (const b of touched) broadcast('feed', { seq: store.seq }, b);
    return { accepted, rejected, seq: store.seq };
  }

  /* ---------- rute API ---------- */
  async function api(req, res, u) {
    const p = u.pathname; const M = req.method;
    const seg = p.split('/').filter(Boolean); // ['api', ...]

    if (p === '/api/health') return send(res, 200, { ok: true, app: 'robucca-pos', version: VERSION, time: Date.now() });

    if (p === '/api/public/menu' && M === 'GET') return publicMenuRoute(res, u);

    if (p === '/api/pair' && M === 'POST') {
      const ip = ipOf(req);
      const wait = pairLimit.blocked(ip);
      if (wait) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`);
      const b = await readBody(req, 4000);
      const code = String(b.code || '').replace(/\D/g, '');
      const pr = code.length === 6 ? store.takePairing(sha(code)) : null;
      if (!pr) { pairLimit.fail(ip); throw bad('Kode pasang salah atau sudah kedaluwarsa'); }
      const tok = token('dev');
      const dev = { id: uuid(), name: String(b.name || pr.name || 'Perangkat').slice(0, 60), branchId: pr.branch_id || null, terminalNo: pr.terminal_no || 0, tokenHash: sha(tok), createdBy: pr.created_by };
      store.addDevice(dev);
      serverAudit('device.pair', { name: dev.name, terminal: dev.terminalNo }, null, dev.branchId, dev.id);
      log(`[pair] ${dev.name} → ${dev.branchId || 'kantor pusat'} T${dev.terminalNo}`);
      return send(res, 200, { token: tok, device: { id: dev.id, name: dev.name, branchId: dev.branchId, terminalNo: dev.terminalNo }, org: (store.master().settings[0] || {}).orgName });
    }

    const device = deviceAuth(req);

    if (p === '/api/master' && M === 'GET') {
      const v = store.masterVersion();
      if (req.headers['if-none-match'] === `"${v}"`) { res.writeHead(304, { ETag: `"${v}"` }); return res.end(); }
      const m = store.master();
      const staff = device.branch_id ? m.staff.filter((s) => canBranch(s, device.branch_id)) : m.staff;
      return send(res, 200, { version: v, master: { ...m, staff } }, { ETag: `"${v}"` });
    }

    if (p === '/api/sync' && M === 'POST') {
      const b = await readBody(req);
      const docs = Array.isArray(b.docs) ? b.docs : [];
      if (docs.length > 500) throw bad('Maksimal 500 dokumen per kiriman');
      return send(res, 200, ingest(docs, { device }));
    }

    if (p === '/api/feed' && M === 'GET') {
      if (!device.branch_id) return send(res, 200, { seq: store.seq, orders: [], kitchen: [], stock: {} });
      const since = Math.max(0, parseInt(u.searchParams.get('since') || '0', 10) || 0);
      const f = store.feed(device.branch_id, since);
      return send(res, 200, { ...f, stock: store.stockLevels(device.branch_id) });
    }

    if (p === '/api/stream' && M === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const c = { res, deviceId: device.id, branchId: device.branch_id };
      clients.add(c);
      sse(res, 'hello', { seq: store.seq, master: store.masterVersion() });
      req.on('close', () => clients.delete(c));
      return undefined;
    }

    if (p === '/api/login' && M === 'POST') {
      const b = await readBody(req, 4000);
      const ip = ipOf(req); const key = `${device.id}:${b.staffId}`;
      const wait = Math.max(loginLimit.blocked(key), ipLimit.blocked(ip));
      if (wait) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`);
      const s = person(String(b.staffId || ''));
      const allowed = s && s.active !== false && (device.branch_id ? canBranch(s, device.branch_id) : ['owner', 'manager'].includes(s.role));
      if (!allowed || !(await verifyPin(String(b.pin || ''), s.pin))) { loginLimit.fail(key); ipLimit.fail(ip); throw new HttpError(401, 'PIN salah'); }
      loginLimit.ok(key);
      const t = token('ses'); const expiresAt = Date.now() + SESSION_MS;
      store.addSession({ tokenHash: sha(t), staffId: s.id, deviceId: device.id, expiresAt });
      return send(res, 200, { session: t, expiresAt, staff: { id: s.id, name: s.name, role: s.role } });
    }
    if (p === '/api/logout' && M === 'POST') {
      const t = req.headers['x-session']; if (t) store.dropSession(sha(t));
      return send(res, 200, { ok: true });
    }

    /* ----- semua di bawah ini butuh sesi staf ----- */
    const staff = staffAuth(req, device);

    if (p === '/api/report' && M === 'GET') {
      needPerm(staff, 'report');
      const { from, to } = dates(u);
      const orders = store.ordersRange(scope(staff, u.searchParams.get('branches')), from, to);
      return send(res, 200, aggregate(orders, { from, to, ...names() }));
    }
    if (p === '/api/orders' && M === 'GET') {
      needPerm(staff, 'report');
      const { from, to } = dates(u);
      const limit = Math.min(100000, Math.max(1, +u.searchParams.get('limit') || 50)); const offset = Math.max(0, +u.searchParams.get('offset') || 0);
      return send(res, 200, store.ordersPage(scope(staff, u.searchParams.get('branches')), { from, to, status: u.searchParams.get('status') || '', q: (u.searchParams.get('q') || '').slice(0, 60), limit, offset }));
    }
    if (seg[1] === 'orders' && seg[2] && M === 'GET') {
      needPerm(staff, 'report');
      const r = store.getDoc('orders', decodeURIComponent(seg[2]));
      if (!r || !canBranch(staff, r.branchId)) throw new HttpError(404, 'Transaksi tidak ditemukan');
      return send(res, 200, r.doc);
    }
    if (p === '/api/shifts' && M === 'GET') {
      needPerm(staff, 'report');
      const { from, to } = dates(u);
      return send(res, 200, { rows: store.docsRange('shifts', scope(staff, u.searchParams.get('branches')), from, to) });
    }
    if (p === '/api/cash-moves' && M === 'GET') {
      needPerm(staff, 'report');
      const rows = store.byRef('cashMoves', String(u.searchParams.get('shift') || '')).filter((x) => canBranch(staff, x.branchId));
      return send(res, 200, { rows });
    }
    if (p === '/api/stock' && M === 'GET') {
      const b = String(u.searchParams.get('branch') || '');
      if (!canBranch(staff, b) || !(can(staff, 'stock') || can(staff, 'report'))) throw forbid();
      return send(res, 200, { levels: store.stockLevels(b) });
    }
    if (p === '/api/stock/moves' && M === 'GET') {
      const b = String(u.searchParams.get('branch') || '');
      if (!canBranch(staff, b) || !(can(staff, 'stock') || can(staff, 'report'))) throw forbid();
      return send(res, 200, { rows: store.stockMoves(b, Math.min(1000, +u.searchParams.get('limit') || 200)) });
    }
    if (p === '/api/audit' && M === 'GET') {
      needPerm(staff, 'audit');
      const { from, to } = dates(u);
      const sc = scope(staff, u.searchParams.get('branches'));
      return send(res, 200, { rows: store.docsRange('audit', sc, from, to, Math.min(2000, +u.searchParams.get('limit') || 300)) });
    }
    if (p === '/api/branch-status' && M === 'GET') {
      needPerm(staff, 'report');
      const sc = scope(staff, null);
      const devs = store.devices();
      const rows = store.master().branches.filter((b) => b.active !== false && (!sc || sc.includes(b.id))).map((b) => {
        const t = bizDate(Date.now(), b.tz || 'Asia/Jakarta', b.dayStart);
        const orders = store.ordersRange([b.id], t, t);
        const counted = orders.filter((o) => (o.kind === 'refund' ? true : o.status === 'paid' || o.status === 'refunded'));
        const shifts = store.docsRange('shifts', [b.id], addDays(t, -1), t);
        return {
          branchId: b.id, today: t, total: counted.reduce((a, o) => a + o.totals.total, 0), orders: counted.filter((o) => o.kind === 'sale').length,
          openBills: store.countStatus('orders', b.id, 'open'), openShifts: shifts.filter((s) => s.status === 'open').length,
          lastActivity: orders.reduce((a, o) => Math.max(a, o.paidAt || o.createdAt || 0), 0) || null,
          lastSeen: devs.filter((d) => d.branch_id === b.id && !d.revoked).reduce((a, d) => Math.max(a, d.last_seen || 0), 0) || null,
        };
      });
      return send(res, 200, { rows });
    }

    if (seg[1] === 'master' && seg[2] && (M === 'PUT' || M === 'DELETE')) {
      const coll = seg[2];
      if (M === 'PUT') {
        const d = await readBody(req, 100000);
        checkMaster(coll, d, staff);
        const prev = store.getMaster(coll, d.id);
        store.putMaster(coll, { ...d, updatedAt: Date.now() });
        if (coll === 'staff' && prev && (prev.pin !== d.pin || d.active === false || prev.role !== d.role)) store.dropStaffSessions(d.id);
        serverAudit('master.save', { coll, id: d.id, name: d.name || d.code || (coll === 'itemBranch' ? `${d.itemId}${d.available === false ? ' (habis)' : ''}` : d.id) }, staff, d.branchId || (coll === 'branches' ? d.id : null), device.id);
        broadcast('master', { version: store.masterVersion() });
        return send(res, 200, { ok: true, version: store.masterVersion() });
      }
      if (!['discounts', 'itemBranch'].includes(coll)) throw bad('Data ini tidak bisa dihapus; nonaktifkan saja');
      const id = decodeURIComponent(seg[3] || '');
      const prev = store.getMaster(coll, id);
      if (!prev) throw new HttpError(404, 'Tidak ditemukan');
      if (coll === 'discounts') needPerm(staff, 'promo');
      else { needPerm(staff, 'menu.edit'); }
      store.delMaster(coll, id);
      serverAudit('master.delete', { coll, id, name: prev.name || id }, staff, prev.branchId || null, device.id);
      broadcast('master', { version: store.masterVersion() });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/devices' && M === 'GET') {
      needPerm(staff, 'device');
      const sc = scope(staff, null);
      const rows = store.devices().filter((d) => !sc || (d.branch_id && sc.includes(d.branch_id))).map((d) => ({ id: d.id, name: d.name, branchId: d.branch_id, terminalNo: d.terminal_no, createdAt: d.created_at, lastSeen: d.last_seen, revoked: !!d.revoked }));
      return send(res, 200, { rows });
    }
    if (p === '/api/devices' && M === 'POST') {
      needPerm(staff, 'device');
      const b = await readBody(req, 4000);
      const branchId = b.branchId || null;
      if (!branchId && !can(staff, 'office.all')) throw forbid('Hanya pemilik yang bisa menambah perangkat kantor pusat');
      if (branchId && (!store.master().branches.some((x) => x.id === branchId) || !canBranch(staff, branchId))) throw forbid('Cabang di luar akses Anda');
      const terminalNo = branchId ? Math.min(26, Math.max(1, parseInt(b.terminalNo, 10) || 1)) : 0;
      const code = code6(); const expiresAt = Date.now() + PAIR_MS;
      store.addPairing({ codeHash: sha(code), branchId, name: String(b.name || 'Kasir').slice(0, 60), terminalNo, expiresAt, createdBy: staff.id });
      return send(res, 200, { code, expiresAt });
    }
    if (seg[1] === 'devices' && seg[2] && M === 'DELETE') {
      needPerm(staff, 'device');
      const d = store.device(decodeURIComponent(seg[2]));
      if (!d) throw new HttpError(404, 'Perangkat tidak ditemukan');
      if (d.id === device.id) throw bad('Tidak bisa mencabut perangkat yang sedang dipakai');
      if (d.branch_id ? !canBranch(staff, d.branch_id) : !can(staff, 'office.all')) throw forbid();
      store.revokeDevice(d.id);
      for (const c of clients) if (c.deviceId === d.id) { try { c.res.end(); } catch (e) { /* noop */ } clients.delete(c); }
      serverAudit('device.revoke', { name: d.name, terminal: d.terminal_no }, staff, d.branch_id, device.id);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/office/docs' && M === 'POST') {
      needPerm(staff, 'office');
      const b = await readBody(req);
      const docs = Array.isArray(b.docs) ? b.docs : [];
      if (docs.length > 200) throw bad('Maksimal 200 dokumen');
      return send(res, 200, ingest(docs, { device, staff }));
    }

    throw new HttpError(404, 'Alamat API tidak dikenal');
  }

  /* ---------- penangan utama ---------- */
  async function handler(req, res) {
    const u = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Session, If-None-Match');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      if (u.pathname.startsWith('/api/')) return await api(req, res, u);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metode tidak didukung');
      if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(302, { Location: '/pos/' }); return res.end(); }
      if (serveStatic(ROOT, req, res, u.pathname)) return undefined;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': CSP });
      return res.end('Tidak ditemukan');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log(`[error] ${req.method} ${u.pathname}: ${e.stack || e}`);
      if (res.headersSent) { try { res.end(); } catch (x) { /* noop */ } return undefined; }
      return send(res, status, { error: status >= 500 ? 'Kesalahan server' : e.message });
    }
  }

  const sweeper = setInterval(() => { store.cleanup(); pairLimit.sweep(); loginLimit.sweep(); ipLimit.sweep(); }, 3600e3);
  return {
    handler,
    clients,
    close() { clearInterval(pinger); clearInterval(sweeper); for (const c of clients) { try { c.res.end(); } catch (e) { /* noop */ } } clients.clear(); },
  };
}

/* =========================================================
   Penyiapan pertama & perintah CLI
   ========================================================= */
export async function bootstrap(store, { demo = false, ownerPin = '', log = console.log } = {}) {
  if (!store.isEmpty) return null;
  const { MENU, CONFIG } = loadCustomerData();
  const pin = demo ? '1111' : (ownerPin || code6());
  const master = await seedMaster({ MENU, CONFIG, demo, ownerPin: pin });
  store.replaceMaster(master);
  if (demo) {
    const h = generateHistory(new Master(master), { days: 30 });
    store.tx(() => { for (const c of ['shifts', 'cashMoves', 'stockMoves', 'orders']) for (const d of h[c]) store.upsert(c, d, null); });
  }
  const code = code6();
  store.addPairing({ codeHash: sha(code), branchId: null, name: 'Komputer kantor', terminalNo: 0, expiresAt: Date.now() + 24 * 3600e3, createdBy: 'bootstrap' });
  log([
    '',
    '────────────────────────────────────────────────────────',
    ' Robucca POS — database baru dibuat',
    demo ? ' Mode demo: 3 cabang contoh + riwayat transaksi simulasi 30 hari' : ` Cabang awal: ${master.branches[0].name} (${master.branches[0].code})`,
    ` PIN pemilik : ${pin}${ownerPin && !demo ? ' (dari OWNER_PIN)' : demo ? ' (PIN demo)' : '  ← CATAT & SEGERA GANTI di Kantor › Karyawan'}`,
    ` Kode pasang komputer kantor: ${code}  (berlaku 24 jam)`,
    '────────────────────────────────────────────────────────',
    '',
  ].join('\n'));
  return { pin, code };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; out[k] = v; } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'start';
  const dbFile = String(args.db || process.env.POS_DB || path.join(ROOT, 'data', 'robucca-pos.db'));
  const store = new Store(dbFile);

  if (cmd === 'pair') {
    await bootstrap(store, { ownerPin: process.env.OWNER_PIN || '' });
    const m = store.master();
    const br = args.hq ? null : m.branches.find((b) => b.code === String(args.branch || '').toUpperCase() || b.id === args.branch);
    if (!args.hq && !br) { console.error(`Cabang "${args.branch || ''}" tidak ditemukan. Pilihan: ${m.branches.map((b) => b.code).join(', ')} atau --hq`); process.exit(1); }
    const code = code6();
    store.addPairing({ codeHash: sha(code), branchId: br ? br.id : null, name: String(args.name || (br ? 'Kasir' : 'Komputer kantor')), terminalNo: br ? Math.max(1, +args.terminal || 1) : 0, expiresAt: Date.now() + 24 * 3600e3, createdBy: 'cli' });
    console.log(`Kode pasang ${br ? `${br.name} terminal ${Math.max(1, +args.terminal || 1)}` : 'kantor pusat'}: ${code} (berlaku 24 jam)`);
    store.close(); return;
  }
  if (cmd === 'reset-pin') {
    const pin = String(args.pin || '');
    if (!/^\d{4,6}$/.test(pin)) { console.error('PIN harus 4–6 angka: --pin 123456'); process.exit(1); }
    const q = String(args.staff || '').toLowerCase();
    const s = store.master().staff.find((x) => x.id.toLowerCase() === q || x.name.toLowerCase() === q);
    if (!s) { console.error(`Staf "${args.staff || ''}" tidak ditemukan. Ada: ${store.master().staff.map((x) => x.name).join(', ')}`); process.exit(1); }
    const { hashPin } = await import('../pos/js/core/pin.js');
    store.putMaster('staff', { ...s, pin: await hashPin(pin), active: true, updatedAt: Date.now() });
    store.dropStaffSessions(s.id);
    console.log(`PIN ${s.name} diganti.`);
    store.close(); return;
  }
  if (cmd === 'backup') {
    const out = String(args.out || path.join(path.dirname(dbFile), `cadangan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`));
    store.backup(out);
    console.log(`Cadangan dibuat: ${out}`);
    store.close(); return;
  }
  if (cmd !== 'start') { console.error(`Perintah tidak dikenal: ${cmd}`); process.exit(1); }

  await bootstrap(store, { demo: !!args.demo, ownerPin: process.env.OWNER_PIN || '' });
  const app = createApp({
    store,
    corsOrigins: String(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  const port = +(args.port || process.env.PORT || 8787);
  const host = String(args.host || process.env.HOST || '0.0.0.0');
  const server = http.createServer(app.handler);
  server.keepAliveTimeout = 65000;
  server.listen(port, host, () => console.log(`Robucca POS server ${VERSION} di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/pos/  (database: ${dbFile})`));
  const stop = () => { console.log('Menutup server…'); app.close(); server.close(() => { store.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
