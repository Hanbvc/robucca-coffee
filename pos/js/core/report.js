/* =========================================================
   Agregasi laporan dari dokumen transaksi.
   Dipakai di browser (mode demo) dan di server (semua cabang) agar angka sama persis.

   Aturan:
   - Penjualan (kind 'sale') status 'paid'/'refunded' dihitung pada tanggal bisnis saat dibayar.
   - Refund (kind 'refund') bernilai negatif dan dihitung pada tanggal refund dilakukan.
   - Void (dibatalkan) tidak masuk penjualan; dicatat terpisah.
   - Tagihan terbuka ('open') belum dihitung.
   ========================================================= */
import { daysBetween } from './dates.js';

const counted = (o) => (o.kind === 'refund' ? o.status !== 'void' : o.status === 'paid' || o.status === 'refunded');
const bump = (map, key, init) => { let v = map.get(key); if (!v) { v = init(); map.set(key, v); } return v; };
const desc = (k) => (a, b) => b[k] - a[k];

export function aggregate(orders, opt = {}) {
  const names = {
    branch: opt.branchNames || {}, pay: opt.payNames || {}, channel: opt.channelNames || {}, cat: opt.catNames || {},
  };
  const kpi = { orders: 0, refunds: 0, refundTotal: 0, voids: 0, voidTotal: 0, gross: 0, discount: 0, net: 0, service: 0, tax: 0, rounding: 0, total: 0, items: 0, salesTotal: 0, avg: 0 };
  const days = new Map(); const hours = new Map(); const branches = new Map(); const pays = new Map();
  const channels = new Map(); const items = new Map(); const cats = new Map(); const cashiers = new Map(); const discs = new Map();
  const voidList = []; const refundList = [];

  for (const o of orders) {
    const t = o.totals || {};
    if (o.kind !== 'refund' && o.status === 'void') {
      kpi.voids += 1; kpi.voidTotal += t.total || 0;
      voidList.push(o);
      continue;
    }
    if (!counted(o)) continue;
    const sign = o.kind === 'refund' ? -1 : 1;
    if (sign > 0) { kpi.orders += 1; kpi.salesTotal += t.total || 0; } else { kpi.refunds += 1; kpi.refundTotal += -(t.total || 0); refundList.push(o); }
    kpi.gross += t.gross || 0; kpi.discount += t.discount || 0; kpi.net += t.net || 0; kpi.service += t.service || 0;
    kpi.tax += t.tax || 0; kpi.rounding += t.rounding || 0; kpi.total += t.total || 0; kpi.items += t.items || 0;

    const d = bump(days, o.bizDate, () => ({ date: o.bizDate, total: 0, net: 0, orders: 0, tax: 0 }));
    d.total += t.total || 0; d.net += t.net || 0; d.tax += t.tax || 0; if (sign > 0) d.orders += 1;
    const h = bump(hours, o.bizHour ?? 0, () => ({ hour: o.bizHour ?? 0, total: 0, orders: 0, items: 0, net: 0, discount: 0, salesTotal: 0 }));
    h.total += t.total || 0; h.items += t.items || 0; h.net += t.net || 0; h.discount += t.discount || 0;
    if (sign > 0) { h.orders += 1; h.salesTotal += t.total || 0; }
    const b = bump(branches, o.branchId, () => ({ id: o.branchId, name: names.branch[o.branchId] || o.branchId, total: 0, net: 0, orders: 0, items: 0 }));
    b.total += t.total || 0; b.net += t.net || 0; b.items += t.items || 0; if (sign > 0) b.orders += 1;
    const c = bump(channels, o.channel || 'other', () => ({ id: o.channel || 'other', name: names.channel[o.channel] || o.channelName || o.channel || 'Lainnya', total: 0, orders: 0 }));
    c.total += t.total || 0; if (sign > 0) c.orders += 1;
    const k = bump(cashiers, o.cashierId || '-', () => ({ id: o.cashierId || '-', name: o.cashierName || '-', total: 0, orders: 0 }));
    k.total += t.total || 0; if (sign > 0) k.orders += 1;
    if (sign > 0 && o.discount && o.discount.amount) {
      const x = bump(discs, o.discount.name || 'Diskon', () => ({ name: o.discount.name || 'Diskon', count: 0, amount: 0 }));
      x.count += 1; x.amount += o.discount.amount;
    }
    for (const p of o.payments || []) {
      const x = bump(pays, p.method, () => ({ method: p.method, name: names.pay[p.method] || p.name || p.method, amount: 0, count: 0 }));
      x.amount += p.amount || 0; if (sign > 0) x.count += 1;
    }
    for (const l of o.lines || []) {
      if (l.voided) continue;
      const it = bump(items, l.itemId, () => ({ id: l.itemId, name: l.name, catId: l.catId, qty: 0, gross: 0, disc: 0, amount: 0 }));
      it.qty += l.qty || 0; it.gross += l.gross || 0; it.disc += l.discAmt || 0; it.amount += l.amount || 0;
      const ct = bump(cats, l.catId || '-', () => ({ id: l.catId || '-', name: names.cat[l.catId] || l.catId || 'Lainnya', qty: 0, amount: 0 }));
      ct.qty += l.qty || 0; ct.amount += l.amount || 0;
    }
  }
  kpi.avg = kpi.orders ? Math.round(kpi.salesTotal / kpi.orders) : 0;

  const dayList = opt.from && opt.to
    ? daysBetween(opt.from, opt.to).map((s) => days.get(s) || { date: s, total: 0, net: 0, orders: 0, tax: 0 })
    : [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const hourList = Array.from({ length: 24 }, (_, i) => hours.get(i) || { hour: i, total: 0, orders: 0, items: 0, net: 0, discount: 0, salesTotal: 0 });

  return {
    kpi,
    days: dayList,
    hours: hourList,
    branches: [...branches.values()].sort(desc('total')),
    payments: [...pays.values()].sort(desc('amount')),
    channels: [...channels.values()].sort(desc('total')),
    items: [...items.values()].sort((a, b) => b.amount - a.amount || b.qty - a.qty),
    categories: [...cats.values()].sort(desc('amount')),
    cashiers: [...cashiers.values()].sort(desc('total')),
    discounts: [...discs.values()].sort(desc('amount')),
    voids: voidList.map(slim).sort((a, b) => b.at - a.at),
    refunds: refundList.map(slim).sort((a, b) => b.at - a.at),
  };
}

const slim = (o) => ({
  id: o.id, number: o.number, branchId: o.branchId, bizDate: o.bizDate, at: o.voidAt || o.paidAt || o.createdAt,
  total: o.totals ? o.totals.total : 0, reason: o.voidReason || o.reason || '', by: o.voidByName || o.cashierName || '', refOf: o.refOf || null, refNumber: o.refNumber || null, wasPaid: !!o.paidAt,
});

/* ---------- Shift kasir ----------
   expected = kas awal + tunai masuk dari penjualan − tunai refund + kas masuk − kas keluar */
export function shiftSummary(shift, orders, cashMoves) {
  const byMethod = new Map();
  let cashSales = 0; let cashRefunds = 0; let total = 0; let count = 0; let refunds = 0; let voids = 0;
  for (const o of orders) {
    if (o.shiftId !== shift.id) continue;
    if (o.kind !== 'refund' && o.status === 'void') { voids += 1; continue; }
    if (!counted(o)) continue;
    const sign = o.kind === 'refund' ? -1 : 1;
    total += (o.totals && o.totals.total) || 0;
    if (sign > 0) count += 1; else refunds += 1;
    for (const p of o.payments || []) {
      const x = bump(byMethod, p.method, () => ({ method: p.method, name: p.name || p.method, amount: 0, count: 0 }));
      x.amount += p.amount || 0; if (sign > 0) x.count += 1;
      if (p.type === 'cash') { if (sign > 0) cashSales += p.amount || 0; else cashRefunds += -(p.amount || 0); }
    }
  }
  let cashIn = 0; let cashOut = 0;
  for (const m of cashMoves) {
    if (m.shiftId !== shift.id) continue;
    if (m.type === 'in') cashIn += m.amount; else cashOut += m.amount;
  }
  const expected = (shift.openingCash || 0) + cashSales - cashRefunds + cashIn - cashOut;
  return { count, refunds, voids, total, cashSales, cashRefunds, cashIn, cashOut, expected, byMethod: [...byMethod.values()].sort(desc('amount')) };
}

/* ---------- Stok ---------- */
export function stockLevels(moves) {
  const out = {};
  for (const m of moves) out[m.itemId] = (out[m.itemId] || 0) + (Number(m.qty) || 0);
  return out;
}

/* ---------- CSV (pemisah titik koma agar langsung terbuka rapi di Excel berbahasa Indonesia) ---------- */
export function toCSV(rows, cols) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.label)).join(';'), ...rows.map((r) => cols.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'))].join('\r\n');
}
