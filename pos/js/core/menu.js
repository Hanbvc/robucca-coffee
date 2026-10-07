/* =========================================================
   Model menu bersama: kelompok & urutan tampil, data awal dari js/data.js,
   dan menu publik untuk pelanggan. Fungsi murni — dipakai POS (browser),
   server, dan halaman menu pelanggan (/menu/).
   ========================================================= */
import { branchPrice, isAvailable, channelPrice } from './calc.js';
import { num, pctLabel } from './money.js';

/** Urutan kelompok di semua tampilan: kasir, kantor, aplikasi pemesanan, menu pelanggan.
    Harus sama dengan MG_GROUPS di js/data.js (diperiksa tes). */
export const MENU_GROUPS = [
  { id: 'drinks', name: 'Minuman' },
  { id: 'snack', name: 'Snack' },
  { id: 'food', name: 'Makanan Berat' },
  { id: 'pastry', name: 'Pastry & Dessert' },
];
const OTHER = { id: 'other', name: 'Lainnya' };
const RANK = Object.fromEntries(MENU_GROUPS.map((g, i) => [g.id, i]));

/** Kelompok sebuah kategori. Data lama (sebelum ada kelompok Pastry) menyimpan
    kategori pastry & dessert di kelompok "snack". */
export function groupOf(cat) {
  if (!cat) return OTHER.id;
  if (cat.group === 'snack' && (cat.id === 'pastry' || cat.id === 'dessert')) return 'pastry';
  return RANK[cat.group] === undefined ? OTHER.id : cat.group;
}
export const groupName = (id) => (MENU_GROUPS.find((g) => g.id === id) || OTHER).name;

const bySort = (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || String(a.name).localeCompare(String(b.name), 'id');
/** Urutan kategori: kelompok dulu (Minuman → Snack → Makanan Berat → Pastry & Dessert), lalu nomor urut */
export const byMenuOrder = (a, b) => (RANK[groupOf(a)] ?? 99) - (RANK[groupOf(b)] ?? 99) || bySort(a, b);

/** Stasiun dapur bawaan: minuman, pastry & dessert → Bar; snack & makanan → Dapur */
export const stationOf = (cat) => (['drinks', 'pastry'].includes(groupOf(cat)) ? 'bar' : 'kitchen');

/** Kategori & menu dari js/data.js (MG_MENU) */
export function menuFromData(MENU = [], { demo = false } = {}) {
  const categories = []; const items = [];
  MENU.forEach((c, ci) => {
    categories.push({ id: c.id, name: c.name, group: c.group || '', station: stationOf(c), notes: c.notes || [], sort: ci + 1, active: true });
    c.items.forEach((it, ii) => {
      items.push({
        id: it.id, catId: c.id, name: it.name, price: it.price, img: it.img === undefined ? it.id : it.img,
        opts: it.opts ? JSON.parse(JSON.stringify(it.opts)) : [], sig: !!it.sig, active: true, sort: ii + 1,
        track: demo && ['pastry', 'dessert'].includes(c.id), low: 5,
      });
    });
  });
  return { categories, items };
}

/** Pilihan yang mengubah harga atau wajib dipilih, untuk pelanggan: ["Iced · Large +4.000", "Hot +2.000"].
    `delta(p)` = selisih harga akhir untuk tambahan p. */
export function optionNotes(opts, delta = (p) => p, max = 4) {
  const out = [];
  for (const g of opts || []) {
    const choices = g.choices || [];
    const priced = choices.some((c) => Number(c.p) > 0);
    const show = g.type === 'multi' ? priced : (g.required || priced) && choices.length > 1;
    if (!show) continue;
    const def = g.type === 'multi' ? null : (g.def || choices[0].n);
    for (const c of choices) {
      if (c.n === def) continue;
      const d = Number(c.p) > 0 ? delta(Number(c.p)) : 0;
      out.push(d > 0 ? `${c.n} +${num(d)}` : c.n);
    }
  }
  return out.slice(0, max);
}

/** Keterangan pajak & biaya layanan cabang untuk pelanggan */
export function priceNote(b) {
  const tax = Number(b.taxPct) || 0; const svc = Number(b.servicePct) || 0;
  const label = b.taxLabel || 'pajak';
  const out = [];
  if (tax) out.push(`Harga ${b.taxIncl !== false ? 'sudah' : 'belum'} termasuk ${label} ${pctLabel(tax)}.`);
  if (svc) out.push(`Biaya layanan ${pctLabel(svc)} ditambahkan saat pembayaran.`);
  return out.join(' ');
}

/** Cabang aktif yang boleh dipilih pelanggan */
export const publicBranches = (raw) => (raw.branches || []).filter((b) => b.active !== false)
  .map((b) => ({ code: b.code, name: b.name, address: b.address || '' }))
  .sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));

/**
 * Menu yang boleh dilihat pelanggan untuk satu cabang — hanya data publik
 * (tanpa staf, jumlah stok, biaya, atau pengaturan internal).
 * raw: { settings, branches, categories, items, itemBranch, channels }
 * stock: { itemId: jumlah } untuk menu yang stoknya dilacak (opsional)
 */
export function publicMenu(raw, branchId, { stock = null } = {}) {
  const b = (raw.branches || []).find((x) => x.id === branchId && x.active !== false);
  if (!b) return null;
  const settings = (raw.settings || [])[0] || {};
  const ov = new Map((raw.itemBranch || []).filter((o) => o.branchId === branchId).map((o) => [o.itemId, o]));
  const dine = (raw.channels || []).find((c) => c.type === 'dinein' && c.active !== false);
  const final = (x) => channelPrice(x, dine ? dine.markupPct : 0);
  const blockNoStock = settings.blockNoStock !== false;
  const itemsOf = {};
  for (const it of raw.items || []) if (it.active !== false) (itemsOf[it.catId] = itemsOf[it.catId] || []).push(it);

  const groups = [];
  for (const c of (raw.categories || []).filter((x) => x.active !== false).sort(byMenuOrder)) {
    const list = (itemsOf[c.id] || []).sort(bySort);
    if (!list.length) continue;
    const gid = groupOf(c);
    let g = groups.find((x) => x.id === gid);
    if (!g) { g = { id: gid, name: groupName(gid), cats: [] }; groups.push(g); }
    g.cats.push({
      id: c.id,
      name: c.name,
      items: list.map((it) => {
        const o = ov.get(it.id) || null;
        const base = branchPrice(it, o);
        const noStock = !!(it.track && blockNoStock && stock && (Number(stock[it.id]) || 0) <= 0);
        return {
          id: it.id, name: it.name, price: final(base), img: it.img || '', sig: !!it.sig,
          soldOut: !isAvailable(it, o) || noStock,
          notes: optionNotes(it.opts, (p) => final(base + p) - final(base)),
        };
      }),
    });
  }
  return {
    branch: { code: b.code, name: b.name, address: b.address || '', phone: b.phone || '', open: b.open || '', close: b.close || '', tz: b.tz || 'Asia/Jakarta' },
    priceNote: priceNote(b),
    groups,
  };
}
