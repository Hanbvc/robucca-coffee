/* Menyimpan pesanan dari perangkat POS. Server tidak percaya total dari perangkat:
   - total dihitung ulang dengan @robucca/core dari baris & konfigurasi pajak pesanan;
   - opsi harus milik menu tersebut, pilihan wajib harus terisi;
   - diskon besar / promo tertentu dan void pesanan lunas butuh persetujuan manajer;
   - pembayaran harus sama dengan total; tunai diterima ≥ nominal;
   - perubahan berurutan lewat `version` (bukan "jam perangkat terbaru menang");
   - stok bahan dipotong sesuai resep saat lunas dan dikembalikan saat void. */
import { Injectable } from '@nestjs/common';
import {
  calcOrder, businessDate, channelPrice, chosenModifiers, selectionErrors, taxConfigFor,
  type MenuProduct, type Selection, type TaxConfig,
} from '@robucca/core';
import type { Prisma } from '@robucca/db';
import { can, canBranch, type DeviceCtx, type StaffCtx } from '../../common/auth';
import { sha256, verify } from '../../common/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService, type SoldItem } from '../stock/stock.service';
import type { DiscountDto, OrderDocDto } from './sync.dto';

export type SyncResult =
  | { id: string; status: 'saved' | 'duplicate' }
  | { id: string; status: 'conflict'; version: number; serverStatus: string }
  | { id: string; status: 'rejected'; errors: string[] };

class Reject extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
  }
}

const discountBp = (d: DiscountDto | undefined, base: number): number => {
  if (!d || base <= 0) return 0;
  return d.type === 'PERCENT' ? d.value : Math.round((Math.min(d.value, base) * 10000) / base);
};

type Tx = Prisma.TransactionClient;

/** Token persetujuan berlaku 5 menit; boleh terkirim hingga 24 jam kemudian (perangkat sempat offline). */
const APPROVAL_GRACE_S = 24 * 3600;

@Injectable()
export class OrderSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async upsert(doc: OrderDocDto, device: DeviceCtx): Promise<SyncResult> {
    if (!device.branchId) return { id: doc.id, status: 'rejected', errors: ['Perangkat kantor tidak bisa membuat transaksi'] };
    const branchId = device.branchId;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.db.$transaction(async (tx) => this.save(tx, doc, device, branchId), { isolationLevel: 'Serializable', timeout: 15_000 });
      } catch (e) {
        if (e instanceof Reject) return { id: doc.id, status: 'rejected', errors: e.errors };
        const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : '';
        // Dua terminal menyimpan pesanan yang sama bersamaan: ulangi (Postgres serialization failure).
        if (code === 'P2034' && attempt < 3) continue;
        if (code === 'P2002') return { id: doc.id, status: 'rejected', errors: ['Nomor struk atau ID sudah dipakai'] };
        throw e;
      }
    }
  }

  private async save(tx: Tx, doc: OrderDocDto, device: DeviceCtx, branchId: string): Promise<SyncResult> {
    const existing = await tx.order.findUnique({
      where: { id: doc.id },
      select: {
        id: true, branchId: true, status: true, version: true, taxRateBp: true, taxInclusive: true, serviceRateBp: true, taxOnService: true, roundingUnit: true, roundingMode: true, channelMarkupBp: true, source: true,
        deliveryFee: true, number: true, queueNumber: true, type: true, customerName: true, customerPhone: true, note: true,
      },
    });
    if (existing && existing.branchId !== branchId) throw new Reject(['Pesanan milik cabang lain']);
    if (existing) {
      if (doc.version === existing.version) return { id: doc.id, status: 'duplicate' };
      if (doc.version < existing.version) return { id: doc.id, status: 'conflict', version: existing.version, serverStatus: existing.status };
      if (existing.status === 'VOIDED' || existing.status === 'REFUNDED') {
        return { id: doc.id, status: 'conflict', version: existing.version, serverStatus: existing.status };
      }
    }
    const wasPaid = existing?.status === 'PAID';
    if (wasPaid && doc.status === 'OPEN') throw new Reject(['Pesanan lunas tidak bisa dibuka kembali']);

    const [branch, settings, cashier] = await Promise.all([
      tx.branch.findUniqueOrThrow({ where: { id: branchId } }),
      tx.organizationSetting.findUnique({ where: { id: 1 } }),
      this.staff(tx, doc.cashierId),
    ]);
    if (!cashier || !canBranch(cashier, branchId)) throw new Reject(['Kasir tidak dikenal di cabang ini']);

    // --- Konfigurasi pajak: dari cabang saat pesanan dibuat, lalu tetap (tarif bisa berubah kemudian).
    const cfg: TaxConfig = existing
      ? {
          taxRateBp: existing.taxRateBp, taxInclusive: existing.taxInclusive, serviceRateBp: existing.serviceRateBp,
          taxOnService: existing.taxOnService, roundingUnit: existing.roundingUnit, roundingMode: existing.roundingMode,
        }
      : taxConfigFor(branch, { roundingUnit: settings?.roundingUnit ?? 100, roundingMode: settings?.roundingMode ?? 'DOWN' });

    const channel = doc.channelCode ? await tx.salesChannel.findUnique({ where: { code: doc.channelCode } }) : null;
    if (doc.channelCode && !channel) throw new Reject([`Kanal ${doc.channelCode} tidak dikenal`]);
    if (doc.type === 'FOOD_PLATFORM' && channel?.type !== 'FOOD_PLATFORM') throw new Reject(['Pesanan ojol wajib memilih kanal GoFood/GrabFood/ShopeeFood']);
    const markupBp = existing ? existing.channelMarkupBp : (channel?.markupBp ?? 0);

    // --- Baris: menu & opsi harus valid; nama & opsi disalin dari database.
    const products = await this.products(tx, doc.items.map((i) => i.productId), branchId);
    const errors: string[] = [];
    const lines = doc.items.map((it, n) => {
      const p = products.get(it.productId);
      if (!p) {
        errors.push(`Baris ${n + 1}: menu tidak dikenal`);
        return null;
      }
      const sel: Selection = {};
      for (const g of p.menu.modifierGroups) sel[g.id] = it.optionIds.filter((id) => g.options.some((o) => o.id === id));
      const unknown = it.optionIds.filter((id) => !p.menu.modifierGroups.some((g) => g.options.some((o) => o.id === id)));
      if (unknown.length) errors.push(`Baris ${n + 1}: opsi tidak cocok dengan ${p.menu.name}`);
      if (!it.voided) for (const e of selectionErrors(p.menu, sel)) errors.push(`Baris ${n + 1}: ${e}`);
      const mods = chosenModifiers(p.menu, sel);
      const expected = channelPrice(p.menu.price + mods.reduce((a, m) => a + m.priceDelta, 0), markupBp);
      return { it, p, mods, expected };
    });
    if (errors.length) throw new Reject(errors);
    const valid = lines.filter((l): l is NonNullable<typeof l> => l !== null);

    const { totals, amounts } = calcOrder(
      {
        lines: valid.map(({ it }) => ({ id: it.id, unitPrice: it.unitPrice, quantity: it.quantity, discount: it.discount ?? null, voided: !!it.voided })),
        discount: doc.discount ?? null,
        // Ongkir pesanan delivery PWA ikut dibayar di kasir; nilainya dari server, bukan dari perangkat.
        deliveryFee: existing?.deliveryFee ?? 0,
      },
      cfg,
    );
    if (valid.filter((l) => !l.it.voided).length === 0 && doc.status === 'PAID') throw new Reject(['Pesanan kosong tidak bisa dibayar']);

    // --- Diskon: promo harus berlaku; di atas batas kasir atau promo khusus butuh persetujuan.
    const discounted = !!doc.discount?.value || valid.some((l) => l.it.discount?.value);
    let discountApprovedById: string | null = null;
    if (discounted && !wasPaid) {
      const promoIds = [doc.promotionId, ...valid.map((l) => l.it.promotionId)].filter((x): x is string => !!x);
      const promos = await tx.promotion.findMany({ where: { id: { in: promoIds } }, include: { branches: { select: { branchId: true } } } });
      const at = new Date(doc.createdAt);
      for (const id of promoIds) {
        const pr = promos.find((x) => x.id === id);
        const ok = pr && pr.isActive && (pr.allBranches || pr.branches.some((b) => b.branchId === branchId)) &&
          (!pr.validFrom || pr.validFrom <= at) && (!pr.validUntil || pr.validUntil >= at);
        if (!ok) throw new Reject(['Promo tidak berlaku di cabang/waktu ini']);
      }
      const promo = doc.promotionId ? promos.find((x) => x.id === doc.promotionId) : null;
      if (promo && doc.discount && (promo.type !== doc.discount.type || promo.value !== doc.discount.value)) throw new Reject(['Nilai diskon tidak sama dengan promo']);
      const maxBp = settings?.maxCashierDiscountBp ?? 1000;
      const gross = valid.filter((l) => !l.it.voided).reduce((a, l) => a + l.it.unitPrice * l.it.quantity, 0);
      const manualOrderBp = doc.promotionId ? 0 : discountBp(doc.discount, Math.max(1, gross - totals.lineDiscount));
      const manualLineBp = Math.max(0, ...valid.filter((l) => !l.it.promotionId).map((l) => discountBp(l.it.discount, l.it.unitPrice * l.it.quantity)));
      const needsApproval = manualOrderBp > maxBp || manualLineBp > maxBp || promos.some((p) => p.requiresApproval) || !can(cashier, 'order.sell');
      if (needsApproval) {
        discountApprovedById = await this.approver(tx, branchId, device, 'discount.approve', doc.discountApproval, doc.discountApprovedById, cashier.id, doc.id, 'discount');
        if (!discountApprovedById && can(cashier, 'discount.approve')) discountApprovedById = cashier.id;
        if (!discountApprovedById) throw new Reject(['Diskon ini butuh persetujuan manajer (PIN)']);
      }
    }

    // --- Pembayaran
    const options = await tx.paymentOption.findMany({ where: { code: { in: doc.payments.map((p) => p.optionCode) } } });
    if (doc.status === 'PAID' || (doc.status === 'VOIDED' && doc.payments.length)) {
      const sum = doc.payments.reduce((a, p) => a + p.amount, 0);
      if (doc.status === 'PAID' && sum !== totals.total) throw new Reject([`Jumlah pembayaran (${sum}) tidak sama dengan total (${totals.total})`]);
      for (const p of doc.payments) {
        const o = options.find((x) => x.code === p.optionCode);
        if (!o) throw new Reject([`Metode bayar ${p.optionCode} tidak dikenal`]);
        if (o.method === 'CASH' && (p.tendered ?? p.amount) < p.amount) throw new Reject(['Uang tunai diterima kurang dari nominal']);
        if (o.requiresReference && !p.reference?.trim()) throw new Reject([`${o.name}: nomor referensi wajib diisi`]);
      }
      if (doc.status === 'PAID' && !doc.paidAt) throw new Reject(['Waktu bayar wajib diisi']);
    }

    // --- Void
    let voidedById: string | null = null;
    if (doc.status === 'VOIDED') {
      if (!doc.voidReason?.trim()) throw new Reject(['Alasan void wajib diisi']);
      if (wasPaid || doc.payments.length) {
        voidedById = await this.approver(tx, branchId, device, 'order.void.approve', doc.voidApproval, doc.voidedById, cashier.id, doc.id, 'void');
        if (!voidedById && can(cashier, 'order.void.approve')) voidedById = cashier.id;
        if (!voidedById) throw new Reject(['Void pesanan lunas butuh persetujuan manajer (PIN)']);
      } else voidedById = doc.voidedById ?? cashier.id;
    }

    if (doc.shiftId) {
      const shift = await tx.shift.findUnique({ where: { id: doc.shiftId }, select: { branchId: true } });
      if (!shift || shift.branchId !== branchId) throw new Reject(['Shift tidak dikenal di cabang ini']);
    }

    // --- Simpan
    const createdAt = new Date(doc.createdAt);
    const now = new Date();
    // Pesanan dari PWA: nomor, tipe, dan data pelanggan tetap milik pesanan aslinya (yang dilihat pelanggan).
    const pwa = existing?.source === 'PWA' ? existing : null;
    const header = {
      number: pwa ? pwa.number : doc.number,
      queueNumber: pwa ? pwa.queueNumber : doc.queueNumber,
      type: pwa ? pwa.type : doc.type,
      status: doc.status,
      ...(doc.fulfillment ? { fulfillment: doc.fulfillment } : {}),
      tableNumber: doc.tableNumber?.trim() || null,
      customerName: doc.customerName?.trim() || pwa?.customerName || null,
      customerPhone: doc.customerPhone?.trim() || pwa?.customerPhone || null,
      note: doc.note?.trim() || pwa?.note || null,
      platformOrderRef: doc.platformOrderRef?.trim() || null,
      channelId: channel?.id ?? null,
      channelMarkupBp: markupBp,
      deviceId: device.id,
      shiftId: doc.shiftId ?? null,
      cashierId: cashier.id,
      subtotal: totals.gross,
      discountTotal: totals.discount,
      serviceCharge: totals.service,
      taxTotal: totals.tax,
      rounding: totals.rounding,
      total: totals.total,
      promotionId: doc.promotionId ?? null,
      discountNote: doc.discountNote?.trim() || null,
      ...(discountApprovedById ? { discountApprovedById } : {}),
      paidAt: doc.paidAt ? new Date(doc.paidAt) : null,
      voidReason: doc.status === 'VOIDED' ? doc.voidReason!.trim() : null,
      voidedById,
      voidedAt: doc.status === 'VOIDED' ? new Date(doc.voidedAt ?? now) : null,
      version: doc.version,
    };

    const canEditLines = !wasPaid;
    if (existing) {
      // Setelah lunas, isi pesanan & pembayaran tidak berubah (hanya status void).
      const data = canEditLines ? header : { status: header.status, fulfillment: header.fulfillment, voidReason: header.voidReason, voidedById, voidedAt: header.voidedAt, version: doc.version };
      await tx.order.update({ where: { id: doc.id }, data });
    } else {
      await tx.order.create({
        data: {
          id: doc.id,
          branchId,
          source: 'POS',
          businessDate: new Date(`${businessDate(createdAt.getTime(), branch.timezone, branch.dayStartMinute)}T00:00:00Z`),
          createdAt,
          taxRateBp: cfg.taxRateBp,
          taxInclusive: cfg.taxInclusive,
          serviceRateBp: cfg.serviceRateBp,
          taxOnService: cfg.taxOnService,
          roundingUnit: cfg.roundingUnit,
          roundingMode: cfg.roundingMode,
          ...header,
        },
      });
    }

    if (canEditLines) {
      const byId = new Map(amounts.map((a) => [a.id, a]));
      // Status dapur dipertahankan untuk baris yang sudah ada (tiket yang sudah selesai tidak muncul lagi).
      const prevKitchen = new Map(
        (await tx.orderItem.findMany({ where: { orderId: doc.id }, select: { id: true, kitchenStatus: true, kitchenDoneAt: true } })).map((k) => [k.id, k]),
      );
      await tx.orderItem.deleteMany({ where: { orderId: doc.id } });
      for (const { it, p, mods } of valid) {
        const a = byId.get(it.id);
        await tx.orderItem.create({
          data: {
            id: it.id,
            orderId: doc.id,
            productId: it.productId,
            productName: p.menu.name,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discountAmount: a?.discount ?? 0,
            promotionId: it.promotionId ?? null,
            lineTotal: a?.amount ?? 0,
            note: it.note?.trim() || null,
            station: p.station,
            sentToKitchenAt: it.sentToKitchenAt ? new Date(it.sentToKitchenAt) : null,
            kitchenStatus: prevKitchen.get(it.id)?.kitchenStatus ?? 'QUEUED',
            kitchenDoneAt: prevKitchen.get(it.id)?.kitchenDoneAt ?? null,
            voidedAt: it.voided ? new Date(it.voided.at) : null,
            voidReason: it.voided?.reason ?? null,
            voidedById: it.voided ? (it.voided.byId ?? cashier.id) : null,
            modifiers: {
              create: mods.map((m) => ({ modifierOptionId: m.optionId, groupName: m.groupName, optionName: m.optionName, priceDelta: m.priceDelta })),
            },
          },
        });
      }
      await tx.payment.deleteMany({ where: { orderId: doc.id } });
      for (const p of doc.payments) {
        const o = options.find((x) => x.code === p.optionCode)!;
        const cash = o.method === 'CASH';
        await tx.payment.create({
          data: {
            id: p.id,
            branchId,
            orderId: doc.id,
            shiftId: doc.shiftId ?? null,
            method: o.method,
            provider: o.provider,
            paymentOptionId: o.id,
            status: 'SUCCEEDED',
            amount: p.amount,
            tenderedAmount: cash ? (p.tendered ?? p.amount) : null,
            changeAmount: cash ? Math.max(0, (p.tendered ?? p.amount) - p.amount) : null,
            reference: p.reference?.trim() || null,
            receivedById: cashier.id,
            createdAt: new Date(p.at),
            paidAt: new Date(p.at),
          },
        });
      }
    }

    // --- Stok & log
    const sold: SoldItem[] = valid.filter((l) => !l.it.voided).map((l) => ({ productId: l.it.productId, quantity: l.it.quantity, optionIds: l.mods.map((m) => m.optionId) }));
    const becamePaid = !wasPaid && doc.status === 'PAID';
    const voidedAfterPaid = wasPaid && doc.status === 'VOIDED';
    if (becamePaid) await this.stock.applyOrder(tx, { branchId, orderId: doc.id, items: sold, sign: -1, actorId: cashier.id, at: new Date(doc.paidAt!) });
    if (voidedAfterPaid) {
      const paidItems = await tx.orderItem.findMany({ where: { orderId: doc.id, voidedAt: null }, select: { productId: true, quantity: true, modifiers: { select: { modifierOptionId: true } } } });
      await this.stock.applyOrder(tx, {
        branchId, orderId: doc.id, sign: 1, actorId: voidedById, at: now,
        items: paidItems.map((i) => ({ productId: i.productId, quantity: i.quantity, optionIds: i.modifiers.map((m) => m.modifierOptionId) })),
      });
    }

    const mismatched = valid.filter((l) => l.it.unitPrice !== l.expected);
    if (mismatched.length && canEditLines) {
      await this.audit.log({
        action: 'order.price_mismatch', entity: 'Order', entityId: doc.id, branchId, actorId: cashier.id,
        detail: { number: doc.number, lines: mismatched.map((l) => ({ name: l.p.menu.name, device: l.it.unitPrice, server: l.expected })) },
      }, tx);
    }
    if (doc.status === 'VOIDED' && existing?.status !== 'VOIDED') {
      await this.audit.log({ action: 'order.void', entity: 'Order', entityId: doc.id, branchId, actorId: voidedById, detail: { number: doc.number, total: totals.total, reason: doc.voidReason ?? null, paid: wasPaid || doc.payments.length > 0 } }, tx);
    }
    if (discountApprovedById && discountApprovedById !== cashier.id) {
      await this.audit.log({ action: 'discount.approve', entity: 'Order', entityId: doc.id, branchId, actorId: discountApprovedById, detail: { number: doc.number, discount: totals.discount } }, tx);
    }
    return { id: doc.id, status: 'saved' };
  }

  /** Staf dengan hak & cabang (tanpa melempar). */
  private async staff(tx: Tx, id: string): Promise<StaffCtx | null> {
    const u = await tx.user.findUnique({ where: { id }, include: { role: true, branches: { select: { branchId: true } } } });
    if (!u || !u.isActive) return null;
    return { id: u.id, name: u.name, role: u.role.code, permissions: u.role.permissions, branchIds: u.role.code === 'SUPER_ADMIN' ? null : u.branches.map((b) => b.branchId) };
  }

  /**
   * Penyetuju untuk tindakan berisiko. Hanya token dari POST /pos/approve (PIN diperiksa server) yang diterima.
   * Persetujuan offline (hanya ID penyetuju, PIN diperiksa di perangkat) DITOLAK: hash PIN penyetuju tidak lagi
   * dikirim ke perangkat, sehingga kasir tidak bisa menebak PIN manajer secara offline lalu menyetujui sendiri.
   * - Token boleh terkirim terlambat (perangkat sempat offline setelah persetujuan): tanda tangan wajib sah,
   *   kedaluwarsa ditoleransi APPROVAL_GRACE_S, dan satu token hanya untuk satu pesanan.
   * - Tanpa token: null (pemanggil lalu memeriksa apakah staf yang login sendiri berhak menyetujui).
   */
  private async approver(
    tx: Tx, branchId: string, device: DeviceCtx, perm: string,
    token: string | undefined, approverId: string | undefined, cashierId: string, orderId: string, what: string,
  ): Promise<string | null> {
    if (token) {
      const p = verify<{ sub: string; perm: string; dev: string }>(token, APPROVAL_GRACE_S);
      if (!p || p.perm !== perm || p.dev !== device.id) throw new Reject(['Persetujuan manajer tidak sah atau kedaluwarsa']);
      const s = await this.staff(tx, p.sub);
      if (!s || !can(s, perm) || !canBranch(s, branchId)) throw new Reject(['Penyetuju tidak berhak']);
      // Satu token = satu pesanan (boleh dikirim ulang untuk versi berikut pesanan yang sama).
      const key = sha256(token);
      const used = await tx.auditLog.findFirst({ where: { entity: 'ApprovalToken', entityId: key }, select: { detail: true } });
      const usedFor = (used?.detail as { orderId?: string } | null)?.orderId;
      if (used && usedFor !== orderId) throw new Reject(['Persetujuan manajer ini sudah dipakai untuk transaksi lain']);
      if (!used) {
        await this.audit.log({ action: 'approval.token', entity: 'ApprovalToken', entityId: key, branchId, actorId: s.id, detail: { orderId, what, permission: perm, deviceId: device.id } }, tx);
      }
      return p.sub;
    }
    if (approverId && approverId !== cashierId) {
      throw new Reject(['Persetujuan manajer offline tidak diterima. Minta persetujuan PIN manajer saat perangkat online.']);
    }
    return null;
  }

  /** Menu untuk validasi: harga cabang + grup opsi (bentuk sama dengan @robucca/core). */
  private async products(tx: Tx, ids: string[], branchId: string) {
    const rows = await tx.product.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true, name: true, basePrice: true, station: true,
        category: { select: { station: true } },
        branchSettings: { where: { branchId }, select: { priceOverride: true } },
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          select: {
            showWhenOptionIds: true,
            group: {
              select: {
                id: true, name: true, selection: true, isRequired: true, maxSelect: true,
                options: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, priceDelta: true, isDefault: true, imageUrl: true } },
              },
            },
          },
        },
      },
    });
    return new Map(
      rows.map((r) => {
        const menu: MenuProduct = {
          id: r.id,
          name: r.name,
          price: r.branchSettings[0]?.priceOverride ?? r.basePrice,
          modifierGroups: r.modifierGroups.map((g) => ({ ...g.group, showWhenOptionIds: g.showWhenOptionIds })),
        };
        return [r.id, { menu, station: r.station ?? r.category.station }] as const;
      }),
    );
  }
}
