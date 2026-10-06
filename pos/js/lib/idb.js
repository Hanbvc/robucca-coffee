/* Pembungkus kecil IndexedDB berbasis Promise. */

export const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const done = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error('Transaksi IndexedDB dibatalkan'));
});

/* Safari 14 kadang tidak pernah menjawab indexedDB.open() pada pemuatan pertama; memanggil
   indexedDB.databases() berulang sampai menjawab "membangunkannya". Aman untuk browser lain. */
function wakeIDB() {
  const safari = /Safari\//.test(navigator.userAgent) && !/Chrom(e|ium)\/|Android/.test(navigator.userAgent);
  if (!safari || typeof indexedDB.databases !== 'function') return Promise.resolve();
  let t;
  return Promise.race([
    new Promise((res) => { const go = () => indexedDB.databases().then(res, res); t = setInterval(go, 100); go(); }),
    new Promise((res) => setTimeout(res, 3000)),
  ]).finally(() => clearInterval(t));
}

export async function openDB(name, version, upgrade) {
  if (!window.indexedDB) throw new Error('Browser ini tidak menyediakan penyimpanan (IndexedDB). Matikan mode privat atau gunakan Chrome/Safari terbaru.');
  await wakeIDB();
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Penyimpanan browser tidak merespons. Tutup tab POS lain, matikan mode privat, lalu muat ulang.')), 12000);
    let r;
    try { r = indexedDB.open(name, version); } catch (e) { clearTimeout(timer); rej(new Error(`Penyimpanan browser diblokir (${e.message}). Izinkan cookie & data situs untuk halaman ini.`)); return; }
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion, r.transaction);
    r.onsuccess = () => { clearTimeout(timer); res(r.result); };
    r.onerror = () => { clearTimeout(timer); rej(r.error); };
    r.onblocked = () => { clearTimeout(timer); rej(new Error('Database sedang dipakai tab lain. Tutup tab POS lain lalu muat ulang.')); };
  });
}

export const deleteDB = (name) => new Promise((res, rej) => {
  const r = indexedDB.deleteDatabase(name);
  r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res();
});

/** Ambil semua nilai lewat index + rentang kunci */
export async function getAllBy(db, store, index, range) {
  const tx = db.transaction(store, 'readonly');
  const s = tx.objectStore(store);
  return req(index ? s.index(index).getAll(range) : s.getAll(range));
}
