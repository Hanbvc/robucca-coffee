import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { deliveryEtaMinutes, normalizePhone } from '@robucca/core';
import type { Prisma } from '@robucca/db';
import { AuthService, can, canBranch, type DeviceCtx, type StaffCtx } from '../../common/auth';
import { verify } from '../../common/tokens';
import { SERVER_VERSION_STEP } from '../../common/versions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { ORDER_FEED_SELECT } from '../pos/pos.service';
import { StockService } from '../stock/stock.service';
import type { DispatchDto } from './orders.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly events: EventsService,
    private readonly auth: AuthService,
  ) {}

  async get(id: string, staff: StaffCtx) {
    const o = await this.prisma.db.order.findUnique({ where: { id }, select: { ...ORDER_FEED_SELECT, branchId: true } });
    if (!o || !canBranch(staff, o.branchId)) throw new NotFoundException('Pesanan tidak ditemukan');
    return o;
  }

  /**
   * Refund penuh, sekali per pesanan (dijaga juga oleh constraint unik di database).
   * Online saja: staf yang memproses harus bisa berjualan (order.sell) dan punya hak refund sendiri, atau membawa token
   * persetujuan manajer yang diminta olehnya sendiri di perangkat ini. Penyetuju harus berhak atas cabang pesanan.
   */
  async refund(id: string, reason: string, approval: string | undefined, staff: StaffCtx, device: DeviceCtx | undefined) {
    if (!can(staff, 'order.sell') && !can(staff, 'order.refund.approve')) throw new ForbiddenException('Anda tidak berhak memproses refund');
    let approver: StaffCtx | null = can(staff, 'order.refund.approve') ? staff : null;
    if (!approver && approval) {
      const p = verify<{ sub: string; perm: string; dev: string; req?: string; typ?: string }>(approval);
      const valid = !!p && p.typ === 'appr' && p.perm === 'order.refund.approve' && !!device && p.dev === device.id && p.req === staff.id;
      if (!valid) throw new ForbiddenException('Persetujuan manajer tidak sah atau kedaluwarsa');
      // Penyetuju diperiksa ulang: masih aktif dan masih berhak (cabangnya diperiksa setelah pesanan dibaca).
      const a = await this.auth.staffById(p.sub);
      if (!a || !can(a, 'order.refund.approve')) throw new ForbiddenException('Penyetuju tidak berhak');
      approver = a;
    }
    if (!approver) throw new ForbiddenException('Refund butuh persetujuan manajer (PIN)');
    const approverId = approver.id;

    const result = await this.prisma.db.$transaction(async (tx) => {
      const o = await tx.order.findUnique({
        where: { id },
        select: { id: true, branchId: true, number: true, status: true, total: true, version: true, items: { where: { voidedAt: null }, select: { productId: true, quantity: true, modifiers: { select: { modifierOptionId: true } } } } },
      });
      if (!o || !canBranch(staff, o.branchId)) throw new NotFoundException('Pesanan tidak ditemukan');
      if (device?.branchId && device.branchId !== o.branchId) throw new BadRequestException('Refund dilakukan di cabang pesanan');
      if (!canBranch(approver!, o.branchId)) throw new ForbiddenException('Penyetuju tidak berhak atas cabang pesanan ini');
      if (o.status === 'REFUNDED') throw new ConflictException('Pesanan ini sudah di-refund');
      if (o.status !== 'PAID') throw new BadRequestException('Hanya pesanan lunas yang bisa di-refund');
      const shift = device ? await tx.shift.findFirst({ where: { branchId: o.branchId, deviceId: device.id, status: 'OPEN' }, select: { id: true } }) : null;
      const refund = await tx.refund.create({
        data: { branchId: o.branchId, orderId: o.id, shiftId: shift?.id ?? null, amount: o.total, reason: reason.trim(), approvedById: approverId, processedById: staff.id, createdAt: new Date() },
      });
      await tx.order.update({ where: { id: o.id }, data: { status: 'REFUNDED', version: { increment: SERVER_VERSION_STEP } } });
      await this.stock.applyOrder(tx, {
        branchId: o.branchId, orderId: o.id, sign: 1, actorId: staff.id, at: new Date(),
        items: o.items.map((i) => ({ productId: i.productId, quantity: i.quantity, optionIds: i.modifiers.map((m) => m.modifierOptionId) })),
      });
      await this.audit.log({ action: 'order.refund', entity: 'Order', entityId: o.id, branchId: o.branchId, actorId: approverId, detail: { number: o.number, amount: o.total, reason, processedBy: staff.id } }, tx);
      return { refund, branchId: o.branchId };
    });
    this.events.emit({ branchId: result.branchId, type: 'feed', data: { at: Date.now() } });
    return result.refund;
  }

  /**
   * Delivery berangkat: kasir mencatat driver yang mengambil pesanan (dari aplikasi GoSend/GrabExpress atau kurir cabang).
   * Pelanggan langsung melihat "Sedang diantar" beserta nama, plat, nomor, perkiraan tiba, dan tautan lacak.
   * Boleh dikirim ulang untuk membetulkan data driver. Versi naik SERVER_VERSION_STEP: salinan lama di perangkat kasir
   * tidak bisa mengembalikan status pesanan.
   */
  async dispatch(id: string, body: DispatchDto, staff: StaffCtx, device: DeviceCtx | undefined) {
    const driverPhone = body.driverPhone ? normalizePhone(body.driverPhone) : null;
    if (body.driverPhone && !driverPhone) throw new BadRequestException('Nomor driver belum valid');
    const now = new Date();
    const branchId = await this.prisma.db.$transaction(async (tx) => {
      const o = await this.deliveryOrder(tx, id, staff, device);
      if (o.fulfillment === 'COMPLETED' || o.fulfillment === 'CANCELLED') throw new ConflictException('Pesanan ini sudah selesai');
      const again = o.fulfillment === 'OUT_FOR_DELIVERY';
      const eta = body.etaMinutes ?? (again ? null : deliveryEtaMinutes(o.delivery.distanceKm.toNumber(), 0));
      const moved = await tx.order.updateMany({
        where: { id: o.id, status: 'PAID', fulfillment: o.fulfillment },
        data: { fulfillment: 'OUT_FOR_DELIVERY', version: { increment: SERVER_VERSION_STEP } },
      });
      if (!moved.count) throw new ConflictException('Status pesanan baru saja berubah. Coba lagi.');
      await tx.delivery.update({
        where: { orderId: o.id },
        data: {
          status: 'PICKED_UP',
          driverName: body.driverName,
          driverPhone,
          vehiclePlate: body.vehiclePlate?.toUpperCase() ?? null,
          trackingUrl: body.trackingUrl ?? null,
          ...(eta != null ? { estimatedAt: new Date(now.getTime() + eta * 60_000) } : {}),
          ...(again ? {} : { pickedUpAt: now }),
        },
      });
      await this.audit.log({
        action: again ? 'delivery.driver_update' : 'delivery.dispatch', entity: 'Order', entityId: o.id, branchId: o.branchId, actorId: staff.id,
        detail: { number: o.number, driverName: body.driverName, vehiclePlate: body.vehiclePlate ?? null },
      }, tx);
      return o.branchId;
    });
    this.events.emit({ branchId, type: 'order', data: { id } });
    return this.get(id, staff);
  }

  /** Delivery tiba di pelanggan (kabar dari driver / aplikasi kurir). Pelanggan juga bisa menandainya sendiri di aplikasi. */
  async delivered(id: string, staff: StaffCtx, device: DeviceCtx | undefined) {
    const now = new Date();
    const branchId = await this.prisma.db.$transaction(async (tx) => {
      const o = await this.deliveryOrder(tx, id, staff, device);
      if (o.fulfillment === 'COMPLETED') return null;
      if (o.fulfillment !== 'READY' && o.fulfillment !== 'OUT_FOR_DELIVERY') throw new ConflictException('Pesanan belum siap diantar');
      const moved = await tx.order.updateMany({
        where: { id: o.id, status: 'PAID', fulfillment: o.fulfillment },
        data: { fulfillment: 'COMPLETED', completedAt: now, version: { increment: SERVER_VERSION_STEP } },
      });
      if (!moved.count) throw new ConflictException('Status pesanan baru saja berubah. Coba lagi.');
      await tx.delivery.update({ where: { orderId: o.id }, data: { status: 'DELIVERED', deliveredAt: now } });
      await this.audit.log({ action: 'delivery.delivered', entity: 'Order', entityId: o.id, branchId: o.branchId, actorId: staff.id, detail: { number: o.number } }, tx);
      return o.branchId;
    });
    if (branchId) this.events.emit({ branchId, type: 'order', data: { id } });
    return this.get(id, staff);
  }

  /** Pesanan delivery lunas di cabang staf (dan perangkat) ini. */
  private async deliveryOrder(tx: Prisma.TransactionClient, id: string, staff: StaffCtx, device: DeviceCtx | undefined) {
    const o = await tx.order.findUnique({
      where: { id },
      select: { id: true, branchId: true, number: true, type: true, status: true, fulfillment: true, delivery: { select: { distanceKm: true } } },
    });
    if (!o || !canBranch(staff, o.branchId)) throw new NotFoundException('Pesanan tidak ditemukan');
    if (device?.branchId && device.branchId !== o.branchId) throw new BadRequestException('Pesanan ini milik cabang lain');
    if (o.type !== 'DELIVERY' || !o.delivery) throw new BadRequestException('Bukan pesanan delivery');
    if (o.status !== 'PAID') throw new ConflictException(o.status === 'OPEN' ? 'Pesanan delivery ini belum dibayar' : 'Pesanan ini sudah dibatalkan atau di-refund');
    return { ...o, delivery: o.delivery };
  }
}
