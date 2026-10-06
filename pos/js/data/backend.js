/* =========================================================
   Backend perangkat POS.
   - Mode demo   : semua data di perangkat ini (IndexedDB), cocok untuk mencoba.
   - Mode server : perangkat dipasangkan ke server pusat. Transaksi ditulis lokal
                   dulu (tetap jalan saat offline) lalu dikirim lewat outbox;
                   data master & pesanan cabang ditarik dari server.
   ========================================================= */
import { LocalDB, TX_COLLS } from './local.js';
import { Master } from './master.js';
import { Remote } from './remote.js';
import { bus } from './bus.js';
import { seedMaster } from '../core/seed.js';
import { generateHistory } from './demo.js';
import { aggregate, stockLevels } from '../core/report.js';
import { verifyPin } from '../core/pin.js';
import { uuid, receiptNo, queueNo } from '../core/ids.js';
import { bizDate, addDays, zonedEpoch } from '../core/dates.js';
import { can } from '../core/perms.js';

const SYNC_EVERY = 15000;
const KEEP_DAYS = 14; // mode server: transaksi lama yang sudah terkirim dihapus dari perangkat

export class Backend {
  constructor(db) {
    this.db = db;
    this.device = null;
    this.master = null;
    this.remote = null;
    this.online = null;
    this.lastSync = 0;
    this.syncErrors = [];
    this.fails = new Map();
    // tab lain mengubah master → muat ulang
    bus.on('master', (d) => { if (d && d.remote && this.device) this.loadMaster(); });
  }

  static async create() {
    const db = await LocalDB.open();
    const b = new Backend(db);
    b.device = await db.getMeta('device', null);
    if (b.device) {
      await b.loadMaster();
      if (b.isServer) b.remote = new Remote({ url: b.device.serverUrl, token: b.device.token });
      b.syncErrors = await db.getMeta('syncErrors', []);
      b.lastSync = await db.getMeta('lastSync', 0);
    }
    return b;
  }

  get isDemo() { return !!this.device && this.device.mode === 'demo'; }
  get isServer() { return !!this.device && this.device.mode === 'server'; }
  get branch() { return this.device && this.device.branchId ? this.master.branch[this.device.branchId] || null : null; }
  today(branch = this.branch) { return bizDate(Date.now(), (branch && branch.tz) || 'Asia/Jakarta', branch && branch.dayStart); }

  async loadMaster() {
    this.master = new Master(await this.db.loadMaster());
    bus.emit('master', {}, false);
  }

  /* =========================================================
     Penyiapan perangkat
     ========================================================= */
  async setupDemo({ MENU, CONFIG, branchId = 'br-ijn', history = true, onProgress = () => {} }) {
    onProgress('Menyiapkan menu & cabang…');
    const raw = await seedMaster({ MENU, CONFIG, demo: true });
    await this.db.clear(['master', ...TX_COLLS, 'outbox']);
    await this.db.replaceMaster(raw);
    await this.loadMaster();
    if (history) {
      onProgress('Membuat riwayat transaksi contoh…');
      const h = generateHistory(new Master(raw), { days: 30 }); // urutan cabang asli: cabang utama paling ramai
      for (const coll of ['shifts', 'cashMoves', 'stockMoves', 'orders']) {
        const list = h[coll];
        for (let i = 0; i < list.length; i += 500) {
          await this.db.put(coll, list.slice(i, i + 500));
          onProgress(`Menyimpan data contoh… ${coll === 'orders' ? Math.min(100, Math.round(((i + 500) / list.length) * 100)) + '%' : ''}`);
        }
      }
    }
    this.device = { mode: 'demo', id: uuid(), name: 'Perangkat demo', branchId, terminalNo: 1, createdAt: Date.now() };
    await this.db.setMeta('device', this.device);
  }

  async pair({ url, code, name }) {
    const remote = new Remote({ url });
    const res = await remote.call('POST', '/api/pair', { code: String(code).trim(), name: String(name || '').trim() });
    await this.db.clear(['master', ...TX_COLLS, 'outbox']);
    this.remote = new Remote({ url, token: res.token });
    this.device = { mode: 'server', id: res.device.id, name: res.device.name, branchId: res.device.branchId || null, terminalNo: res.device.terminalNo || 1, serverUrl: remote.url, token: res.token, pairedAt: Date.now() };
    await this.pullMaster(true);
    await this.db.setMeta('device', this.device);
    await this.db.setMeta('feedCursor', 0);
  }

  /** Hapus semua data perangkat (kembali ke layar penyiapan) */
  async destroy() {
    if (this.remote) this.remote.stop();
    this.db.close();
    await LocalDB.destroy();
  }

  /** Mode demo: perangkat ini berpura-pura menjadi kasir cabang lain */
  async switchBranch(branchId) {
    this.device = { ...this.device, branchId };
    await this.db.setMeta('device', this.device);
  }

  /* =========================================================
     Data master
     ========================================================= */
  async pullMaster(force = false) {
    const ver = force ? null : await this.db.getMeta('masterVersion', null);
    const res = await this.remote.call('GET', '/api/master', null, { etag: ver });
    if (res.notModified) return false;
    await this.db.replaceMaster(res.master);
    await this.db.setMeta('masterVersion', res.version);
    await this.loadMaster();
    return true;
  }

  async saveMaster(coll, doc, actor) {
    const d = { ...doc, updatedAt: Date.now() };
    if (this.isServer) {
      await this.remote.call('PUT', `/api/master/${coll}`, d, { session: true });
      await this.pullMaster(true);
    } else {
      await this.db.putMaster(coll, d);
      await this.loadMaster();
      await this.audit('master.save', { coll, id: d.id, name: d.name || d.code || d.id }, actor, d.branchId || null);
      bus.emit('master', { coll });
    }
    return d;
  }

  async deleteMaster(coll, id, actor) {
    if (this.isServer) {
      await this.remote.call('DELETE', `/api/master/${coll}/${encodeURIComponent(id)}`, null, { session: true });
      await this.pullMaster(true);
    } else {
      await this.db.delMaster(coll, id);
      await this.loadMaster();
      await this.audit('master.delete', { coll, id }, actor, null);
      bus.emit('master', { coll });
    }
  }

  /* =========================================================
     Login PIN (diverifikasi di perangkat; akses kantor di mode server juga
     diverifikasi server agar data semua cabang terlindungi)
     ========================================================= */
  lockedFor(staffId) {
    const f = this.fails.get(staffId);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  async login(staff, pin) {
    if (this.lockedFor(staff.id)) return { ok: false, locked: this.lockedFor(staff.id) };
    const ok = await verifyPin(pin, staff.pin);
    if (!ok) {
      const f = this.fails.get(staff.id) || { n: 0, until: 0 };
      f.n += 1;
      if (f.n >= 5) { f.until = Date.now() + 30000; f.n = 0; }
      this.fails.set(staff.id, f);
      return { ok: false, locked: this.lockedFor(staff.id) };
    }
    this.fails.delete(staff.id);
    // sesi server untuk semua peran (izin dicek server per peran); gagal saat offline tidak menghalangi kasir
    if (this.isServer) await this.officeLogin(staff, pin).catch(() => {});
    return { ok: true };
  }
  async officeLogin(staff, pin) {
    const r = await this.remote.call('POST', '/api/login', { staffId: staff.id, pin });
    this.remote.session = r.session;
    try { sessionStorage.setItem('pos:officeSession', JSON.stringify({ s: r.session, staffId: staff.id, exp: r.expiresAt })); } catch (e) { /* noop */ }
    return r;
  }
  restoreOfficeSession(staffId) {
    if (!this.isServer) return;
    try {
      const x = JSON.parse(sessionStorage.getItem('pos:officeSession') || 'null');
      if (x && x.staffId === staffId && x.exp > Date.now()) this.remote.session = x.s;
    } catch (e) { /* noop */ }
  }
  logout() {
    if (this.remote) {
      if (this.remote.session) this.remote.call('POST', '/api/logout', {}, { session: true }).catch(() => {});
      this.remote.session = null;
    }
    try { sessionStorage.removeItem('pos:officeSession'); } catch (e) { /* noop */ }
  }
  get officeReady() { return !this.isServer || !!(this.remote && this.remote.session); }
  /** Verifikasi PIN penyetuju (manajer/pemilik) untuk void, refund, & diskon */
  async approve(staffId, pin) {
    const s = this.master.person[staffId];
    if (!s || !can(s, 'approve')) return null;
    if (this.lockedFor(s.id)) return null;
    const ok = await verifyPin(pin, s.pin);
    if (!ok) {
      const f = this.fails.get(s.id) || { n: 0, until: 0 };
      f.n += 1; if (f.n >= 5) { f.until = Date.now() + 30000; f.n = 0; }
      this.fails.set(s.id, f);
      return null;
    }
    this.fails.delete(s.id);
    return s;
  }

  /* =========================================================
     Transaksi (selalu ditulis lokal dulu)
     ========================================================= */
  async save(coll, docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const now = Date.now();
    const list = arr.map((d) => ({ ...d, updatedAt: Math.max(now, (d.updatedAt || 0) + 1), rev: (d.rev || 0) + 1 }));
    await this.db.put(coll, list, { outbox: this.isServer });
    bus.emit(coll, { ids: list.map((d) => d.id) });
    if (this.isServer) this.kick();
    return Array.isArray(docs) ? list : list[0];
  }
  get(coll, id) { return this.db.get(coll, id); }

  async nextNumber(branch, date) {
    const t = this.device.terminalNo || 1;
    const seq = await this.db.nextSeq(`seq:${branch.id}:${t}:${date}`);
    return { seq, number: receiptNo(branch.code, t, date, seq), queueNo: queueNo(t, seq) };
  }

  async audit(action, detail, actor, branchId = this.device && this.device.branchId) {
    const doc = { id: uuid(), branchId: branchId || null, at: Date.now(), action, detail: detail || {}, by: actor ? actor.id : null, byName: actor ? actor.name : 'Sistem', deviceId: this.device ? this.device.id : null };
    if (this.isServer && (!branchId || branchId !== this.device.branchId)) {
      // perangkat pusat / cabang lain: kirim langsung lewat jalur kantor (perubahan master dicatat server sendiri)
      if (!action.startsWith('master.')) await this.officeWrite('audit', doc).catch(() => {});
      return doc;
    }
    await this.save('audit', doc);
    return doc;
  }

  /* ---------- kueri lokal (layar kasir & dapur) ---------- */
  async ordersOf(branchId, from, to) { return this.db.ordersRange([branchId], from, to); }
  async openOrders(branchId) { return (await this.db.byIndex('orders', 'status', 'open')).filter((o) => o.branchId === branchId); }
  async kitchenOf(branchId, since) { return this.db.byIndex('kitchen', 'branch_at', IDBKeyRange.bound([branchId, since], [branchId, Infinity])); }
  async kitchenFor(orderId) { return this.db.byIndex('kitchen', 'orderId', orderId); }
  async currentShift() {
    const list = await this.db.byIndex('shifts', 'deviceId', this.device.id);
    return list.find((s) => s.status === 'open' && s.branchId === this.device.branchId) || null;
  }
  async shiftOrders(shiftId, branchId) {
    const t = this.today(this.master.branch[branchId]);
    const list = await this.db.ordersRange([branchId], addDays(t, -3), t);
    return list.filter((o) => o.shiftId === shiftId);
  }
  async cashMovesOf(shiftId) {
    if (this.isServer && !(await this.db.get('shifts', shiftId))) {
      return (await this.remote.call('GET', `/api/cash-moves?shift=${encodeURIComponent(shiftId)}`, null, { session: true })).rows;
    }
    return this.db.byIndex('cashMoves', 'shiftId', shiftId);
  }

  async stockLevels(branchId) {
    if (this.isServer) {
      if (branchId !== this.device.branchId) return (await this.remote.call('GET', `/api/stock?branch=${encodeURIComponent(branchId)}`, null, { session: true })).levels;
      const lv = { ...(await this.db.getMeta('stockServer', {})) };
      const keys = (await this.db.outboxKeys()).filter((k) => String(k).startsWith('stockMoves:'));
      for (const k of keys) {
        const m = await this.db.get('stockMoves', String(k).slice('stockMoves:'.length));
        if (m && m.branchId === branchId) lv[m.itemId] = (lv[m.itemId] || 0) + m.qty;
      }
      return lv;
    }
    return stockLevels(await this.db.stockMovesOf(branchId));
  }

  /* =========================================================
     Kueri kantor (mode server: dari server pusat untuk semua cabang)
     ========================================================= */
  qs(o) { return new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString(); }

  async report({ from, to, branchIds }) {
    if (this.isServer) return this.remote.call('GET', `/api/report?${this.qs({ from, to, branches: branchIds })}`, null, { session: true, timeout: 60000 });
    return aggregate(await this.db.ordersRange(branchIds, from, to), { from, to, ...this.master.names() });
  }

  async ordersQuery({ from, to, branchIds, status = '', q = '', limit = 50, offset = 0 }) {
    if (this.isServer) return this.remote.call('GET', `/api/orders?${this.qs({ from, to, branches: branchIds, status, q, limit, offset })}`, null, { session: true });
    let rows = await this.db.ordersRange(branchIds, from, to);
    if (status) rows = rows.filter((o) => (status === 'refund' ? o.kind === 'refund' : o.kind === 'sale' && o.status === status));
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((o) => [o.number, o.customer && o.customer.name, o.table, o.cashierName].some((x) => String(x || '').toLowerCase().includes(s)));
    }
    rows.sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }
  async orderById(id) {
    const local = await this.db.get('orders', id);
    if (local || !this.isServer) return local || null;
    return this.remote.call('GET', `/api/orders/${encodeURIComponent(id)}`, null, { session: true });
  }

  async shiftsQuery({ from, to, branchIds }) {
    if (this.isServer) return (await this.remote.call('GET', `/api/shifts?${this.qs({ from, to, branches: branchIds })}`, null, { session: true })).rows;
    return (await this.db.shiftsRange(branchIds, from, to)).sort((a, b) => b.openedAt - a.openedAt);
  }

  async stockMovesQuery({ branchId, limit = 200 }) {
    if (this.isServer) return (await this.remote.call('GET', `/api/stock/moves?${this.qs({ branch: branchId, limit })}`, null, { session: true })).rows;
    return (await this.db.stockMovesOf(branchId)).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async auditQuery({ from, to, branchIds, limit = 300 }) {
    if (this.isServer) return (await this.remote.call('GET', `/api/audit?${this.qs({ from, to, branches: branchIds, limit })}`, null, { session: true })).rows;
    const f = zonedEpoch(from, '00:00') - 864e5; const t = zonedEpoch(addDays(to, 1), '00:00') + 864e5; // longgar ±1 hari, lalu disaring per zona cabang
    const tzOf = (r) => ((r.branchId && this.master.branch[r.branchId]) || {}).tz || 'Asia/Jakarta';
    const rows = await this.db.byIndex('audit', 'at', IDBKeyRange.bound(f, t));
    return rows.filter((r) => (!branchIds || !r.branchId || branchIds.includes(r.branchId)) && bizDate(r.at, tzOf(r)) >= from && bizDate(r.at, tzOf(r)) <= to)
      .sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async branchStatus() {
    if (this.isServer) return (await this.remote.call('GET', '/api/branch-status', null, { session: true })).rows;
    const rows = [];
    for (const b of this.master.activeBranches()) {
      const t = this.today(b);
      const orders = await this.db.ordersRange([b.id], t, t);
      const shifts = await this.db.shiftsRange([b.id], addDays(t, -1), t);
      const paid = orders.filter((o) => o.kind === 'sale' && (o.status === 'paid' || o.status === 'refunded'));
      const last = orders.reduce((a, o) => Math.max(a, o.paidAt || o.createdAt || 0), 0);
      rows.push({ branchId: b.id, today: t, total: orders.filter((o) => o.status !== 'void' && o.status !== 'open').reduce((a, o) => a + o.totals.total, 0), orders: paid.length, openBills: orders.filter((o) => o.status === 'open').length, openShifts: shifts.filter((s) => s.status === 'open').length, lastActivity: last, lastSeen: null });
    }
    return rows;
  }

  /** Tulis transaksi dari layar kantor (mode server: langsung ke server, perlu online) */
  async officeWrite(coll, docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    if (this.isServer && !(this.device.branchId && arr.every((d) => d.branchId === this.device.branchId))) {
      const now = Date.now();
      const list = arr.map((d) => ({ ...d, updatedAt: Math.max(now, (d.updatedAt || 0) + 1), rev: (d.rev || 0) + 1 }));
      const res = await this.remote.call('POST', '/api/office/docs', { docs: list.map((doc) => ({ coll, doc })) }, { session: true });
      if (res.rejected && res.rejected.length) throw new Error(res.rejected[0].errors.join(', '));
      bus.emit(coll, { ids: list.map((d) => d.id) });
      return list;
    }
    return this.save(coll, arr);
  }

  async devices() { return (await this.remote.call('GET', '/api/devices', null, { session: true })).rows; }
  async createPairing(body) { return this.remote.call('POST', '/api/devices', body, { session: true }); }
  async revokeDevice(id) { return this.remote.call('DELETE', `/api/devices/${encodeURIComponent(id)}`, null, { session: true }); }

  /* =========================================================
     Sinkronisasi (mode server)
     ========================================================= */
  startSync() {
    if (!this.isServer || this.syncStarted) return;
    this.syncStarted = true;
    const loop = async () => { await this.syncOnce(); this.loopT = setTimeout(loop, SYNC_EVERY); };
    loop();
    this.remote.stream((e) => {
      if (e.type === 'feed') this.kick();
      else if (e.type === 'master') this.pullMaster().catch(() => {});
      else if (e.type === 'revoked') this.revoked();
    }, (on) => this.setOnline(on));
    window.addEventListener('online', () => this.kick());
    this.prune().catch(() => {});
  }
  kick() { clearTimeout(this.kickT); this.kickT = setTimeout(() => this.syncOnce(), 250); }
  setOnline(on) {
    if (this.online === on) return;
    this.online = on;
    bus.emit('net', { online: on }, false);
  }
  revoked() {
    this.isRevoked = true;
    bus.emit('revoked', {}, false);
  }
  async syncState() {
    return { online: this.online, pending: await this.db.outboxCount(), lastSync: this.lastSync, errors: this.syncErrors.length };
  }
  async syncOnce() {
    if (!this.isServer) return;
    if (this.inSync) { this.again = true; return; }
    this.inSync = true;
    try {
      await this.push();
      await this.pullFeed();
      this.lastSync = Date.now();
      await this.db.setMeta('lastSync', this.lastSync);
      this.setOnline(true);
    } catch (e) {
      if (e.status === 401) this.revoked();
      else if (e.offline) this.setOnline(false);
      else console.warn('sync', e);
    } finally {
      this.inSync = false;
      bus.emit('sync', await this.syncState(), false);
      if (this.again) { this.again = false; this.kick(); }
    }
  }
  async push() {
    for (let round = 0; round < 50; round++) {
      const batch = await this.db.outboxBatch(100);
      if (!batch.length) return;
      const docs = batch.filter((b) => b.doc).map((b) => ({ coll: b.coll, doc: b.doc }));
      const res = docs.length ? await this.remote.call('POST', '/api/sync', { docs }) : { rejected: [] };
      if (res.rejected && res.rejected.length) {
        this.syncErrors = [...res.rejected.map((r) => ({ ...r, at: Date.now() })), ...this.syncErrors].slice(0, 50);
        await this.db.setMeta('syncErrors', this.syncErrors);
      }
      await this.db.ack(batch); // diterima atau ditolak permanen → keluar dari antrean
    }
  }
  async pullFeed() {
    const since = await this.db.getMeta('feedCursor', 0);
    const res = await this.remote.call('GET', `/api/feed?since=${since}`);
    const n1 = await this.db.merge('orders', res.orders || []);
    const n2 = await this.db.merge('kitchen', res.kitchen || []);
    await this.db.setMeta('stockServer', res.stock || {});
    await this.db.setMeta('feedCursor', res.seq || since);
    // pasang ulang perangkat: lanjutkan nomor struk dari data server agar tidak dobel
    for (const o of res.orders || []) {
      if (o.deviceId && o.terminalNo === this.device.terminalNo && o.branchId === this.device.branchId) {
        const m = /-(\d{4})$/.exec(o.number || '');
        const k = `seq:${o.branchId}:${o.terminalNo}:${o.bizDate}`;
        if (m && (await this.db.getMeta(k, 0)) < +m[1]) await this.db.setMeta(k, +m[1]);
      }
    }
    if (n1) bus.emit('orders', { remote: true }, false);
    if (n2) bus.emit('kitchen', { remote: true }, false);
    if (res.stock) bus.emit('stock', {}, false);
  }
  /** Hapus transaksi lama yang sudah terkirim agar penyimpanan perangkat tidak penuh */
  async prune() {
    const pending = new Set(await this.db.outboxKeys());
    const cutoff = addDays(this.today(), -KEEP_DAYS);
    const old = (await this.db.all('orders')).filter((o) => o.bizDate < cutoff && o.status !== 'open' && !pending.has(`orders:${o.id}`));
    if (!old.length) return;
    const tx = this.db.db.transaction('orders', 'readwrite');
    old.forEach((o) => tx.objectStore('orders').delete(o.id));
  }
}
