/* Penyimpanan lokal perangkat (IndexedDB lewat localforage).
   - Mode demo   : satu-satunya database (data contoh di browser ini).
   - Mode server : salinan master + transaksi cabang; setiap perubahan dicatat di `outbox`
                   lalu dikirim ke /pos/sync saat online (kasir tetap jalan saat internet putus). */
import localforage from 'localforage';

export const DB_NAME = 'robucca-pos-v2';
export const TX_COLLS = ['orders', 'shifts', 'cashMoves', 'kitchen', 'audit'] as const;
export type TxColl = (typeof TX_COLLS)[number];
type StoreName = TxColl | 'meta' | 'outbox';

export interface OutboxEntry {
  k: string;
  coll: TxColl;
  id: string;
  /** versi dokumen saat diantrekan; dihapus hanya bila belum berubah lagi */
  ver: number;
  at: number;
}

const stores = new Map<StoreName, LocalForage>();
const st = (name: StoreName): LocalForage => {
  let s = stores.get(name);
  if (!s) {
    s = localforage.createInstance({ name: DB_NAME, storeName: name, driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE] });
    stores.set(name, s);
  }
  return s;
};

/** Antrean kunci sederhana agar baca-ubah-tulis (nomor struk) tidak balapan di tab yang sama. */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export const db = {
  async ready(): Promise<void> {
    await st('meta').ready();
  },

  async getMeta<T>(k: string, def: T): Promise<T> {
    const v = await st('meta').getItem<T>(k);
    return v ?? def;
  },
  setMeta<T>(k: string, v: T): Promise<T> {
    return st('meta').setItem(k, v);
  },
  delMeta(k: string): Promise<void> {
    return st('meta').removeItem(k);
  },
  /** Penghitung (nomor struk harian), minimal `min`. */
  nextSeq(k: string, min = 0): Promise<number> {
    return locked(async () => {
      const cur = (await st('meta').getItem<number>(k)) ?? 0;
      const n = Math.max(cur, min) + 1;
      await st('meta').setItem(k, n);
      return n;
    });
  },

  get<T>(coll: TxColl, id: string): Promise<T | null> {
    return st(coll).getItem<T>(id);
  },
  async all<T>(coll: TxColl): Promise<T[]> {
    const out: T[] = [];
    await st(coll).iterate<T, void>((v) => {
      out.push(v);
    });
    return out;
  },
  /** Simpan dokumen; `outbox` → antrekan untuk dikirim ke server. */
  async put<T extends { id: string }>(coll: TxColl, docs: T[], outbox: false | ((d: T) => number) = false): Promise<void> {
    for (const d of docs) {
      await st(coll).setItem(d.id, d);
      if (outbox) {
        const e: OutboxEntry = { k: `${coll}:${d.id}`, coll, id: d.id, ver: outbox(d), at: Date.now() };
        await st('outbox').setItem(e.k, e);
      }
    }
  },
  del(coll: TxColl, id: string): Promise<void> {
    return st(coll).removeItem(id);
  },

  async outbox(): Promise<OutboxEntry[]> {
    const out: OutboxEntry[] = [];
    await st('outbox').iterate<OutboxEntry, void>((v) => {
      out.push(v);
    });
    return out.sort((a, b) => a.at - b.at);
  },
  async pending(k: string): Promise<boolean> {
    return (await st('outbox').getItem(k)) != null;
  },
  outboxCount(): Promise<number> {
    return st('outbox').length();
  },
  /** Keluarkan dari antrean — hanya bila dokumen tidak diubah lagi sejak dikirim. */
  async ack(entries: OutboxEntry[]): Promise<void> {
    for (const e of entries) {
      const cur = await st('outbox').getItem<OutboxEntry>(e.k);
      if (cur && cur.ver === e.ver) await st('outbox').removeItem(e.k);
    }
  },

  async clear(names: StoreName[]): Promise<void> {
    for (const n of names) await st(n).clear();
  },
  async destroy(): Promise<void> {
    await localforage.dropInstance({ name: DB_NAME });
    stores.clear();
  },
};

/* ---------- penyimpanan kecil per tab/perangkat (localStorage/sessionStorage) ---------- */
export const ls = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : (JSON.parse(v) as T);
    } catch {
      return def;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* penyimpanan penuh / diblokir */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  },
};

export const ss = {
  get<T>(k: string, def: T): T {
    try {
      const v = sessionStorage.getItem(k);
      return v == null ? def : (JSON.parse(v) as T);
    } catch {
      return def;
    }
  },
  set(k: string, v: unknown): void {
    try {
      sessionStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* noop */
    }
  },
  del(k: string): void {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* noop */
    }
  },
};
