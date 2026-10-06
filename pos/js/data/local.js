/* =========================================================
   Penyimpanan lokal perangkat (IndexedDB).
   - Mode demo   : ini satu-satunya database (semua cabang di perangkat ini).
   - Mode server : salinan data master + transaksi cabang ini; setiap perubahan
                   dicatat di `outbox` lalu dikirim ke server saat online
                   (kasir tetap bisa berjualan ketika internet putus).
   ========================================================= */
import { openDB, req, done, deleteDB } from '../lib/idb.js';
import { MASTER_COLLS } from '../core/seed.js';

export const DB_NAME = 'robucca-pos';
const VERSION = 1;
export const TX_COLLS = ['orders', 'shifts', 'cashMoves', 'stockMoves', 'kitchen', 'audit'];

function upgrade(db) {
  const mk = (name, keyPath, indexes = []) => {
    if (db.objectStoreNames.contains(name)) return;
    const s = db.createObjectStore(name, { keyPath });
    indexes.forEach(([n, kp]) => s.createIndex(n, kp));
  };
  mk('meta', 'k');
  mk('master', 'k', [['coll', 'coll']]);
  mk('orders', 'id', [['branch_date', ['branchId', 'bizDate']], ['updatedAt', 'updatedAt'], ['status', 'status']]);
  mk('shifts', 'id', [['branch_date', ['branchId', 'bizDate']], ['deviceId', 'deviceId']]);
  mk('cashMoves', 'id', [['shiftId', 'shiftId']]);
  mk('stockMoves', 'id', [['branch_at', ['branchId', 'at']], ['branch_item', ['branchId', 'itemId']]]);
  mk('kitchen', 'id', [['orderId', 'orderId'], ['branch_at', ['branchId', 'at']]]);
  mk('audit', 'id', [['at', 'at']]);
  mk('outbox', 'k');
}

export class LocalDB {
  constructor(db) { this.db = db; }
  static async open() { return new LocalDB(await openDB(DB_NAME, VERSION, upgrade)); }
  close() { this.db.close(); }
  static destroy() { return deleteDB(DB_NAME); }

  /* ---------- meta (kunci–nilai) ---------- */
  async getMeta(k, def = null) {
    const r = await req(this.db.transaction('meta').objectStore('meta').get(k));
    return r ? r.v : def;
  }
  async setMeta(k, v) {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ k, v });
    return done(tx);
  }
  /** Penghitung atomik (nomor struk harian). IndexedDB menserialkan transaksi tulis antar-tab. */
  async nextSeq(k) {
    const tx = this.db.transaction('meta', 'readwrite');
    const s = tx.objectStore('meta');
    const cur = await req(s.get(k));
    const n = (cur ? cur.v : 0) + 1;
    s.put({ k, v: n });
    await done(tx);
    return n;
  }

  /* ---------- data master ---------- */
  async loadMaster() {
    const rows = await req(this.db.transaction('master').objectStore('master').getAll());
    const m = Object.fromEntries(MASTER_COLLS.map((c) => [c, []]));
    rows.forEach((r) => { if (m[r.coll]) m[r.coll].push(r.doc); });
    return m;
  }
  async replaceMaster(snapshot) {
    const tx = this.db.transaction('master', 'readwrite');
    const s = tx.objectStore('master');
    s.clear();
    MASTER_COLLS.forEach((coll) => (snapshot[coll] || []).forEach((doc) => s.put({ k: `${coll}:${doc.id}`, coll, doc })));
    return done(tx);
  }
  async putMaster(coll, doc) {
    const tx = this.db.transaction('master', 'readwrite');
    tx.objectStore('master').put({ k: `${coll}:${doc.id}`, coll, doc });
    return done(tx);
  }
  async delMaster(coll, id) {
    const tx = this.db.transaction('master', 'readwrite');
    tx.objectStore('master').delete(`${coll}:${id}`);
    return done(tx);
  }

  /* ---------- transaksi ---------- */
  /** Simpan dokumen; `outbox: true` → antrekan untuk dikirim ke server */
  async put(coll, docs, { outbox = false } = {}) {
    const list = Array.isArray(docs) ? docs : [docs];
    const stores = outbox ? [coll, 'outbox'] : [coll];
    const tx = this.db.transaction(stores, 'readwrite');
    const s = tx.objectStore(coll); const o = outbox ? tx.objectStore('outbox') : null;
    list.forEach((d) => {
      s.put(d);
      if (o) o.put({ k: `${coll}:${d.id}`, coll, id: d.id, rev: d.rev || 0 });
    });
    return done(tx);
  }
  /** Simpan dokumen dari server — tidak ditimpa bila versi lokal lebih baru & belum terkirim */
  async merge(coll, docs) {
    if (!docs.length) return 0;
    const tx = this.db.transaction([coll, 'outbox'], 'readwrite');
    const s = tx.objectStore(coll); const o = tx.objectStore('outbox');
    let n = 0;
    await Promise.all(docs.map(async (d) => {
      const pending = await req(o.get(`${coll}:${d.id}`));
      if (pending) return; // perubahan lokal menunggu dikirim → menang sampai terkirim
      const cur = await req(s.get(d.id));
      if (cur && (cur.updatedAt || 0) > (d.updatedAt || 0)) return;
      s.put(d); n += 1;
    }));
    await done(tx);
    return n;
  }
  get(coll, id) { return req(this.db.transaction(coll).objectStore(coll).get(id)); }
  all(coll) { return req(this.db.transaction(coll).objectStore(coll).getAll()); }
  byIndex(coll, index, range) { return req(this.db.transaction(coll).objectStore(coll).index(index).getAll(range)); }
  count(coll) { return req(this.db.transaction(coll).objectStore(coll).count()); }
  async clear(colls) {
    const tx = this.db.transaction(colls, 'readwrite');
    colls.forEach((c) => tx.objectStore(c).clear());
    return done(tx);
  }

  /** Pesanan cabang (null = semua) pada rentang tanggal bisnis */
  async ordersRange(branchIds, from, to) {
    if (!branchIds) {
      const all = await this.all('orders');
      return all.filter((o) => o.bizDate >= from && o.bizDate <= to);
    }
    const out = await Promise.all(branchIds.map((b) => this.byIndex('orders', 'branch_date', IDBKeyRange.bound([b, from], [b, to]))));
    return out.flat();
  }
  async shiftsRange(branchIds, from, to) {
    if (!branchIds) {
      const all = await this.all('shifts');
      return all.filter((o) => o.bizDate >= from && o.bizDate <= to);
    }
    const out = await Promise.all(branchIds.map((b) => this.byIndex('shifts', 'branch_date', IDBKeyRange.bound([b, from], [b, to]))));
    return out.flat();
  }
  stockMovesOf(branchId) { return this.byIndex('stockMoves', 'branch_at', IDBKeyRange.bound([branchId, 0], [branchId, Infinity])); }

  /* ---------- outbox ---------- */
  async outboxBatch(limit = 100) {
    const tx = this.db.transaction('outbox');
    const rows = await req(tx.objectStore('outbox').getAll(null, limit));
    const out = [];
    for (const r of rows) {
      const doc = await this.get(r.coll, r.id);
      out.push({ ...r, doc });
    }
    return out;
  }
  /** Hapus antrean yang sudah diterima server — hanya bila tidak diubah lagi sejak dikirim */
  async ack(entries) {
    const tx = this.db.transaction('outbox', 'readwrite');
    const o = tx.objectStore('outbox');
    await Promise.all(entries.map(async (e) => {
      const cur = await req(o.get(e.k));
      if (cur && cur.rev === e.rev) o.delete(e.k);
    }));
    return done(tx);
  }
  outboxCount() { return this.count('outbox'); }
  outboxKeys() { return req(this.db.transaction('outbox').objectStore('outbox').getAllKeys()); }
}
