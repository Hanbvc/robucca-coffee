import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService, can, canBranch, type DeviceCtx, type StaffCtx } from '../../common/auth';
import { verify } from '../../common/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { ORDER_FEED_SELECT } from '../pos/pos.service';
import { StockService } from '../stock/stock.service';

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
   * Online saja: butuh hak refund pada staf yang login, atau token persetujuan manajer.
   */
  async refund(id: string, reason: string, approval: string | undefined, staff: StaffCtx, device: DeviceCtx | undefined) {
    let approverId: string | null = can(staff, 'order.refund.approve') ? staff.id : null;
    if (!approverId && approval) {
      const p = verify<{ sub: string; perm: string; dev: string; typ?: string }>(approval);
      if (!p || p.typ !== 'appr' || p.perm !== 'order.refund.approve' || (device && p.dev !== device.id)) throw new ForbiddenException('Persetujuan manajer tidak sah atau kedaluwarsa');
      // Penyetuju diperiksa ulang: masih aktif, masih berhak, dan cabangnya sama.
      const a = await this.auth.staffById(p.sub);
      if (!a || !can(a, 'order.refund.approve')) throw new ForbiddenException('Penyetuju tidak berhak');
      approverId = p.sub;
    }
    if (!approverId) throw new ForbiddenException('Refund butuh persetujuan manajer (PIN)');

    const result = await this.prisma.db.$transaction(async (tx) => {
      const o = await tx.order.findUnique({
        where: { id },
        select: { id: true, branchId: true, number: true, status: true, total: true, version: true, items: { where: { voidedAt: null }, select: { productId: true, quantity: true, modifiers: { select: { modifierOptionId: true } } } } },
      });
      if (!o || !canBranch(staff, o.branchId)) throw new NotFoundException('Pesanan tidak ditemukan');
      if (device?.branchId && device.branchId !== o.branchId) throw new BadRequestException('Refund dilakukan di cabang pesanan');
      if (o.status === 'REFUNDED') throw new ConflictException('Pesanan ini sudah di-refund');
      if (o.status !== 'PAID') throw new BadRequestException('Hanya pesanan lunas yang bisa di-refund');
      const shift = device ? await tx.shift.findFirst({ where: { branchId: o.branchId, deviceId: device.id, status: 'OPEN' }, select: { id: true } }) : null;
      const refund = await tx.refund.create({
        data: { branchId: o.branchId, orderId: o.id, shiftId: shift?.id ?? null, amount: o.total, reason: reason.trim(), approvedById: approverId!, processedById: staff.id, createdAt: new Date() },
      });
      await tx.order.update({ where: { id: o.id }, data: { status: 'REFUNDED', version: { increment: 1 } } });
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
}
