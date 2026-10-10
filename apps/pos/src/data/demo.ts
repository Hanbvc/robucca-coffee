/* =========================================================
   Mode demo: tanpa server. Snapshot master bawaan (demo-master.json, hasil GET /pos/master
   dari seed SEED_DEMO=1) + riwayat transaksi CONTOH yang dibuat deterministik.
   Port dari pos/js/data/demo.js. Semua dokumen ditandai `demo: true` dan dicatat sebagai
   terminal 2 agar tidak bentrok dengan nomor struk perangkat ini.
   ========================================================= */
import {
  addDays, businessDate, calcOrder, chosenModifiers, defaultSelection, modifiersSummary, queueNo, receiptNo, unitPrice, uuidv7, zonedEpoch,
  type Selection,
} from '@robucca/core';
import raw from './demo-master.json';
import { menuOf, type Master } from './master';
import type { CashMove, DeviceInfo, KitchenMark, Line, MasterSnapshot, Order, Pay, Shift } from './types';

import { DEMO_BRANCHES } from './demo-info';

export { DEMO_BRANCHES, DEMO_PINS } from './demo-info';

const BASE = raw as unknown as MasterSnapshot;

/** Snapshot master untuk cabang demo. Cabang contoh memakai menu & staf yang sama dengan IJN. */
export function demoMaster(code = 'IJN'): MasterSnapshot {
  const snap = structuredClone(BASE);
  const d = DEMO_BRANCHES.find((x) => x.code === code);
  if (snap.branch && d && code !== snap.branch.code) {
    const n = DEMO_BRANCHES.indexOf(d);
    snap.branch = {
      ...snap.branch,
      id: `00000000-0000-7000-8000-0000000000c${n}`,
      code: d.code,
      name: d.name,
      address: `Alamat ${d.name}`,
      phone: null,
    };
  }
  return snap;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickW<T>(r: () => number, entries: [T, number][]): T {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) if ((x -= w) <= 0) return v;
  return entries[entries.length - 1]![0];
}

const HOUR_W: [number, number][] = [[8, 6], [9, 8], [10, 7], [11, 7], [12, 10], [13, 9], [14, 6], [15, 6], [16, 7], [17, 8], [18, 9], [19, 9], [20, 5]];
const NAMES = ['Andi', 'Rani', 'Dimas', 'Putri', 'Bayu', 'Intan', 'Yoga', 'Laras', 'Reza', 'Tika', 'Galih', 'Wulan', 'Arif', 'Citra'];
const DAY_BASE = [80, 55, 55, 55, 58, 66, 86]; // Minggu..Sabtu
const CH_W: Record<string, number> = { dinein: 45, takeaway: 30, gofood: 12, grabfood: 9, shopeefood: 4 };
const PAY_W: Record<string, number> = { cash: 30, qris: 42, debit: 10, credit: 3, gopay: 6, ovo: 4, dana: 3, shopeepay: 2, transfer: 0.5 };

export interface DemoHistory {
  orders: Order[];
  shifts: Shift[];
  cashMoves: CashMove[];
  kitchen: KitchenMark[];
}

/** Riwayat contoh `days` hari terakhir untuk cabang perangkat ini (dibatasi agar ringan di IndexedDB). */
export function generateHistory(m: Master, device: DeviceInfo, { days = 14, now = Date.now(), seed = 20261006 } = {}): DemoHistory {
  const out: DemoHistory = { orders: [], shifts: [], cashMoves: [], kitchen: [] };
  const b = m.branch;
  if (!b) return out;
  const r = prng(seed + b.code.charCodeAt(0) + b.code.charCodeAt(2));
  const tz = b.timezone;
  const today = businessDate(now, tz, b.dayStartMinute);
  const cfg = m.taxConfig();
  const cashier = m.staff.find((s) => s.role === 'CASHIER') ?? m.staff[0]!;
  const mgr = m.staff.find((s) => s.role === 'BRANCH_MANAGER') ?? cashier;
  const menu: [(typeof m.products)[number], number][] = m.products.filter((p) => m.available(p)).map((p) => [p, (p.isSignature ? 1.6 : 1) * (0.4 + r())]);
  const pays = m.regularPays().map((p) => [p, PAY_W[p.code] ?? 1] as [typeof p, number]);
  const chans = m.channels.map((c) => [c, CH_W[c.code] ?? 5] as [typeof c, number]);
  const member = m.promotions.find((p) => p.type === 'PERCENT' && !p.requiresApproval);
  const T = 2;
  const devId = '00000000-0000-7000-8000-0000000000d2';

  for (let di = days - 1; di >= 0; di--) {
    const date = addDays(today, -di);
    const openTs = zonedEpoch(date, b.openTime || '08:00', tz);
    const closeTs = zonedEpoch(date, b.closeTime || '21:00', tz);
    const endTs = di === 0 ? Math.min(now - 5 * 60e3, closeTs) : closeTs;
    if (endTs <= openTs + 30 * 60e3) continue;
    const shift: Shift = {
      id: uuidv7(openTs - 60e3), branchId: b.id, deviceId: devId, terminalNo: T, bizDate: date, status: 'CLOSED', openedAt: openTs - 10 * 60e3,
      openedById: cashier.id, openedByName: cashier.name, openingCash: 300000, version: 1, updatedAt: now, demo: true,
    };
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const n = Math.round((DAY_BASE[dow]! * (0.85 + r() * 0.3) * (endTs - openTs)) / (closeTs - openTs) / 3);
    const stamps = Array.from({ length: n }, () => {
      const h = pickW(r, HOUR_W);
      return Math.min(endTs - 60e3, Math.max(openTs, zonedEpoch(date, `${String(h).padStart(2, '0')}:00`, tz) + Math.floor(r() * 3600e3)));
    }).sort((a, x) => a - x);
    let cashSales = 0;
    stamps.forEach((ts, i) => {
      const seq = i + 1;
      const ch = pickW(r, chans);
      const lines: Line[] = [];
      const k = 1 + Math.floor(r() * r() * 4);
      for (let j = 0; j < k; j++) {
        const p = pickW(r, menu);
        const menuP = menuOf(p);
        const sel: Selection = defaultSelection(menuP);
        for (const g of p.modifierGroups) if (g.selection === 'SINGLE' && g.options.length && r() < 0.35) sel[g.id] = [g.options[Math.floor(r() * g.options.length)]!.id];
        const mods = chosenModifiers(menuP, sel);
        lines.push({
          id: uuidv7(ts + j), productId: p.id, name: p.name, qty: r() < 0.15 ? 2 : 1, unitPrice: unitPrice(menuP, sel, ch.markupBp), optionIds: mods.map((x) => x.optionId),
          sum: modifiersSummary(menuP, mods), note: '', station: p.station, disc: null, kAt: p.station === 'NONE' ? null : ts, voided: null,
        });
      }
      const discount = member && ch.type !== 'FOOD_PLATFORM' && r() < 0.06 ? { type: member.type, value: member.value, name: member.name, promotionId: member.id } : null;
      const { totals } = calcOrder({ lines: lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice, quantity: l.qty })), discount }, cfg);
      const voided = r() < 0.015;
      let pay: Pay;
      if (ch.type === 'FOOD_PLATFORM') {
        const po = m.pay(ch.code)!;
        pay = { id: uuidv7(ts + 9), code: po.code, name: po.name, method: po.method, amount: totals.total, ref: `${ch.code.slice(0, 2).toUpperCase()}-${Math.floor(r() * 1e6)}`, at: ts };
      } else {
        const po = pickW(r, pays);
        const tendered = po.method === 'CASH' ? [totals.total, Math.ceil(totals.total / 50000) * 50000, Math.ceil(totals.total / 100000) * 100000][Math.floor(r() * 3)]! : undefined;
        pay = { id: uuidv7(ts + 9), code: po.code, name: po.name, method: po.method, amount: totals.total, ...(tendered ? { tendered } : {}), at: ts };
        if (po.method === 'CASH' && !voided) cashSales += totals.total;
      }
      const o: Order = {
        id: uuidv7(ts), number: receiptNo(b.code, T, date, seq), queueNo: queueNo(T, seq), branchId: b.id, deviceId: devId, terminalNo: T, source: 'POS',
        type: ch.type, channelCode: ch.code, channelName: ch.name, status: voided ? 'VOIDED' : 'PAID', fulfillment: 'COMPLETED',
        table: ch.type === 'DINE_IN' && r() < 0.6 ? String(1 + Math.floor(r() * 20)) : '', customerName: r() < 0.5 ? NAMES[Math.floor(r() * NAMES.length)]! : '',
        customerPhone: '', note: '', platformOrderRef: pay.ref ?? '', lines, discount, cfg, markupBp: ch.markupBp, deliveryFee: 0, totals, payments: [pay],
        change: pay.tendered ? pay.tendered - pay.amount : 0, createdAt: ts - 60e3, paidAt: ts, pickupAt: null, bizDate: date, shiftId: shift.id,
        cashierId: cashier.id, cashierName: cashier.name, version: 1, updatedAt: now, demo: true,
        ...(voided ? { voidReason: 'Pelanggan batal', voidedAt: ts + 120e3, voidedById: mgr.id, voidedByName: mgr.name } : {}),
      };
      out.orders.push(o);
      for (const l of lines) {
        if (!l.kAt) continue;
        out.kitchen.push({ id: `${o.id}:${l.id}`, orderId: o.id, lineId: l.id, branchId: b.id, done: true, at: ts + (4 + Math.floor(r() * 8)) * 60e3, byName: 'Dapur', version: 1, updatedAt: now });
      }
    });
    const outAmt = r() < 0.5 ? 25000 : 0;
    if (outAmt) {
      out.cashMoves.push({
        id: uuidv7(openTs + 3600e3), branchId: b.id, shiftId: shift.id, type: 'CASH_OUT', amount: outAmt, reason: 'Beli es batu', createdById: cashier.id,
        createdByName: cashier.name, createdAt: openTs + 3600e3, version: 1, updatedAt: now, demo: true,
      });
    }
    const expected = shift.openingCash + cashSales - outAmt;
    const counted = expected - (r() < 0.2 ? 2000 : 0);
    out.shifts.push({
      ...shift, closedAt: endTs + 5 * 60e3, closedById: cashier.id, closedByName: cashier.name, countedCash: counted, expectedCash: expected,
      ...(counted !== expected ? { differenceNote: 'Uang kembalian kurang' } : {}),
    });
  }
  return out;
}
