/* Agregasi laporan kantor, port dari pos/js/core/report.js (aturan sama dengan POS lama):
   - Penjualan = pesanan PAID/REFUNDED, dihitung pada tanggal bisnis saat dibayar (zona & jam ganti hari cabang).
   - Refund bernilai negatif dan dihitung pada tanggal refund dilakukan.
   - Void tidak masuk penjualan; dicatat terpisah (tanggal bisnis pesanan).
   - Tagihan terbuka belum dihitung. */
import { Injectable } from '@nestjs/common';
import { addDays, daysBetween, parts, prevRange, type DateRange } from '@robucca/core';
import type { Prisma } from '@robucca/db';
import type { StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import {
  bizDateOf, branchWhere, DEFAULT_TZ, dateCol, looseWindow, resolveRange, scopeBranches, todayFor, ymdOfCol, type BranchTz, type RangeQueryDto,
} from './office.common';

const REPORT_ORDER = {
  id: true, number: true, branchId: true, status: true, type: true, businessDate: true, createdAt: true, paidAt: true, voidedAt: true, voidReason: true,
  subtotal: true, discountTotal: true, serviceCharge: true, taxTotal: true, deliveryFee: true, rounding: true, total: true, discountNote: true,
  promotion: { select: { name: true } },
  channel: { select: { id: true, code: true, name: true } },
  cashier: { select: { id: true, name: true } },
  voidedBy: { select: { name: true } },
  items: { where: { voidedAt: null }, select: { productId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, lineTotal: true, product: { select: { categoryId: true } } } },
  payments: { where: { status: 'SUCCEEDED' }, select: { method: true, amount: true, option: { select: { code: true, name: true } } } },
} satisfies Prisma.OrderSelect;
type ReportOrder = Prisma.OrderGetPayload<{ select: typeof REPORT_ORDER }>;

const TYPE_NAMES: Record<string, string> = { DINE_IN: 'Dine In', TAKEAWAY: 'Take Away', CLICK_COLLECT: 'Click & Collect', FOOD_PLATFORM: 'Ojol', DELIVERY: 'Delivery' };
const METHOD_NAMES: Record<string, string> = { CASH: 'Tunai', QRIS: 'QRIS', DEBIT_CARD: 'Kartu Debit', CREDIT_CARD: 'Kartu Kredit', E_WALLET: 'E-wallet', VIRTUAL_ACCOUNT: 'Virtual Account', BANK_TRANSFER: 'Transfer Bank' };

export interface Kpi {
  orders: number; refunds: number; refundTotal: number; voids: number; voidTotal: number; gross: number; discount: number; net: number;
  service: number; tax: number; deliveryFee: number; rounding: number; total: number; items: number; salesTotal: number; avg: number;
}
export interface HourRow { hour: number; total: number; orders: number; items: number; net: number; discount: number; salesTotal: number }
export interface DayRow { date: string; total: number; net: number; orders: number; tax: number }
export interface SlimDoc { id: string; kind: 'void' | 'refund'; number: string; branchId: string; bizDate: string; at: string; total: number; reason: string; by: string; wasPaid: boolean }

export interface Report {
  range: DateRange;
  kpi: Kpi;
  days: DayRow[];
  hours: HourRow[];
  branches: { id: string; code: string; name: string; total: number; net: number; orders: number; items: number }[];
  payments: { code: string; method: string; name: string; amount: number; count: number }[];
  channels: { id: string; code: string; name: string; total: number; orders: number }[];
  items: { id: string; name: string; categoryId: string | null; categoryName: string; qty: number; gross: number; disc: number; amount: number }[];
  categories: { id: string; name: string; qty: number; amount: number }[];
  cashiers: { id: string; name: string; total: number; orders: number }[];
  discounts: { name: string; count: number; amount: number }[];
  voids: SlimDoc[];
  refunds: SlimDoc[];
}

const bump = <V>(map: Map<string, V>, key: string, init: () => V): V => {
  let v = map.get(key);
  if (!v) {
    v = init();
    map.set(key, v);
  }
  return v;
};
const by = <T>(k: keyof T) => (a: T, b: T) => (b[k] as number) - (a[k] as number);
export const emptyHour = (hour: number): HourRow => ({ hour, total: 0, orders: 0, items: 0, net: 0, discount: 0, salesTotal: 0 });

/** Nilai ringkas pesanan, sama dengan `totals` POS lama. */
export function orderTotals(o: { subtotal: number; discountTotal: number; serviceCharge: number; taxTotal: number; deliveryFee: number; rounding: number; total: number; items?: { quantity: number }[] }) {
  return {
    items: (o.items ?? []).reduce((a, i) => a + i.quantity, 0),
    gross: o.subtotal,
    discount: o.discountTotal,
    net: o.total - o.serviceCharge - o.taxTotal - o.deliveryFee - o.rounding,
    service: o.serviceCharge,
    tax: o.taxTotal,
    deliveryFee: o.deliveryFee,
    rounding: o.rounding,
    total: o.total,
  };
}

export interface ScopeBranch extends BranchTz {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async branchesOf(scope: string[] | null): Promise<ScopeBranch[]> {
    return this.prisma.db.branch.findMany({
      where: scope ? { id: { in: scope } } : {},
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, timezone: true, dayStartMinute: true, isActive: true },
    });
  }

  /** Agregasi penjualan untuk cabang `scope` (null = semua) pada hari bisnis from..to. */
  async aggregate(scope: string[] | null, r: DateRange, branches?: ScopeBranch[]): Promise<Report> {
    const db = this.prisma.db;
    const bs = branches ?? (await this.branchesOf(scope));
    const bmap = new Map(bs.map((b) => [b.id, b]));
    const inRange = (d: string) => d >= r.from && d <= r.to;
    // Tagihan bisa dibuka lalu dibayar beberapa hari kemudian: ambil jendela lebih lebar lalu saring tanggal bayar.
    const [orders, refunds, categories] = await Promise.all([
      db.order.findMany({
        where: { ...branchWhere(scope), status: { in: ['PAID', 'REFUNDED', 'VOIDED'] }, businessDate: { gte: dateCol(addDays(r.from, -7)), lte: dateCol(r.to) } },
        select: REPORT_ORDER,
      }),
      db.refund.findMany({
        where: { ...branchWhere(scope), createdAt: looseWindow(r) },
        select: { createdAt: true, amount: true, reason: true, processedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, order: { select: REPORT_ORDER } },
      }),
      db.category.findMany({ select: { id: true, name: true } }),
    ]);
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    const kpi: Kpi = { orders: 0, refunds: 0, refundTotal: 0, voids: 0, voidTotal: 0, gross: 0, discount: 0, net: 0, service: 0, tax: 0, deliveryFee: 0, rounding: 0, total: 0, items: 0, salesTotal: 0, avg: 0 };
    const days = new Map<string, DayRow>();
    const hours = new Map<number, HourRow>();
    const branchRows = new Map<string, Report['branches'][number]>();
    const pays = new Map<string, Report['payments'][number]>();
    const channels = new Map<string, Report['channels'][number]>();
    const items = new Map<string, Report['items'][number]>();
    const cats = new Map<string, Report['categories'][number]>();
    const cashiers = new Map<string, Report['cashiers'][number]>();
    const discs = new Map<string, Report['discounts'][number]>();
    const voids: SlimDoc[] = [];
    const refundList: SlimDoc[] = [];

    const add = (o: ReportOrder, sign: 1 | -1, at: Date, bizDate: string) => {
      const t = orderTotals(o);
      const s = (n: number) => n * sign;
      if (sign > 0) {
        kpi.orders += 1;
        kpi.salesTotal += t.total;
      } else {
        kpi.refunds += 1;
        kpi.refundTotal += t.total;
      }
      kpi.gross += s(t.gross); kpi.discount += s(t.discount); kpi.net += s(t.net); kpi.service += s(t.service); kpi.tax += s(t.tax);
      kpi.deliveryFee += s(t.deliveryFee); kpi.rounding += s(t.rounding); kpi.total += s(t.total); kpi.items += s(t.items);

      const d = bump(days, bizDate, () => ({ date: bizDate, total: 0, net: 0, orders: 0, tax: 0 }));
      d.total += s(t.total); d.net += s(t.net); d.tax += s(t.tax);
      if (sign > 0) d.orders += 1;
      const b = bmap.get(o.branchId);
      const hour = parts(at.getTime(), b?.timezone ?? DEFAULT_TZ).H;
      const h = hours.get(hour) ?? emptyHour(hour);
      hours.set(hour, h);
      h.total += s(t.total); h.items += s(t.items); h.net += s(t.net); h.discount += s(t.discount);
      if (sign > 0) {
        h.orders += 1;
        h.salesTotal += t.total;
      }
      const br = bump(branchRows, o.branchId, () => ({ id: o.branchId, code: b?.code ?? '', name: b?.name ?? o.branchId, total: 0, net: 0, orders: 0, items: 0 }));
      br.total += s(t.total); br.net += s(t.net); br.items += s(t.items);
      if (sign > 0) br.orders += 1;
      const chKey = o.channel?.code ?? `type:${o.type}`;
      const ch = bump(channels, chKey, () => ({ id: o.channel?.id ?? '', code: chKey, name: o.channel?.name ?? TYPE_NAMES[o.type] ?? o.type, total: 0, orders: 0 }));
      ch.total += s(t.total);
      if (sign > 0) ch.orders += 1;
      const k = bump(cashiers, o.cashier?.id ?? '-', () => ({ id: o.cashier?.id ?? '-', name: o.cashier?.name ?? '-', total: 0, orders: 0 }));
      k.total += s(t.total);
      if (sign > 0) k.orders += 1;
      if (sign > 0 && t.discount) {
        const name = o.promotion?.name ?? o.discountNote ?? 'Diskon';
        const x = bump(discs, name, () => ({ name, count: 0, amount: 0 }));
        x.count += 1;
        x.amount += t.discount;
      }
      for (const p of o.payments) {
        const code = p.option?.code ?? p.method.toLowerCase();
        const x = bump(pays, code, () => ({ code, method: p.method, name: p.option?.name ?? METHOD_NAMES[p.method] ?? p.method, amount: 0, count: 0 }));
        x.amount += s(p.amount);
        if (sign > 0) x.count += 1;
      }
      for (const l of o.items) {
        const cid = l.product.categoryId;
        const it = bump(items, l.productId, () => ({ id: l.productId, name: l.productName, categoryId: cid, categoryName: catName.get(cid) ?? '', qty: 0, gross: 0, disc: 0, amount: 0 }));
        it.qty += s(l.quantity); it.gross += s(l.unitPrice * l.quantity); it.disc += s(l.discountAmount); it.amount += s(l.lineTotal);
        const ct = bump(cats, cid, () => ({ id: cid, name: catName.get(cid) ?? 'Lainnya', qty: 0, amount: 0 }));
        ct.qty += s(l.quantity); ct.amount += s(l.lineTotal);
      }
    };

    for (const o of orders) {
      const b = bmap.get(o.branchId);
      if (o.status === 'VOIDED') {
        const d = ymdOfCol(o.businessDate);
        if (!inRange(d)) continue;
        kpi.voids += 1;
        kpi.voidTotal += o.total;
        voids.push({ id: o.id, kind: 'void', number: o.number, branchId: o.branchId, bizDate: d, at: (o.voidedAt ?? o.createdAt).toISOString(), total: o.total, reason: o.voidReason ?? '', by: o.voidedBy?.name ?? o.cashier?.name ?? '', wasPaid: !!o.paidAt });
        continue;
      }
      const at = o.paidAt ?? o.createdAt;
      const d = bizDateOf(at, b);
      if (inRange(d)) add(o, 1, at, d);
    }
    for (const rf of refunds) {
      const b = bmap.get(rf.order.branchId);
      const d = bizDateOf(rf.createdAt, b);
      if (!inRange(d)) continue;
      add(rf.order, -1, rf.createdAt, d);
      refundList.push({
        id: rf.order.id, kind: 'refund', number: rf.order.number, branchId: rf.order.branchId, bizDate: d, at: rf.createdAt.toISOString(), total: -rf.amount,
        reason: rf.reason, by: rf.processedBy.name, wasPaid: true,
      });
    }
    kpi.avg = kpi.orders ? Math.round(kpi.salesTotal / kpi.orders) : 0;

    return {
      range: r,
      kpi,
      days: daysBetween(r.from, r.to).map((s) => days.get(s) ?? { date: s, total: 0, net: 0, orders: 0, tax: 0 }),
      hours: Array.from({ length: 24 }, (_, i) => hours.get(i) ?? emptyHour(i)),
      branches: [...branchRows.values()].sort(by('total')),
      payments: [...pays.values()].sort(by('amount')),
      channels: [...channels.values()].sort(by('total')),
      items: [...items.values()].sort((a, b) => b.amount - a.amount || b.qty - a.qty),
      categories: [...cats.values()].sort(by('amount')),
      cashiers: [...cashiers.values()].sort(by('total')),
      discounts: [...discs.values()].sort(by('amount')),
      voids: voids.sort((a, b) => (a.at < b.at ? 1 : -1)),
      refunds: refundList.sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  }

  async report(staff: StaffCtx, q: RangeQueryDto) {
    const scope = scopeBranches(staff, q.branchId);
    const branches = await this.branchesOf(scope);
    const r = resolveRange(q, todayFor(branches.length === 1 ? branches[0] : null), '7d');
    return this.aggregate(scope, r, branches);
  }

  /** Dasbor: periode + pembanding (prevRange), dan kondisi cabang hari ini. Hari ini berjalan → pembanding kemarin s.d. jam yang sama. */
  async dashboard(staff: StaffCtx, q: RangeQueryDto) {
    const scope = scopeBranches(staff, q.branchId);
    const branches = await this.branchesOf(scope);
    const one = branches.length === 1 ? branches[0]! : null;
    const today = todayFor(one);
    const r = resolveRange(q, today, 'today');
    const p = prevRange(r);
    const [cur, prev, status] = await Promise.all([this.aggregate(scope, r, branches), this.aggregate(scope, p, branches), this.branchStatus(staff, scope)]);
    const live = r.from === r.to && r.from === today;
    const nowHour = parts(Date.now(), one?.timezone ?? DEFAULT_TZ).H;
    let prevKpi: Pick<Kpi, 'total' | 'orders' | 'items' | 'net' | 'discount' | 'avg'> = prev.kpi;
    if (live) {
      const hs = prev.hours.filter((h) => h.hour <= nowHour);
      const sum = (k: keyof HourRow) => hs.reduce((a, h) => a + h[k], 0);
      const orders = sum('orders');
      prevKpi = { total: sum('total'), orders, items: sum('items'), net: sum('net'), discount: sum('discount'), avg: orders ? Math.round(sum('salesTotal') / orders) : 0 };
    }
    const delta = (c: number, pv: number) => (pv ? Math.round(((c - pv) / Math.abs(pv)) * 1000) / 10 : null);
    const keys = ['total', 'orders', 'avg', 'items', 'discount', 'net'] as const;
    return {
      range: r,
      prevRange: p,
      today,
      live,
      compareLabel: live ? 'vs kemarin s.d. jam ini' : r.from === r.to ? 'vs hari sebelumnya' : 'vs periode sebelumnya',
      current: cur,
      previous: { kpi: prev.kpi, days: prev.days, hours: prev.hours },
      comparison: {
        previous: prevKpi,
        deltaPct: Object.fromEntries(keys.map((k) => [k, delta(cur.kpi[k], prevKpi[k])])) as Record<(typeof keys)[number], number | null>,
      },
      dailyAverage: Math.round(cur.kpi.total / cur.days.length),
      topItems: cur.items.slice(0, 10),
      branchStatus: status,
    };
  }

  /** Kondisi cabang hari ini (tanggal bisnis masing-masing cabang). */
  async branchStatus(staff: StaffCtx, scopeIn?: string[] | null) {
    const scope = scopeIn === undefined ? scopeBranches(staff) : scopeIn;
    const branches = (await this.branchesOf(scope)).filter((b) => b.isActive);
    return Promise.all(
      branches.map(async (b) => {
        const today = todayFor(b);
        const [agg, openBills, openShifts, last, device] = await Promise.all([
          this.aggregate([b.id], { from: today, to: today }, [b]),
          this.prisma.db.order.count({ where: { branchId: b.id, status: 'OPEN' } }),
          this.prisma.db.shift.count({ where: { branchId: b.id, status: 'OPEN' } }),
          this.prisma.db.order.findFirst({ where: { branchId: b.id, businessDate: { gte: dateCol(addDays(today, -1)) } }, orderBy: { updatedAt: 'desc' }, select: { paidAt: true, createdAt: true } }),
          this.prisma.db.device.aggregate({ where: { branchId: b.id, revokedAt: null }, _max: { lastSeenAt: true } }),
        ]);
        return {
          branchId: b.id, code: b.code, name: b.name, today, total: agg.kpi.total, orders: agg.kpi.orders, openBills, openShifts,
          lastActivity: last ? (last.paidAt ?? last.createdAt).toISOString() : null,
          lastSeen: device._max.lastSeenAt?.toISOString() ?? null,
        };
      }),
    );
  }
}
