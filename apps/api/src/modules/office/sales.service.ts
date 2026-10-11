/* Transaksi & shift kasir untuk kantor (dan riwayat cabang untuk perangkat POS). */
import { Injectable, NotFoundException } from '@nestjs/common';
import { addDays, countDenominations, DENOMINATIONS, type DateRange } from '@robucca/core';
import type { Prisma } from '@robucca/db';
import { canBranch, type StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { ORDER_FEED_SELECT } from '../pos/pos.service';
import { bizDateOf, branchWhere, dateCol, looseWindow, resolveRange, scopeBranches, todayFor, ymdOfCol, type PageQueryDto } from './office.common';
import { orderTotals, ReportService } from './report.service';
import type { ShiftQueryDto, TransactionQueryDto } from './office.dto';

const LIST_ORDER = {
  id: true, number: true, queueNumber: true, branchId: true, source: true, type: true, status: true, fulfillment: true, businessDate: true,
  createdAt: true, paidAt: true, voidedAt: true, voidReason: true, tableNumber: true, customerName: true, platformOrderRef: true, discountNote: true,
  subtotal: true, discountTotal: true, serviceCharge: true, taxTotal: true, deliveryFee: true, rounding: true, total: true, shiftId: true,
  branch: { select: { code: true, name: true } },
  device: { select: { terminalNo: true, name: true } },
  cashier: { select: { id: true, name: true } },
  channel: { select: { code: true, name: true } },
  promotion: { select: { name: true } },
  items: { where: { voidedAt: null }, select: { quantity: true } },
  payments: { where: { status: 'SUCCEEDED' }, select: { method: true, amount: true, reference: true, option: { select: { code: true, name: true } } } },
  refund: { select: { amount: true, reason: true, createdAt: true, approvedBy: { select: { name: true } }, processedBy: { select: { name: true } } } },
} satisfies Prisma.OrderSelect;
type ListOrder = Prisma.OrderGetPayload<{ select: typeof LIST_ORDER }>;

const STATUS: Record<string, Prisma.OrderWhereInput> = {
  paid: { status: 'PAID' },
  open: { status: { in: ['OPEN', 'AWAITING_PAYMENT'] } },
  void: { status: 'VOIDED' },
  refunded: { status: 'REFUNDED' },
  refund: { refund: { isNot: null } },
};

export const txRow = (o: ListOrder) => ({
  id: o.id, number: o.number, queueNumber: o.queueNumber, branchId: o.branchId, branchCode: o.branch.code, branchName: o.branch.name,
  terminalNo: o.device?.terminalNo ?? null, source: o.source, type: o.type, status: o.status, fulfillment: o.fulfillment,
  businessDate: ymdOfCol(o.businessDate), createdAt: o.createdAt, paidAt: o.paidAt, voidedAt: o.voidedAt, voidReason: o.voidReason,
  tableNumber: o.tableNumber, customerName: o.customerName, platformOrderRef: o.platformOrderRef, shiftId: o.shiftId,
  cashierId: o.cashier?.id ?? null, cashierName: o.cashier?.name ?? null, channelCode: o.channel?.code ?? null, channelName: o.channel?.name ?? null,
  discountName: o.promotion?.name ?? o.discountNote ?? null,
  totals: orderTotals(o),
  payments: o.payments.map((p) => ({ code: p.option?.code ?? p.method.toLowerCase(), name: p.option?.name ?? p.method, method: p.method, amount: p.amount, reference: p.reference })),
  refund: o.refund ? { amount: o.refund.amount, reason: o.refund.reason, createdAt: o.refund.createdAt, approvedBy: o.refund.approvedBy.name, processedBy: o.refund.processedBy.name } : null,
});

export interface ShiftSummary {
  count: number; refunds: number; voids: number; open: number; total: number; cashSales: number; cashRefunds: number; cashIn: number; cashOut: number;
  expected: number; byMethod: { code: string; method: string; name: string; amount: number; count: number }[];
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
  ) {}

  private async range(staff: StaffCtx, q: PageQueryDto, fallback: 'today' | '7d' = '7d'): Promise<{ scope: string[] | null; r: DateRange; branches: Awaited<ReturnType<ReportService['branchesOf']>> }> {
    const scope = scopeBranches(staff, q.branchId);
    const branches = await this.reports.branchesOf(scope);
    return { scope, r: resolveRange(q, todayFor(branches.length === 1 ? branches[0] : null), fallback), branches };
  }

  // ---------------------------------------------------------------- transaksi

  async transactions(staff: StaffCtx, q: TransactionQueryDto) {
    const { scope, r } = await this.range(staff, q);
    const search = q.q?.trim();
    const where: Prisma.OrderWhereInput = {
      ...branchWhere(scope),
      businessDate: { gte: dateCol(r.from), lte: dateCol(r.to) },
      ...(q.status ? STATUS[q.status] : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.channel ? { channel: { code: q.channel } } : {}),
      ...(q.cashierId ? { cashierId: q.cashierId } : {}),
      ...(q.shiftId ? { shiftId: q.shiftId } : {}),
      ...(q.payment ? { payments: { some: { option: { code: q.payment } } } } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { queueNumber: { contains: search, mode: 'insensitive' } },
              { tableNumber: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { platformOrderRef: { contains: search, mode: 'insensitive' } },
              { cashier: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const [total, rows, sums] = await Promise.all([
      this.prisma.db.order.count({ where }),
      this.prisma.db.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit, select: LIST_ORDER }),
      this.prisma.db.order.aggregate({ where: { AND: [where, { status: { in: ['PAID', 'REFUNDED'] } }] }, _sum: { total: true }, _count: true }),
    ]);
    return { range: r, total, limit, offset, summary: { paidCount: sums._count, paidTotal: sums._sum.total ?? 0 }, rows: rows.map(txRow) };
  }

  /** Detail struk + jejak log pesanan. */
  async transaction(staff: StaffCtx, id: string) {
    const o = await this.prisma.db.order.findUnique({
      where: { id },
      select: {
        ...ORDER_FEED_SELECT, branchId: true, source: true,
        branch: { select: { code: true, name: true, timezone: true, address: true, phone: true, taxLabel: true, receiptFooter: true, receiptPaperMm: true } },
        device: { select: { terminalNo: true, name: true } },
        cashier: { select: { id: true, name: true } },
        channel: { select: { code: true, name: true } },
        promotion: { select: { id: true, name: true } },
        discountApprovedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
        refund: { select: { amount: true, reason: true, createdAt: true, approvedBy: { select: { id: true, name: true } }, processedBy: { select: { id: true, name: true } } } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!o || !canBranch(staff, o.branchId)) throw new NotFoundException('Transaksi tidak ditemukan');
    const audit = await this.prisma.db.auditLog.findMany({
      where: { entity: 'Order', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, detail: true, createdAt: true, actor: { select: { id: true, name: true } } },
    });
    return { ...o, businessDate: ymdOfCol(o.businessDate), totals: orderTotals({ ...o, items: o.items.filter((i) => !i.voidedAt) }), audit };
  }

  // ---------------------------------------------------------------- shift

  /** Ringkasan shift; kas seharusnya sama dengan PosService.closeShiftTotals. */
  async summaries(shifts: { id: string; openingCash: number }[]): Promise<Map<string, ShiftSummary>> {
    const ids = shifts.map((s) => s.id);
    const out = new Map<string, ShiftSummary>();
    if (!ids.length) return out;
    const db = this.prisma.db;
    const [orders, payments, refunds, moves] = await Promise.all([
      db.order.groupBy({ by: ['shiftId', 'status'], where: { shiftId: { in: ids } }, _sum: { total: true }, _count: true }),
      db.payment.findMany({
        where: { shiftId: { in: ids }, status: 'SUCCEEDED', order: { status: { in: ['PAID', 'REFUNDED'] } } },
        select: { shiftId: true, method: true, amount: true, option: { select: { code: true, name: true } } },
      }),
      db.refund.groupBy({ by: ['shiftId'], where: { shiftId: { in: ids } }, _sum: { amount: true }, _count: true }),
      db.cashMovement.groupBy({ by: ['shiftId', 'type'], where: { shiftId: { in: ids } }, _sum: { amount: true } }),
    ]);
    for (const s of shifts) {
      const os = orders.filter((o) => o.shiftId === s.id);
      const sale = os.filter((o) => o.status === 'PAID' || o.status === 'REFUNDED');
      const rf = refunds.find((x) => x.shiftId === s.id);
      const mv = (t: string) => moves.find((x) => x.shiftId === s.id && x.type === t)?._sum.amount ?? 0;
      const byMethod = new Map<string, ShiftSummary['byMethod'][number]>();
      let cashSales = 0;
      for (const p of payments.filter((x) => x.shiftId === s.id)) {
        const code = p.option?.code ?? p.method.toLowerCase();
        const x = byMethod.get(code) ?? { code, method: p.method, name: p.option?.name ?? p.method, amount: 0, count: 0 };
        x.amount += p.amount;
        x.count += 1;
        byMethod.set(code, x);
        if (p.method === 'CASH') cashSales += p.amount;
      }
      const cashRefunds = rf?._sum.amount ?? 0;
      const cashIn = mv('CASH_IN');
      const cashOut = mv('CASH_OUT');
      out.set(s.id, {
        count: sale.reduce((a, o) => a + o._count, 0),
        refunds: rf?._count ?? 0,
        voids: os.filter((o) => o.status === 'VOIDED').reduce((a, o) => a + o._count, 0),
        open: os.filter((o) => o.status === 'OPEN').reduce((a, o) => a + o._count, 0),
        total: sale.reduce((a, o) => a + (o._sum.total ?? 0), 0) - cashRefunds,
        cashSales, cashRefunds, cashIn, cashOut,
        expected: s.openingCash + cashSales + cashIn - cashOut - cashRefunds,
        byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
      });
    }
    return out;
  }

  private shiftSelect = {
    id: true, branchId: true, deviceId: true, status: true, openedAt: true, closedAt: true, openingCash: true, expectedCash: true, countedCash: true,
    countedDenominations: true, differenceNote: true,
    branch: { select: { code: true, name: true, timezone: true, dayStartMinute: true } },
    device: { select: { terminalNo: true, name: true } },
    openedBy: { select: { id: true, name: true } },
    closedBy: { select: { id: true, name: true } },
  } satisfies Prisma.ShiftSelect;

  private shiftRow(s: Prisma.ShiftGetPayload<{ select: SalesService['shiftSelect'] }>, sum: ShiftSummary | undefined) {
    const expected = s.status === 'CLOSED' && s.expectedCash != null ? s.expectedCash : (sum?.expected ?? null);
    const denoms = (s.countedDenominations ?? null) as Record<string, number> | null;
    return {
      id: s.id, branchId: s.branchId, branchCode: s.branch.code, branchName: s.branch.name, deviceId: s.deviceId,
      terminalNo: s.device?.terminalNo ?? null, deviceName: s.device?.name ?? null, status: s.status,
      businessDate: bizDateOf(s.openedAt, s.branch), openedAt: s.openedAt, openedBy: s.openedBy, closedAt: s.closedAt, closedBy: s.closedBy,
      openingCash: s.openingCash, expectedCash: expected, countedCash: s.countedCash,
      difference: s.status === 'CLOSED' && s.countedCash != null && expected != null ? s.countedCash - expected : null,
      differenceNote: s.differenceNote,
      countedDenominations: denoms,
      denominations: denoms
        ? DENOMINATIONS.map((value) => ({ value, count: Number(denoms[String(value)] ?? 0), subtotal: value * Number(denoms[String(value)] ?? 0) })).filter((d) => d.count)
        : [],
      denominationsTotal: denoms ? countDenominations(denoms) : null,
      summary: sum ?? null,
    };
  }

  async shifts(staff: StaffCtx, q: ShiftQueryDto) {
    const { scope, r } = await this.range(staff, q);
    const list = await this.prisma.db.shift.findMany({
      where: { ...branchWhere(scope), openedAt: looseWindow(r), ...(q.status ? { status: q.status } : {}), ...(q.deviceId ? { deviceId: q.deviceId } : {}) },
      orderBy: { openedAt: 'desc' },
      select: this.shiftSelect,
    });
    const rows = list.filter((s) => {
      const d = bizDateOf(s.openedAt, s.branch);
      return d >= r.from && d <= r.to;
    });
    const sums = await this.summaries(rows);
    const out = rows.map((s) => this.shiftRow(s, sums.get(s.id)));
    const closed = out.filter((s) => s.status === 'CLOSED');
    return {
      range: r,
      totals: {
        shifts: out.length,
        open: out.length - closed.length,
        closed: closed.length,
        withDifference: closed.filter((s) => s.difference).length,
        difference: closed.reduce((a, s) => a + (s.difference ?? 0), 0),
      },
      rows: out,
    };
  }

  async shift(staff: StaffCtx | null, id: string, branchId?: string | null) {
    const s = await this.prisma.db.shift.findUnique({ where: { id }, select: this.shiftSelect });
    if (!s || (staff && !canBranch(staff, s.branchId)) || (branchId !== undefined && s.branchId !== branchId)) throw new NotFoundException('Shift tidak ditemukan');
    const [sums, moves, orders] = await Promise.all([
      this.summaries([s]),
      this.prisma.db.cashMovement.findMany({ where: { shiftId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, amount: true, reason: true, createdAt: true, createdBy: { select: { id: true, name: true } } } }),
      this.prisma.db.order.findMany({ where: { shiftId: id }, orderBy: { createdAt: 'asc' }, select: LIST_ORDER }),
    ]);
    return { ...this.shiftRow(s, sums.get(s.id)), cashMovements: moves, orders: orders.map(txRow) };
  }

  /** Shift terbuka milik perangkat (dipulihkan POS setelah dipasang ulang / data lokal hilang). */
  async openShiftForDevice(deviceId: string, branchId: string | null, terminalNo: number) {
    if (!branchId) return null;
    const s = await this.prisma.db.shift.findFirst({
      where: { branchId, status: 'OPEN', OR: [{ deviceId }, { device: { terminalNo } }] },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    return s ? this.shift(null, s.id, branchId) : null;
  }
}
