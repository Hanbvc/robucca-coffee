/* =========================================================
   Operasi transaksi kasir: simpan tagihan, bayar, void, refund, dapur, stok.
   Satu tempat agar aturan bisnis sama di layar Kasir, Tagihan, Riwayat, & Kantor.
   ========================================================= */
import { S, branch, master, settings } from './state.js';
import { applyTotals, cfgFor, buildLine } from './core/calc.js';
import { bizDate, bizHour } from './core/dates.js';
import { uuid } from './core/ids.js';

export const lineId = () => uuid().replace(/-/g, '').slice(0, 10);

/* ---------- draf pesanan (keranjang) ---------- */
export function newDraft(channelId) {
  const ch = master().activeChannels();
  return {
    id: uuid(), kind: 'sale', status: 'draft', channel: channelId || (ch[0] && ch[0].id) || 'dinein',
    table: '', customer: { name: '', phone: '' }, lines: [], discount: null, note: '',
  };
}
const draftKey = () => `pos:draft:${S.be.device.id}:${S.be.device.branchId}`;
export function loadDraft() {
  try { const d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); if (d && Array.isArray(d.lines)) return d; } catch (e) { /* noop */ }
  return newDraft();
}
export function storeDraft(d) { try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch (e) { /* penyimpanan penuh */ } }

export const channelOf = (o) => master().channel[o.channel] || { id: o.channel, name: o.channelName || o.channel, type: 'takeaway', markupPct: 0 };
export const isPlatform = (o) => channelOf(o).type === 'platform';

/** Hitung ulang total dengan pajak/servis cabang saat ini */
export function priced(o, b = branch()) {
  return applyTotals(o, (o.cfg && o.status !== 'draft' && o.status !== 'open') ? o.cfg : cfgFor(b, settings()));
}

/** Baris baru dari menu (harga cabang + markup kanal) */
export function makeLine(item, sel, { qty = 1, note = '' } = {}, o) {
  const b = branch(); const m = master();
  return buildLine(item, sel, { id: lineId(), qty, note, ov: m.override(b.id, item.id), markupPct: channelOf(o).markupPct, station: m.stationOf(item) });
}

/** Ganti kanal → harga baris yang belum dikirim ke dapur ikut markup kanal baru */
export function changeChannel(o, chId) {
  const ch = master().channel[chId];
  if (!ch) return o;
  const lines = o.lines.map((l) => {
    const item = master().item[l.itemId];
    if (!item) return l;
    const nl = buildLine(item, l.sel || {}, { id: l.id, qty: l.qty, note: l.note, ov: master().override(branch().id, item.id), markupPct: ch.markupPct, station: l.station });
    return { ...l, base: nl.base, price: nl.price };
  });
  return { ...o, channel: ch.id, channelName: ch.name, lines, table: ch.type === 'dinein' ? o.table : '' };
}

/* ---------- penyimpanan ---------- */
async function stamp(o) {
  const b = branch(); const be = S.be; const now = Date.now();
  const x = { ...o };
  if (!x.number) {
    const d = bizDate(now, b.tz, b.dayStart);
    const n = await be.nextNumber(b, d);
    Object.assign(x, { number: n.number, queueNo: n.queueNo, seq: n.seq, createdAt: now, branchId: b.id, deviceId: be.device.id, terminalNo: be.device.terminalNo, cashierId: S.user.id, cashierName: S.user.name });
  }
  x.channelName = channelOf(x).name;
  // kirim baris baru ke dapur/bar
  x.lines = x.lines.map((l) => (l.kAt || l.voided || l.station === 'none' ? l : { ...l, kAt: now }));
  return x;
}

/** Simpan sebagai tagihan terbuka (pesanan dikirim ke dapur, dibayar nanti) */
export async function saveOpen(o) {
  const b = branch();
  let x = await stamp(o);
  x = applyTotals({ ...x, status: 'open', bizDate: x.bizDate || bizDate(Date.now(), b.tz, b.dayStart), bizHour: x.bizHour ?? bizHour(Date.now(), b.tz) }, cfgFor(b, settings()));
  return S.be.save('orders', x);
}

/**
 * Selesaikan pembayaran. payments: [{ method, name, type, amount, tendered?, ref? }]
 * Stok menu yang dilacak berkurang saat dibayar.
 */
export async function payOrder(o, payments) {
  const b = branch(); const now = Date.now();
  let x = await stamp(o);
  x = applyTotals(x, cfgFor(b, settings()));
  const applied = payments.reduce((a, p) => a + p.amount, 0);
  if (applied !== x.totals.total) throw new Error(`Pembayaran (${applied}) tidak sama dengan total (${x.totals.total})`);
  const tendered = payments.reduce((a, p) => a + (p.type === 'cash' ? p.tendered : p.amount), 0);
  x = {
    ...x, status: 'paid', payments, change: Math.max(0, tendered - x.totals.total), paidAt: now,
    bizDate: bizDate(now, b.tz, b.dayStart), bizHour: bizHour(now, b.tz), shiftId: S.shift ? S.shift.id : null,
    paidBy: S.user.id, paidByName: S.user.name,
  };
  const saved = await S.be.save('orders', x);
  const moves = stockMovesFor(saved, -1, 'sale');
  if (moves.length) await S.be.save('stockMoves', moves);
  return saved;
}

export function stockMovesFor(o, sign, type) {
  const m = master(); const now = Date.now();
  return o.lines.filter((l) => !l.voided && m.item[l.itemId] && m.item[l.itemId].track).map((l) => ({
    id: uuid(), branchId: o.branchId, itemId: l.itemId, qty: sign * Math.abs(l.qty), type, ref: o.id, refNumber: o.number,
    by: S.user.id, byName: S.user.name, at: now,
  }));
}

/** Batalkan pesanan (tagihan terbuka, atau sudah dibayar di shift yang masih berjalan) */
export async function voidOrder(o, { reason, approver }) {
  const now = Date.now();
  const x = { ...o, status: 'void', voidAt: now, voidReason: reason, voidBy: approver.id, voidByName: approver.name };
  const saved = await S.be.officeWrite('orders', x).then((r) => r[0]);
  if (o.status === 'paid') {
    const moves = stockMovesFor(o, 1, 'void');
    if (moves.length) await S.be.officeWrite('stockMoves', moves);
  }
  await S.be.audit('order.void', { number: o.number, total: o.totals.total, reason, wasPaid: o.status === 'paid', cashier: o.cashierName }, approver, o.branchId);
  return saved;
}

/** Refund penuh: dokumen refund (nilai negatif) pada tanggal hari ini */
export async function refundOrder(o, { reason, approver, shift }) {
  const b = master().branch[o.branchId]; const now = Date.now();
  const neg = (v) => -(v || 0);
  const totals = Object.fromEntries(Object.entries(o.totals).map(([k, v]) => [k, neg(v)]));
  const refund = {
    id: uuid(), kind: 'refund', status: 'paid', refOf: o.id, refNumber: o.number, branchId: o.branchId,
    deviceId: S.be.device.id, terminalNo: S.be.device.terminalNo, shiftId: shift ? shift.id : null,
    number: `R-${o.number}`, queueNo: o.queueNo, channel: o.channel, channelName: o.channelName, table: o.table, customer: o.customer,
    lines: o.lines.filter((l) => !l.voided).map((l) => ({ ...l, qty: -l.qty, gross: neg(l.gross), discAmt: neg(l.discAmt), amount: neg(l.amount) })),
    discount: o.discount ? { ...o.discount, amount: neg(o.discount.amount) } : null,
    cfg: o.cfg, totals, payments: (o.payments || []).map((p) => ({ method: p.method, name: p.name, type: p.type, amount: neg(p.amount) })),
    reason, cashierId: approver.id, cashierName: approver.name, createdAt: now, paidAt: now,
    bizDate: bizDate(now, b.tz, b.dayStart), bizHour: bizHour(now, b.tz),
  };
  await S.be.officeWrite('orders', [refund, { ...o, status: 'refunded', refundId: refund.id, refundAt: now, refundReason: reason, refundBy: approver.id, refundByName: approver.name }]);
  await S.be.audit('order.refund', { number: o.number, total: o.totals.total, reason }, approver, o.branchId);
  return refund;
}

/* ---------- dapur ---------- */
export async function markKitchen(o, lineIds, done) {
  const now = Date.now();
  const docs = lineIds.map((lid) => ({ id: `${o.id}:${lid}`, orderId: o.id, lineId: lid, branchId: o.branchId, done, at: now, by: S.user.id, byName: S.user.name }));
  return S.be.save('kitchen', docs);
}

/** Status dapur sebuah pesanan dari catatan kitchen → { doneIds:Set, ready, readyAt } */
export function kitchenState(o, marks) {
  const mine = marks.filter((k) => k.orderId === o.id);
  const doneIds = new Set(mine.filter((k) => k.done).map((k) => k.lineId));
  const sent = o.lines.filter((l) => l.kAt && !l.voided);
  const ready = sent.length > 0 && sent.every((l) => doneIds.has(l.id));
  const readyAt = ready ? Math.max(...mine.filter((k) => k.done).map((k) => k.at)) : null;
  return { doneIds, ready, readyAt, sent: sent.length };
}

/* ---------- metode bayar ---------- */
export function payMethodsFor(o) {
  const ch = channelOf(o);
  if (ch.type === 'platform') return [{ id: ch.id, name: `${ch.name} (dibayar platform)`, type: 'platform', ref: true }];
  return master().activePays();
}
