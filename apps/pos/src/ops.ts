/* =========================================================
   Operasi transaksi kasir: draf, harga, simpan tagihan, bayar, void, refund, dapur.
   Satu tempat agar aturan bisnis sama di layar Kasir, Tagihan, Riwayat (dan Kantor nanti).
   Semua hitungan uang memakai @robucca/core (sama persis dengan server).
   ========================================================= */
import {
  calcOrder, chosenModifiers, modifiersSummary, unitPrice, uuidv7, type Selection,
} from '@robucca/core';
import type { Approval } from './data/backend';
import { menuOf } from './data/master';
import type { KitchenMark, Line, MChannel, MPayOption, MProduct, Order, Pay, Shift } from './data/types';
import { ls } from './lib/store';
import { S, branch, master } from './state';

export const lineId = (): string => uuidv7();

/* ---------- draf pesanan (keranjang) ---------- */
export function newDraft(channelCode?: string | null): Order {
  const m = master();
  const ch = m.channel(channelCode) ?? m.channels[0];
  const now = Date.now();
  return {
    id: uuidv7(), number: '', queueNo: '', branchId: S.be.device!.branchId!, deviceId: S.be.device!.id, terminalNo: S.be.device!.terminalNo,
    source: 'POS', type: ch?.type ?? 'DINE_IN', channelCode: ch?.code ?? null, channelName: ch?.name ?? 'Dine In', status: 'DRAFT', fulfillment: null,
    table: '', customerName: '', customerPhone: '', note: '', platformOrderRef: '', lines: [], discount: null, cfg: m.taxConfig(),
    markupBp: ch?.markupBp ?? 0, deliveryFee: 0, totals: calcOrder({ lines: [] }, m.taxConfig()).totals, payments: [], change: 0,
    createdAt: now, paidAt: null, pickupAt: null, bizDate: '', shiftId: null, cashierId: null, cashierName: '', version: 0, updatedAt: now,
  };
}
const draftKey = () => `pos:draft:${S.be.device!.id}:${S.be.device!.branchId}`;
export function loadDraft(): Order {
  const d = ls.get<Order | null>(draftKey(), null);
  if (d && Array.isArray(d.lines) && d.branchId === S.be.device!.branchId) return d;
  return newDraft();
}
export function storeDraft(d: Order): void {
  ls.set(draftKey(), d);
}

export const channelOf = (o: Order): MChannel | undefined => master().channel(o.channelCode);
export const isPlatform = (o: Order): boolean => o.type === 'FOOD_PLATFORM';
/** Pesanan dari aplikasi pelanggan (Pick Up / Delivery): kanal tidak bisa diganti di kasir. */
export const isAppOrder = (o: Order): boolean => o.source === 'PWA';
export const editable = (o: Order): boolean => o.status === 'DRAFT' || o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT';

/** Hitung ulang total. Draf memakai pajak cabang saat ini; tagihan tersimpan memakai konfigurasi saat dibuat. */
export function priced(o: Order): Order {
  if (!editable(o)) return o;
  const cfg = o.status === 'DRAFT' ? master().taxConfig() : o.cfg;
  const { totals } = calcOrder(
    {
      lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice, quantity: l.qty, discount: l.disc, voided: !!l.voided })),
      discount: o.discount,
      deliveryFee: o.deliveryFee,
    },
    cfg,
  );
  return { ...o, cfg, totals };
}

/** Diskon khusus baris (tanpa bagian diskon pesanan). */
export function lineDiscAmount(l: Pick<Line, 'unitPrice' | 'qty' | 'disc'>): number {
  if (!l.disc) return 0;
  const g = l.unitPrice * Math.abs(l.qty);
  return l.disc.type === 'PERCENT' ? Math.round((g * Math.min(10000, l.disc.value)) / 10000) : Math.min(g, Math.round(l.disc.value));
}

/** Baris baru dari menu (harga cabang + opsi + markup kanal). */
export function makeLine(p: MProduct, sel: Selection, { qty = 1, note = '' }: { qty?: number; note?: string }, o: Order): Line {
  const menu = menuOf(p);
  const mods = chosenModifiers(menu, sel);
  return {
    id: lineId(), productId: p.id, name: p.name, qty, unitPrice: unitPrice(menu, sel, o.markupBp), optionIds: mods.map((x) => x.optionId),
    sum: modifiersSummary(menu, mods), note: note.trim(), station: p.station, disc: null, kAt: null, voided: null,
  };
}

/** Pilihan opsi dari daftar id (untuk mengubah baris). */
export function selectionOf(p: MProduct, optionIds: string[]): Selection {
  const sel: Selection = {};
  for (const g of p.modifierGroups) sel[g.id] = optionIds.filter((id) => g.options.some((x) => x.id === id));
  return sel;
}

/** Ganti kanal → harga baris ikut markup kanal baru. */
export function changeChannel(o: Order, code: string): Order {
  const ch = master().channel(code);
  if (!ch) return o;
  const lines = o.lines.map((l) => {
    const p = master().product(l.productId);
    if (!p) return l;
    return { ...l, unitPrice: unitPrice(menuOf(p), selectionOf(p, l.optionIds), ch.markupBp) };
  });
  return { ...o, channelCode: ch.code, channelName: ch.name, type: ch.type, markupBp: ch.markupBp, lines, table: ch.type === 'DINE_IN' ? o.table : '' };
}

/* ---------- penyimpanan ---------- */
async function stamp(o: Order): Promise<Order> {
  const now = Date.now();
  const x = { ...o };
  if (!x.number) {
    const d = S.be.bizDateOf(now);
    const n = await S.be.nextNumber(d);
    Object.assign(x, {
      number: n.number, queueNo: n.queueNo, createdAt: now, bizDate: d, branchId: S.be.device!.branchId!, deviceId: S.be.device!.id,
      terminalNo: S.be.device!.terminalNo, cashierId: S.user!.id, cashierName: S.user!.name, cfg: master().taxConfig(),
    });
  }
  if (!x.cashierId) Object.assign(x, { cashierId: S.user!.id, cashierName: S.user!.name });
  if (x.channelCode) x.channelName = channelOf(x)?.name ?? x.channelName;
  // kirim baris baru ke dapur/bar
  x.lines = x.lines.map((l) => (l.kAt || l.voided || l.station === 'NONE' ? l : { ...l, kAt: now }));
  delete x.syncError;
  return x;
}

/** Simpan sebagai tagihan terbuka (pesanan dikirim ke dapur, dibayar nanti). */
export async function saveOpen(o: Order): Promise<Order> {
  let x = await stamp(o);
  x = priced({ ...x, status: x.status === 'DRAFT' ? 'OPEN' : x.status });
  const [saved] = await S.be.save('orders', x);
  return saved!;
}

/** Selesaikan pembayaran (bisa beberapa metode / split). */
export async function payOrder(o: Order, payments: Pay[]): Promise<Order> {
  const now = Date.now();
  let x = await stamp(o);
  x = priced(x);
  const applied = payments.reduce((a, p) => a + p.amount, 0);
  if (applied !== x.totals.total) throw new Error(`Pembayaran (${applied}) tidak sama dengan total (${x.totals.total})`);
  const tendered = payments.reduce((a, p) => a + (p.method === 'CASH' ? (p.tendered ?? p.amount) : p.amount), 0);
  const ref = payments.find((p) => p.ref && x.type === 'FOOD_PLATFORM')?.ref;
  x = {
    ...x, status: 'PAID', payments, change: Math.max(0, tendered - x.totals.total), paidAt: now, shiftId: S.shift ? S.shift.id : x.shiftId,
    ...(ref && !x.platformOrderRef ? { platformOrderRef: ref } : {}),
  };
  const [saved] = await S.be.save('orders', x);
  return saved!;
}

/** Batalkan pesanan (tagihan terbuka, atau sudah dibayar di shift yang masih berjalan). */
export async function voidOrder(o: Order, { reason, approval }: { reason: string; approval: Approval }): Promise<Order> {
  const now = Date.now();
  const x: Order = {
    ...o, status: 'VOIDED', voidReason: reason, voidedAt: now, voidedById: approval.staff.id, voidedByName: approval.staff.name,
    ...(approval.token ? { voidApproval: approval.token, approvalAt: approval.at } : {}),
  };
  delete x.syncError;
  const [saved] = await S.be.save('orders', x);
  await S.be.audit('order.void', { number: o.number, total: o.totals.total, reason, wasPaid: o.status === 'PAID' }, approval.staff);
  return saved!;
}

/** Refund penuh (server: POST /orders/:id/refund, sekali per pesanan). */
export async function refundOrder(o: Order, { reason, approval, shift }: { reason: string; approval: Approval; shift: Shift | null }): Promise<Order> {
  return S.be.refund(o, reason, approval, shift);
}

/* ---------- dapur ---------- */
export async function markKitchen(o: Order, lineIds: string[], done: boolean): Promise<void> {
  const now = Date.now();
  const docs: KitchenMark[] = [];
  for (const lid of lineIds) {
    const id = `${o.id}:${lid}`;
    const cur = await S.be.get<KitchenMark>('kitchen', id);
    docs.push({ id, orderId: o.id, lineId: lid, branchId: o.branchId, done, at: now, byName: S.user?.name ?? '', version: cur?.version ?? 0, updatedAt: now });
  }
  await S.be.save('kitchen', docs);
}

/** Status dapur sebuah pesanan → { doneIds, ready, readyAt, sent } */
export function kitchenState(o: Order, marks: KitchenMark[]) {
  const mine = marks.filter((k) => k.orderId === o.id);
  const doneIds = new Set(mine.filter((k) => k.done).map((k) => k.lineId));
  const sent = o.lines.filter((l) => l.kAt && !l.voided && l.station !== 'NONE');
  const ready = sent.length > 0 && sent.every((l) => doneIds.has(l.id));
  const readyAt = ready ? Math.max(...mine.filter((k) => k.done).map((k) => k.at)) : null;
  return { doneIds, ready, readyAt, sent: sent.length };
}

/* ---------- metode bayar ---------- */
export interface PayMethod {
  code: string;
  name: string;
  method: MPayOption['method'];
  ref: boolean;
  platform: boolean;
}
export function payMethodsFor(o: Order): PayMethod[] {
  const m = master();
  if (o.type === 'FOOD_PLATFORM' && o.channelCode) {
    const p = m.pay(o.channelCode);
    if (p) return [{ code: p.code, name: p.name, method: p.method, ref: true, platform: true }];
  }
  return m.regularPays().map((p) => ({ code: p.code, name: p.name, method: p.method, ref: p.requiresReference, platform: false }));
}

/* ---------- ringkasan shift (port pos/js/core/report.js shiftSummary) ---------- */
export interface ShiftSummary {
  count: number;
  refunds: number;
  voids: number;
  total: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  byMethod: { code: string; name: string; amount: number; count: number }[];
}
export function shiftSummary(shift: Shift, orders: Order[], moves: { shiftId: string; type: string; amount: number }[]): ShiftSummary {
  const byMethod = new Map<string, ShiftSummary['byMethod'][number]>();
  let cashSales = 0;
  let cashRefunds = 0;
  let total = 0;
  let count = 0;
  let refunds = 0;
  let voids = 0;
  for (const o of orders) {
    if (o.shiftId === shift.id) {
      if (o.status === 'VOIDED') voids += 1;
      else if (o.status === 'PAID' || o.status === 'REFUNDED') {
        total += o.totals.total;
        count += 1;
        for (const p of o.payments) {
          let x = byMethod.get(p.code);
          if (!x) byMethod.set(p.code, (x = { code: p.code, name: p.name, amount: 0, count: 0 }));
          x.amount += p.amount;
          x.count += 1;
          if (p.method === 'CASH') cashSales += p.amount;
        }
      }
    }
    // Server: refund di shift ini mengurangi kas laci (kas seharusnya), apa pun metode bayarnya.
    if (o.refund && o.refund.shiftId === shift.id) {
      refunds += 1;
      total -= o.refund.amount;
      cashRefunds += o.refund.amount;
    }
  }
  let cashIn = 0;
  let cashOut = 0;
  for (const mv of moves) {
    if (mv.shiftId !== shift.id) continue;
    if (mv.type === 'CASH_IN') cashIn += mv.amount;
    else cashOut += mv.amount;
  }
  const expected = shift.openingCash + cashSales - cashRefunds + cashIn - cashOut;
  return { count, refunds, voids, total, cashSales, cashRefunds, cashIn, cashOut, expected, byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount) };
}

export const branchName = (): string => branch().name;
