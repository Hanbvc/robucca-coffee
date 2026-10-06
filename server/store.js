/* =========================================================
   Database pusat (SQLite lewat node:sqlite bawaan Node.js 22.13+).
   - master : data master (menu, cabang, staf, …) sebagai dokumen JSON
   - docs   : transaksi semua cabang (pesanan, shift, kas, stok, dapur, log)
              dengan kolom indeks untuk laporan cepat per cabang & tanggal
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MASTER_COLLS } from '../pos/js/core/seed.js';
import { bizDate } from '../pos/js/core/dates.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS master (coll TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (coll, id));
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, branch_id TEXT, terminal_no INTEGER, token_hash TEXT UNIQUE,
  created_at INTEGER, created_by TEXT, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pairings (
  code_hash TEXT PRIMARY KEY, branch_id TEXT, name TEXT, terminal_no INTEGER, expires_at INTEGER, created_by TEXT, used_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, device_id TEXT NOT NULL, created_at INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL, id TEXT NOT NULL, branch_id TEXT, biz_date TEXT, at INTEGER, updated_at INTEGER NOT NULL, seq INTEGER NOT NULL,
  device_id TEXT, status TEXT, ref TEXT, item_id TEXT, qty INTEGER, doc TEXT NOT NULL, PRIMARY KEY (coll, id));
CREATE INDEX IF NOT EXISTS docs_branch_date ON docs (coll, branch_id, biz_date);
CREATE INDEX IF NOT EXISTS docs_branch_seq ON docs (coll, branch_id, seq);
CREATE INDEX IF NOT EXISTS docs_branch_item ON docs (coll, branch_id, item_id);
CREATE INDEX IF NOT EXISTS docs_ref ON docs (coll, ref);
CREATE INDEX IF NOT EXISTS docs_status ON docs (coll, branch_id, status);
`;

const J = (s) => JSON.parse(s);

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.seq = Number(this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM docs').get().s);
    this.st = {};
    this.masterCache = null;
  }
  close() { this.db.close(); }
  q(sql) { if (!this.st[sql]) this.st[sql] = this.db.prepare(sql); return this.st[sql]; }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /* ---------- meta ---------- */
  getMeta(k, def = null) { const r = this.q('SELECT v FROM meta WHERE k = ?').get(k); return r ? J(r.v) : def; }
  setMeta(k, v) { this.q('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v)); }
  get isEmpty() { return !this.q('SELECT 1 FROM master LIMIT 1').get(); }

  /* ---------- master ---------- */
  master() {
    if (this.masterCache) return this.masterCache;
    const m = Object.fromEntries(MASTER_COLLS.map((c) => [c, []]));
    for (const r of this.q('SELECT coll, doc FROM master ORDER BY coll, id').all()) if (m[r.coll]) m[r.coll].push(J(r.doc));
    this.masterCache = m;
    return m;
  }
  masterVersion() { return this.getMeta('masterVersion', 1); }
  getMaster(coll, id) { const r = this.q('SELECT doc FROM master WHERE coll = ? AND id = ?').get(coll, id); return r ? J(r.doc) : null; }
  putMaster(coll, doc) {
    this.q('INSERT INTO master (coll, id, doc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at')
      .run(coll, doc.id, JSON.stringify(doc), Date.now());
    this.bumpMaster();
  }
  delMaster(coll, id) { this.q('DELETE FROM master WHERE coll = ? AND id = ?').run(coll, id); this.bumpMaster(); }
  bumpMaster() { this.masterCache = null; this.setMeta('masterVersion', this.masterVersion() + 1); }
  replaceMaster(snapshot) {
    this.tx(() => {
      this.q('DELETE FROM master').run();
      for (const c of MASTER_COLLS) for (const d of snapshot[c] || []) this.q('INSERT INTO master (coll, id, doc, updated_at) VALUES (?, ?, ?, ?)').run(c, d.id, JSON.stringify(d), Date.now());
      this.bumpMaster();
    });
  }
  branchTz(branchId) { const b = this.master().branches.find((x) => x.id === branchId); return { tz: (b && b.tz) || 'Asia/Jakarta', dayStart: (b && b.dayStart) || 0 }; }

  /* ---------- dokumen transaksi ---------- */
  /** Kolom indeks dari dokumen */
  cols(coll, d) {
    const { tz, dayStart } = this.branchTz(d.branchId);
    const at = d.paidAt || d.at || d.openedAt || d.createdAt || d.updatedAt || Date.now();
    return {
      branch_id: d.branchId || null,
      biz_date: d.bizDate || bizDate(at, tz, dayStart),
      at,
      status: coll === 'orders' ? (d.kind === 'refund' ? 'refund' : d.status) : coll === 'shifts' ? d.status : coll === 'kitchen' ? (d.done ? 'done' : 'todo') : null,
      ref: coll === 'cashMoves' ? d.shiftId : coll === 'kitchen' ? d.orderId : coll === 'stockMoves' ? d.ref || null : null,
      item_id: coll === 'stockMoves' ? d.itemId : null,
      qty: coll === 'stockMoves' ? d.qty : null,
    };
  }
  getDoc(coll, id) { const r = this.q('SELECT doc, branch_id, updated_at FROM docs WHERE coll = ? AND id = ?').get(coll, id); return r ? { doc: J(r.doc), branchId: r.branch_id, updatedAt: r.updated_at } : null; }
  /**
   * Simpan dengan aturan "versi terbaru menang" (updatedAt).
   * Kembalikan 'saved' | 'stale' (versi server lebih baru) | 'conflict' (milik cabang lain)
   */
  upsert(coll, d, deviceId) {
    const ex = this.q('SELECT branch_id, updated_at FROM docs WHERE coll = ? AND id = ?').get(coll, d.id);
    if (ex && ex.branch_id !== (d.branchId || null)) return 'conflict';
    const upd = d.updatedAt || Date.now();
    if (ex && ex.updated_at > upd) return 'stale';
    const c = this.cols(coll, d);
    this.seq += 1;
    this.q(`INSERT INTO docs (coll, id, branch_id, biz_date, at, updated_at, seq, device_id, status, ref, item_id, qty, doc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(coll, id) DO UPDATE SET branch_id = excluded.branch_id, biz_date = excluded.biz_date, at = excluded.at, updated_at = excluded.updated_at,
        seq = excluded.seq, device_id = excluded.device_id, status = excluded.status, ref = excluded.ref, item_id = excluded.item_id, qty = excluded.qty, doc = excluded.doc`)
      .run(coll, d.id, c.branch_id, c.biz_date, c.at, upd, this.seq, deviceId || null, c.status, c.ref, c.item_id, c.qty, JSON.stringify({ ...d, updatedAt: upd }));
    return 'saved';
  }

  /** Feed perangkat: pesanan & status dapur cabangnya yang berubah setelah `since` */
  feed(branchId, since, limit = 1000) {
    const recent = Date.now() - 48 * 3600e3;
    const rows = since > 0
      ? this.q('SELECT coll, doc, seq FROM docs WHERE coll IN (\'orders\', \'kitchen\') AND branch_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(branchId, since, limit)
      : this.q('SELECT coll, doc, seq FROM docs WHERE coll IN (\'orders\', \'kitchen\') AND branch_id = ? AND (updated_at > ? OR status = \'open\') ORDER BY seq LIMIT ?').all(branchId, recent, limit * 5);
    const out = { orders: [], kitchen: [], seq: since > 0 ? since : this.seq };
    for (const r of rows) { out[r.coll].push(J(r.doc)); if (since > 0) out.seq = Math.max(out.seq, r.seq); }
    if (since > 0 && rows.length < limit) out.seq = Math.max(out.seq, this.seq);
    return out;
  }

  /* ---------- kueri laporan ---------- */
  branchFilter(branchIds) {
    if (!branchIds) return { sql: '', args: [] };
    if (!branchIds.length) return { sql: ' AND 0', args: [] };
    return { sql: ` AND branch_id IN (${branchIds.map(() => '?').join(',')})`, args: branchIds };
  }
  ordersRange(branchIds, from, to) {
    const f = this.branchFilter(branchIds);
    return this.db.prepare(`SELECT doc FROM docs WHERE coll = 'orders' AND biz_date BETWEEN ? AND ?${f.sql}`).all(from, to, ...f.args).map((r) => J(r.doc));
  }
  ordersPage(branchIds, { from, to, status, q, limit, offset }) {
    const f = this.branchFilter(branchIds);
    let where = `coll = 'orders' AND biz_date BETWEEN ? AND ?${f.sql}`; const args = [from, to, ...f.args];
    if (status === 'refund') { where += ' AND status = \'refund\''; } else if (status) { where += ' AND status = ?'; args.push(status); }
    if (q) {
      where += ` AND (json_extract(doc, '$.number') LIKE ? OR json_extract(doc, '$.customer.name') LIKE ? OR json_extract(doc, '$.table') LIKE ? OR json_extract(doc, '$.cashierName') LIKE ?)`;
      const like = `%${q}%`; args.push(like, like, like, like);
    }
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE ${where}`).get(...args).n;
    const rows = this.db.prepare(`SELECT doc FROM docs WHERE ${where} ORDER BY at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map((r) => J(r.doc));
    return { total: Number(total), rows };
  }
  docsRange(coll, branchIds, from, to, limit = 5000) {
    const f = this.branchFilter(branchIds);
    return this.db.prepare(`SELECT doc FROM docs WHERE coll = ? AND biz_date BETWEEN ? AND ?${f.sql} ORDER BY at DESC LIMIT ?`).all(coll, from, to, ...f.args, limit).map((r) => J(r.doc));
  }
  byRef(coll, ref) { return this.q('SELECT doc FROM docs WHERE coll = ? AND ref = ? ORDER BY at').all(coll, ref).map((r) => J(r.doc)); }
  stockLevels(branchId) {
    const out = {};
    for (const r of this.q('SELECT item_id, SUM(qty) AS q FROM docs WHERE coll = \'stockMoves\' AND branch_id = ? GROUP BY item_id').all(branchId)) out[r.item_id] = Number(r.q);
    return out;
  }
  stockMoves(branchId, limit) { return this.q('SELECT doc FROM docs WHERE coll = \'stockMoves\' AND branch_id = ? ORDER BY at DESC LIMIT ?').all(branchId, limit).map((r) => J(r.doc)); }
  countStatus(coll, branchId, status) { return Number(this.q('SELECT COUNT(*) AS n FROM docs WHERE coll = ? AND branch_id = ? AND status = ?').get(coll, branchId, status).n); }

  /* ---------- perangkat, kode pasang, sesi ---------- */
  device(id) { return this.q('SELECT * FROM devices WHERE id = ?').get(id) || null; }
  deviceByToken(hash) { return this.q('SELECT * FROM devices WHERE token_hash = ? AND revoked = 0').get(hash) || null; }
  devices() { return this.q('SELECT id, name, branch_id, terminal_no, created_at, created_by, last_seen, revoked FROM devices ORDER BY branch_id, terminal_no').all(); }
  addDevice(d) { this.q('INSERT INTO devices (id, name, branch_id, terminal_no, token_hash, created_at, created_by, last_seen, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(d.id, d.name, d.branchId, d.terminalNo, d.tokenHash, Date.now(), d.createdBy || null, Date.now()); }
  touchDevice(id) { this.q('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), id); }
  revokeDevice(id) { this.q('UPDATE devices SET revoked = 1, token_hash = NULL WHERE id = ?').run(id); this.q('DELETE FROM sessions WHERE device_id = ?').run(id); }
  addPairing(p) { this.q('INSERT INTO pairings (code_hash, branch_id, name, terminal_no, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(p.codeHash, p.branchId, p.name, p.terminalNo, p.expiresAt, p.createdBy || null); }
  takePairing(hash) {
    return this.tx(() => {
      const p = this.q('SELECT * FROM pairings WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').get(hash, Date.now());
      if (p) this.q('UPDATE pairings SET used_at = ? WHERE code_hash = ?').run(Date.now(), hash);
      return p || null;
    });
  }
  addSession(s) { this.q('INSERT INTO sessions (token_hash, staff_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(s.tokenHash, s.staffId, s.deviceId, Date.now(), s.expiresAt); }
  session(hash) { return this.q('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash, Date.now()) || null; }
  dropSession(hash) { this.q('DELETE FROM sessions WHERE token_hash = ?').run(hash); }
  dropStaffSessions(staffId) { this.q('DELETE FROM sessions WHERE staff_id = ?').run(staffId); }
  cleanup() { this.q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); this.q('DELETE FROM pairings WHERE expires_at < ?').run(Date.now() - 864e5); }

  backup(file) { this.db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`); }
}
