/* Pembungkus kecil IndexedDB berbasis Promise. */

export const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const done = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error('Transaksi IndexedDB dibatalkan'));
});

export function openDB(name, version, upgrade) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion, r.transaction);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database sedang dipakai tab lain. Tutup tab POS lain lalu muat ulang.'));
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
