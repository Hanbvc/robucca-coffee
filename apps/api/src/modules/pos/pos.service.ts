import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@robucca/db';
import type { DeviceCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { OrderSyncService, type SyncResult } from './order-sync.service';
import type { CashMovementDocDto, FulfillmentDocDto, KitchenDocDto, ShiftDocDto, SyncDto } from './sync.dto';

/** Hak yang membuat staf menjadi penyetuju (hash PIN-nya tidak dikirim ke perangkat). */
export const APPROVER_PERMS = ['*', 'order.void.approve', 'order.refund.approve', 'discount.approve'];

type DocResult = { id: string; status: 'saved' | 'duplicate' | 'rejected'; errors?: string[] };

/** Pesanan lengkap untuk feed perangkat (tagihan terbuka di terminal lain, layar dapur, antrean). */
export const ORDER_FEED_SELECT = {
  id: true, number: true, queueNumber: true, source: true, type: true, status: true, fulfillment: true,
  tableNumber: true, customerName: true, customerPhone: true, note: true, pickupAt: true, platformOrderRef: true,
  channelId: true, channelMarkupBp: true, shiftId: true, cashierId: true, deviceId: true, promotionId: true, discountNote: true,
  subtotal: true, discountTotal: true, serviceCharge: true, taxTotal: true, deliveryFee: true, rounding: true, total: true,
  taxRateBp: true, taxInclusive: true, serviceRateBp: true, taxOnService: true, roundingUnit: true, roundingMode: true,
  createdAt: true, paidAt: true, readyAt: true, completedAt: true, updatedAt: true, voidedAt: true, voidReason: true, version: true,
  businessDate: true,
  items: {
    select: {
      id: true, productId: true, productName: true, quantity: true, unitPrice: true, discountAmount: true, lineTotal: true, note: true,
      station: true, kitchenStatus: true, sentToKitchenAt: true, kitchenDoneAt: true, voidedAt: true, voidReason: true, promotionId: true,
      modifiers: { select: { modifierOptionId: true, groupName: true, optionName: true, priceDelta: true } },
    },
  },
  payments: { select: { id: true, method: true, provider: true, amount: true, tenderedAmount: true, changeAmount: true, reference: true, paidAt: true, paymentOptionId: true } },
  refund: { select: { amount: true, reason: true, createdAt: true } },
  delivery: { select: { status: true, recipientName: true, addressText: true, fee: true, driverName: true, vehiclePlate: true } },
} satisfies Prisma.OrderSelect;

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderSyncService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** Satu kiriman sinkron. Urutan: shift → kas → pesanan → status dapur → log. Tiap dokumen diproses sendiri-sendiri. */
  async sync(body: SyncDto, device: DeviceCtx) {
    const shifts: DocResult[] = [];
    for (const s of body.shifts ?? []) shifts.push(await this.shift(s, device));
    const cashMovements: DocResult[] = [];
    for (const c of body.cashMovements ?? []) cashMovements.push(await this.cash(c, device));
    const orders: SyncResult[] = [];
    for (const o of body.orders ?? []) orders.push(await this.orders.upsert(o, device));
    // Tutup shift dihitung ulang setelah pesanan & kas di kiriman yang sama masuk.
    for (const s of body.shifts ?? []) if (s.status === 'CLOSED') await this.closeShiftTotals(s.id);
    const kitchen: DocResult[] = [];
    for (const k of body.kitchen ?? []) kitchen.push(await this.kitchen(k, device));
    for (const f of body.fulfillment ?? []) kitchen.push(await this.fulfillment(f, device));
    let audit = 0;
    for (const a of body.audit ?? []) {
      await this.audit.log({ action: `pos.${a.action}`, entity: 'Device', entityId: device.id, branchId: device.branchId, actorId: a.actorId ?? null, detail: { ...(a.detail ?? {}), at: a.at } as Prisma.InputJsonValue });
      audit++;
    }
    const changed = [...orders, ...kitchen, ...shifts, ...cashMovements].some((r) => r.status === 'saved');
    if (changed && device.branchId) this.events.emit({ branchId: device.branchId, type: 'feed', data: { at: Date.now() } });
    return { shifts, cashMovements, orders, kitchen, audit, serverTime: new Date().toISOString() };
  }

  private async shift(s: ShiftDocDto, device: DeviceCtx): Promise<DocResult> {
    const branchId = device.branchId;
    if (!branchId) return { id: s.id, status: 'rejected', errors: ['Perangkat kantor tidak punya shift'] };
    const prev = await this.prisma.db.shift.findUnique({ where: { id: s.id } });
    if (prev && prev.branchId !== branchId) return { id: s.id, status: 'rejected', errors: ['Shift milik cabang lain'] };
    if (prev?.status === 'CLOSED') return { id: s.id, status: 'duplicate' };
    const opener = await this.prisma.db.user.findUnique({ where: { id: s.openedById }, include: { branches: true, role: true } });
    if (!opener || (opener.role.code !== 'SUPER_ADMIN' && !opener.branches.some((b) => b.branchId === branchId))) {
      return { id: s.id, status: 'rejected', errors: ['Staf pembuka shift tidak dikenal di cabang ini'] };
    }
    // Satu terminal hanya boleh punya satu shift terbuka (mis. perangkat dipasang ulang lalu membuka shift baru).
    if (!prev && s.status === 'OPEN') {
      const other = await this.prisma.db.shift.findFirst({
        where: { branchId, status: 'OPEN', OR: [{ deviceId: device.id }, { device: { terminalNo: device.terminalNo } }] },
        select: { openedAt: true, openedBy: { select: { name: true } } },
      });
      if (other) {
        return { id: s.id, status: 'rejected', errors: [`Terminal ${device.terminalNo} masih punya shift terbuka (dibuka ${other.openedBy.name}). Lanjutkan shift itu atau tutup dulu.`] };
      }
    }
    if (s.status === 'CLOSED' && (s.countedCash == null || !s.closedAt || !s.closedById)) {
      return { id: s.id, status: 'rejected', errors: ['Tutup shift butuh kas dihitung, waktu, dan staf'] };
    }
    const data = {
      status: s.status,
      openingCash: s.openingCash,
      closedById: s.closedById ?? null,
      closedAt: s.closedAt ? new Date(s.closedAt) : null,
      countedCash: s.countedCash ?? null,
      countedDenominations: s.countedDenominations ?? undefined,
      differenceNote: s.differenceNote?.trim() || null,
    };
    if (prev) await this.prisma.db.shift.update({ where: { id: s.id }, data });
    else await this.prisma.db.shift.create({ data: { id: s.id, branchId, deviceId: device.id, openedById: s.openedById, openedAt: new Date(s.openedAt), ...data } });
    await this.audit.log({
      action: s.status === 'CLOSED' ? 'shift.close' : 'shift.open', entity: 'Shift', entityId: s.id, branchId,
      actorId: s.closedById ?? s.openedById, detail: { openingCash: s.openingCash, countedCash: s.countedCash ?? null, note: s.differenceNote ?? null },
    });
    return { id: s.id, status: 'saved' };
  }

  /** Kas seharusnya = kas awal + pembayaran tunai (pesanan lunas) + kas masuk − kas keluar − refund tunai. */
  async closeShiftTotals(shiftId: string): Promise<void> {
    const shift = await this.prisma.db.shift.findUnique({ where: { id: shiftId } });
    if (!shift || shift.status !== 'CLOSED') return;
    const [cashPaid, moves, refunds] = await Promise.all([
      this.prisma.db.payment.aggregate({ where: { shiftId, method: 'CASH', status: 'SUCCEEDED', order: { status: { in: ['PAID', 'REFUNDED'] } } }, _sum: { amount: true } }),
      this.prisma.db.cashMovement.groupBy({ by: ['type'], where: { shiftId }, _sum: { amount: true } }),
      this.prisma.db.refund.aggregate({ where: { shiftId }, _sum: { amount: true } }),
    ]);
    const m = (t: string) => moves.find((x) => x.type === t)?._sum.amount ?? 0;
    const expectedCash = shift.openingCash + (cashPaid._sum.amount ?? 0) + m('CASH_IN') - m('CASH_OUT') - (refunds._sum.amount ?? 0);
    await this.prisma.db.shift.update({ where: { id: shiftId }, data: { expectedCash } });
  }

  private async cash(c: CashMovementDocDto, device: DeviceCtx): Promise<DocResult> {
    const shift = await this.prisma.db.shift.findUnique({ where: { id: c.shiftId } });
    if (!shift || shift.branchId !== device.branchId) return { id: c.id, status: 'rejected', errors: ['Shift tidak dikenal di cabang ini'] };
    const exists = await this.prisma.db.cashMovement.findUnique({ where: { id: c.id } });
    if (exists) return { id: c.id, status: 'duplicate' };
    await this.prisma.db.cashMovement.create({
      data: { id: c.id, branchId: shift.branchId, shiftId: c.shiftId, type: c.type, amount: c.amount, reason: c.reason.trim(), createdById: c.createdById, createdAt: new Date(c.createdAt) },
    });
    await this.audit.log({ action: c.type === 'CASH_IN' ? 'cash.in' : 'cash.out', entity: 'Shift', entityId: c.shiftId, branchId: shift.branchId, actorId: c.createdById, detail: { amount: c.amount, reason: c.reason } });
    return { id: c.id, status: 'saved' };
  }

  private async kitchen(k: KitchenDocDto, device: DeviceCtx): Promise<DocResult> {
    const order = await this.prisma.db.order.findUnique({ where: { id: k.orderId }, select: { branchId: true } });
    if (!order || order.branchId !== device.branchId) return { id: k.orderId, status: 'rejected', errors: ['Pesanan tidak dikenal di cabang ini'] };
    const at = new Date(k.at);
    await this.prisma.db.orderItem.updateMany({
      where: { orderId: k.orderId, ...(k.itemId ? { id: k.itemId } : {}) },
      data: { kitchenStatus: k.done ? 'DONE' : 'QUEUED', kitchenDoneAt: k.done ? at : null },
    });
    // Semua item selesai → pesanan siap diambil (layar antrean & status PWA).
    const open = await this.prisma.db.orderItem.count({ where: { orderId: k.orderId, voidedAt: null, kitchenStatus: 'QUEUED', station: { not: 'NONE' } } });
    await this.prisma.db.order.update({
      where: { id: k.orderId },
      data: open === 0 ? { fulfillment: 'READY', readyAt: at } : { fulfillment: 'PREPARING', readyAt: null },
    });
    this.events.emit({ branchId: order.branchId, type: 'order', data: { id: k.orderId } });
    return { id: k.orderId, status: 'saved' };
  }

  private async fulfillment(f: FulfillmentDocDto, device: DeviceCtx): Promise<DocResult> {
    const order = await this.prisma.db.order.findUnique({ where: { id: f.orderId }, select: { branchId: true } });
    if (!order || order.branchId !== device.branchId) return { id: f.orderId, status: 'rejected', errors: ['Pesanan tidak dikenal di cabang ini'] };
    const at = new Date(f.at);
    await this.prisma.db.order.update({
      where: { id: f.orderId },
      data: { fulfillment: f.fulfillment, ...(f.fulfillment === 'READY' ? { readyAt: at } : {}), ...(f.fulfillment === 'COMPLETED' ? { completedAt: at } : {}) },
    });
    this.events.emit({ branchId: order.branchId, type: 'order', data: { id: f.orderId } });
    return { id: f.orderId, status: 'saved' };
  }

  /** Pesanan cabang yang berubah sejak `since` (kursor = updatedAt terakhir). */
  async feed(device: DeviceCtx, since: Date | null) {
    if (!device.branchId) return { cursor: new Date().toISOString(), orders: [] };
    const orders = await this.prisma.db.order.findMany({
      where: { branchId: device.branchId, ...(since ? { updatedAt: { gt: since } } : { OR: [{ status: 'OPEN' }, { updatedAt: { gt: new Date(Date.now() - 24 * 3600e3) } }] }) },
      orderBy: { updatedAt: 'asc' },
      take: 500,
      select: ORDER_FEED_SELECT,
    });
    const cursor = orders.length ? orders[orders.length - 1]!.updatedAt.toISOString() : (since ?? new Date(0)).toISOString();
    return { cursor, more: orders.length === 500, orders };
  }

  /** Data master untuk perangkat (dipakai offline): cabang, menu, kanal, metode bayar, promo, staf + hash PIN. */
  async master(device: DeviceCtx) {
    const branchId = device.branchId;
    const db = this.prisma.db;
    const [settings, branch, categories, channels, paymentOptions, promotions, staff, couriers] = await Promise.all([
      db.organizationSetting.findUnique({ where: { id: 1 } }),
      branchId ? db.branch.findUnique({ where: { id: branchId } }) : null,
      db.category.findMany({
        where: { isActive: true },
        orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
        select: {
          id: true, name: true, group: true, station: true, quickNotes: true, sortOrder: true,
          products: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true, slug: true, name: true, imageUrl: true, basePrice: true, station: true, isSignature: true,
              branchSettings: branchId ? { where: { branchId }, select: { priceOverride: true, isAvailable: true } } : { take: 0, select: { priceOverride: true, isAvailable: true } },
              recipe: { select: { lines: { select: { inventoryItemId: true, quantity: true } } } },
              modifierGroups: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  showWhenOptionIds: true,
                  group: { select: { id: true, name: true, selection: true, isRequired: true, maxSelect: true, options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, priceDelta: true, isDefault: true, imageUrl: true } } } },
                },
              },
            },
          },
        },
      }),
      db.salesChannel.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      db.paymentOption.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      db.promotion.findMany({
        where: { isActive: true, ...(branchId ? { OR: [{ allBranches: true }, { branches: { some: { branchId } } }] } : {}), AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] }] },
        select: { id: true, name: true, type: true, value: true, requiresApproval: true, validFrom: true, validUntil: true },
      }),
      db.user.findMany({
        where: { isActive: true, pinHash: { not: null }, ...(branchId ? { OR: [{ role: { code: 'SUPER_ADMIN' } }, { branches: { some: { branchId } } }] } : {}) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, pinHash: true, role: { select: { code: true, permissions: true } } },
      }),
      db.courierService.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const stock = branchId ? await db.inventoryStock.findMany({ where: { branchId }, select: { inventoryItemId: true, quantity: true } }) : [];
    const level = new Map(stock.map((s) => [s.inventoryItemId, s.quantity]));
    const menu = categories.map((c) => ({
      ...c,
      products: c.products.map(({ branchSettings, modifierGroups, recipe, basePrice, ...p }) => {
        const s = branchSettings[0];
        // Habis bila salah satu bahan resepnya ≤ 0 di cabang ini (hanya bila stok bahannya dicatat).
        const outOfStock = !!recipe?.lines.some((l) => level.has(l.inventoryItemId) && level.get(l.inventoryItemId)!.lte(0));
        return {
          ...p,
          station: p.station ?? c.station,
          basePrice,
          price: s?.priceOverride ?? basePrice,
          available: s?.isAvailable ?? true,
          outOfStock,
          modifierGroups: modifierGroups.map((g) => ({ ...g.group, showWhenOptionIds: g.showWhenOptionIds })),
        };
      }),
    }));
    const master = {
      device,
      settings,
      branch,
      menu,
      channels,
      paymentOptions,
      promotions,
      couriers,
      // Hash PIN staf yang berhak menyetujui (void/refund/diskon) TIDAK dikirim: PIN 4–6 digit bisa ditebak offline
      // dari hash. Staf ini hanya bisa login saat online (PIN diperiksa server lewat /pos/login & /pos/approve).
      staff: staff.map((s) => {
        const approver = APPROVER_PERMS.some((p) => s.role.permissions.includes(p));
        return { id: s.id, name: s.name, pinHash: approver ? null : s.pinHash, onlineOnly: approver, role: s.role.code, permissions: s.role.permissions };
      }),
    };
    const version = createHash('sha1').update(JSON.stringify(master)).digest('hex').slice(0, 16);
    return { version, master };
  }

}
