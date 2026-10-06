/* =========================================================
   Harga, diskon, biaya layanan, pajak (PB1/PBJT), dan pembulatan.
   Fungsi murni — dipakai kasir (browser) dan diverifikasi ulang oleh server.
   ========================================================= */
import { roundTo } from './money.js';

/** Harga kanal ojol dibulatkan ke atas ke kelipatan ini (Rp500). */
export const MARKUP_ROUND = 500;

/** Harga di kanal (GoFood/GrabFood/…): harga × (100 + markup)% dibulatkan ke atas ke Rp500. */
export function channelPrice(base, markupPct) {
  const m = Number(markupPct) || 0;
  if (!m) return base;
  return Math.ceil((base * (100 + m)) / 100 / MARKUP_ROUND - 1e-9) * MARKUP_ROUND;
}

/* ---------- Opsi menu (struktur sama dengan js/data.js) ----------
   grup: { id, name, type: 'single'|'multi', required?, def?, choices: [{ n, p? }], showIf? } */
export function groupVisible(g, sel) {
  return !g.showIf || Object.entries(g.showIf).every(([k, v]) => (Array.isArray(v) ? v.includes(sel[k]) : sel[k] === v));
}

/** Pilihan bawaan untuk sebuah menu */
export function defaultSel(item) {
  const sel = {};
  (item.opts || []).forEach((g) => {
    if (g.type === 'multi') sel[g.id] = [];
    else if (g.def) sel[g.id] = g.def;
    else if (!g.required && g.choices.length) sel[g.id] = g.choices[0].n;
  });
  return sel;
}

/** Grup wajib yang belum dipilih → nama grup; kosong berarti valid */
export function missingRequired(item, sel) {
  return (item.opts || []).filter((g) => g.required && groupVisible(g, sel) && (sel[g.id] == null || sel[g.id] === '')).map((g) => g.name);
}

/** Pilihan yang berlaku → [{ gid, g, n, p }] (grup tersembunyi diabaikan) */
export function chosenMods(item, sel) {
  const out = [];
  (item.opts || []).forEach((g) => {
    if (!groupVisible(g, sel)) return;
    const v = sel[g.id];
    if (v == null) return;
    (Array.isArray(v) ? v : [v]).forEach((n) => {
      const c = g.choices.find((x) => x.n === n);
      if (c) out.push({ gid: g.id, g: g.name, n: c.n, p: Math.round(Number(c.p) || 0) });
    });
  });
  return out;
}

/** Ringkasan pilihan untuk struk/dapur. Pilihan bawaan grup opsional tidak ditampilkan. */
export function modsSummary(item, mods) {
  const parts = [];
  mods.forEach((m) => {
    const g = item && (item.opts || []).find((x) => x.id === m.gid);
    if (g && !g.required && g.type !== 'multi' && g.choices[0] && g.choices[0].n === m.n) return;
    parts.push(g && g.type === 'multi' ? `+ ${m.n}` : m.n);
  });
  return parts.join(' · ');
}

/* ---------- Ketersediaan & harga per cabang ---------- */
/** override = itemBranch[`${branchId}:${itemId}`] → { price?, available? } */
export const branchPrice = (item, ov) => (ov && ov.price != null && ov.price !== '' ? Math.round(Number(ov.price)) : item.price);
export const isAvailable = (item, ov) => item.active !== false && !(ov && ov.available === false);

/** Satu baris pesanan dari menu + pilihan. `base` = harga cabang + opsi (sebelum markup kanal). */
export function buildLine(item, sel, { qty = 1, note = '', ov = null, markupPct = 0, station = '', id = '' } = {}) {
  const mods = chosenMods(item, sel);
  const base = branchPrice(item, ov) + mods.reduce((a, m) => a + m.p, 0);
  return {
    id, itemId: item.id, name: item.name, catId: item.catId, station,
    sel: { ...sel }, mods, sum: modsSummary(item, mods),
    note: String(note || '').trim(), qty, base, price: channelPrice(base, markupPct), disc: null,
  };
}

/** Kunci penggabungan baris: menu, pilihan, catatan, dan harga sama → digabung */
export const lineKey = (l) => `${l.itemId}|${JSON.stringify(Object.keys(l.sel || {}).sort().map((k) => [k, l.sel[k]]))}|${(l.note || '').toLowerCase()}|${l.price}`;

/* ---------- Diskon ---------- */
/** d = { type: 'pct'|'amt', value } → nominal diskon (dibatasi 0..base) */
export function discAmount(d, base) {
  if (!d || base <= 0) return 0;
  const v = Number(d.value) || 0;
  const a = d.type === 'pct' ? Math.round((base * Math.min(Math.max(v, 0), 100)) / 100) : Math.round(v);
  return Math.max(0, Math.min(a, base));
}

/** Membagi `amount` ke tiap bobot secara proporsional (sisa pembagian ke pecahan terbesar). Σ hasil = amount. */
export function allocate(amount, weights) {
  const total = weights.reduce((a, w) => a + w, 0);
  if (!amount || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const out = raw.map((x) => Math.floor(x + 1e-9));
  let rest = amount - out.reduce((a, x) => a + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x + 1e-9), i]).sort((a, b) => b[0] - a[0]);
  while (rest > 0) {
    let moved = false;
    for (const [, i] of order) {
      if (rest <= 0) break;
      if (out[i] < weights[i]) { out[i] += 1; rest -= 1; moved = true; }
    }
    if (!moved) break;
  }
  return out;
}

/* ---------- Total pesanan ----------
   cfg = { taxPct, taxIncl, taxService, servicePct, roundUnit, roundMode }
   - Harga termasuk pajak (taxIncl): pajak = bagian PB1 di dalam harga; total = harga setelah diskon (+ servis & pajaknya).
   - Harga belum termasuk pajak: pajak = (penjualan + servis) × tarif.
   Identitas yang selalu berlaku: total = net + service + tax + rounding. */
export const DEFAULT_CFG = { taxPct: 0, taxIncl: true, taxService: true, servicePct: 0, roundUnit: 100, roundMode: 'down' };

export function calcOrder(order, cfgIn) {
  const cfg = { ...DEFAULT_CFG, ...(cfgIn || {}) };
  const taxPct = Math.max(0, Number(cfg.taxPct) || 0);
  const servicePct = Math.max(0, Number(cfg.servicePct) || 0);
  const lines = (order.lines || []).filter((l) => !l.voided);

  let gross = 0; let lineDisc = 0; let items = 0;
  const bases = lines.map((l) => {
    const g = Math.round(l.price) * l.qty;
    const d = discAmount(l.disc, g);
    gross += g; lineDisc += d; items += l.qty;
    return g - d;
  });
  const sub = gross - lineDisc;
  const orderDisc = discAmount(order.discount, sub);
  const alloc = allocate(orderDisc, bases);
  const sales = sub - orderDisc;

  let net; let service; let tax;
  if (cfg.taxIncl) {
    const taxItems = taxPct ? Math.round((sales * taxPct) / (100 + taxPct)) : 0;
    net = sales - taxItems;
    service = Math.round((net * servicePct) / 100);
    tax = taxItems + (cfg.taxService ? Math.round((service * taxPct) / 100) : 0);
  } else {
    net = sales;
    service = Math.round((net * servicePct) / 100);
    tax = Math.round(((net + (cfg.taxService ? service : 0)) * taxPct) / 100);
  }
  const raw = net + service + tax;
  const total = roundTo(raw, cfg.roundUnit, cfg.roundMode);
  const amounts = lines.map((l, i) => ({ id: l.id, gross: Math.round(l.price) * l.qty, disc: Math.round(l.price) * l.qty - bases[i] + alloc[i], amount: bases[i] - alloc[i] }));
  return {
    totals: { items, gross, lineDisc, orderDisc, discount: lineDisc + orderDisc, sales, net, service, tax, rounding: total - raw, total },
    amounts,
  };
}

/** Konfigurasi pajak/servis/pembulatan dari cabang + pengaturan pusat (disalin ke tiap pesanan) */
export function cfgFor(branch, settings) {
  return {
    taxPct: Number(branch && branch.taxPct) || 0,
    taxIncl: !(branch && branch.taxIncl === false),
    taxService: !(branch && branch.taxService === false),
    servicePct: Number(branch && branch.servicePct) || 0,
    roundUnit: Number(settings && settings.roundUnit) || 1,
    roundMode: (settings && settings.roundMode) || 'down',
  };
}

/** Terapkan hasil hitung ke dokumen pesanan (mengembalikan salinan baru) */
export function applyTotals(order, cfg) {
  const { totals, amounts } = calcOrder(order, cfg);
  const byId = new Map(amounts.map((a) => [a.id, a]));
  return {
    ...order,
    cfg: { ...cfg },
    totals,
    lines: order.lines.map((l) => {
      const a = byId.get(l.id);
      return a ? { ...l, gross: a.gross, discAmt: a.disc, amount: a.amount } : { ...l, gross: 0, discAmt: 0, amount: 0 };
    }),
    discount: order.discount ? { ...order.discount, amount: totals.orderDisc } : null,
  };
}

/* ---------- Pembayaran ----------
   payments: [{ method, type: 'cash'|'noncash'|'platform', amount, tendered?, ref? }]
   amount = nominal yang dipakai untuk tagihan; tendered = uang diterima (tunai). */
export function paySummary(total, payments) {
  const applied = (payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const tendered = (payments || []).reduce((a, p) => a + (p.type === 'cash' ? Number(p.tendered ?? p.amount) || 0 : Number(p.amount) || 0), 0);
  return { applied, remaining: Math.max(0, total - applied), change: Math.max(0, tendered - total), tendered };
}

/** Saran nominal uang tunai: uang pas, lalu pecahan berikutnya yang lazim */
export function cashSuggestions(amount) {
  if (amount <= 0) return [];
  const out = new Set([amount]);
  [5000, 10000, 20000, 50000, 100000].forEach((step) => {
    const v = Math.ceil(amount / step) * step;
    if (v > amount) out.add(v);
  });
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
