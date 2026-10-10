/* Pesanan dari PWA pelanggan (Click & Collect, Delivery, pre-order reservasi).
   Server tidak percaya PWA:
   - menu, opsi, dan pilihan wajib divalidasi dengan @robucca/core (selectionErrors);
   - harga satuan dihitung ulang dari harga cabang + opsi; harga/total dari PWA yang beda → ditolak;
   - total dihitung ulang dengan core.calcOrder memakai konfigurasi pajak cabang;
   - ongkir dihitung ulang dari jarak toko → alamat dan tarif kurir;
   - pembayaran online (QRIS/e-wallet) TIDAK bisa ditandai lunas oleh pelanggan: pesanan tetap OPEN
     dengan pembayaran PENDING sampai kasir mengonfirmasinya di POS (sinkron pesanan + pembayaran).
   Nomor struk memakai format POS (core.receiptNo) dengan terminal 0 = pesanan online, antrean "A001". */
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  businessDate, calcOrder, chosenModifiers, deliveryEtaMinutes, deliveryFee, distanceKm, receiptNo, selectionErrors, unitPrice, uuidv7,
  type MenuProduct, type Selection,
} from '@robucca/core';
import { Prisma } from '@robucca/db';
import { concat, concatMap, defer, filter, from, map, type Observable, of, switchMap } from 'rxjs';
import { RateLimiter } from '../../common/rate-limit';
import { SERVER_VERSION_STEP } from '../../common/versions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService, type SseMessage } from '../events/events.service';
import { CatalogService, ONLINE_METHODS } from './catalog.service';
import { type CustomerCtx, hit, orderToken, phoneOrThrow, reservationTokenValid } from './customer-auth';
import type { CreateOrderDto } from './public.dto';

export const PWA_TERMINAL = 0;
export const PREP_MINUTES = 15;

type Tx = Prisma.TransactionClient;

class Reject extends Error {
  constructor(readonly status: 400 | 409 | 422, message: string) {
    super(message);
  }
}

const throwReject = (e: Reject): never => {
  if (e.status === 409) throw new ConflictException(e.message);
  if (e.status === 422) throw new UnprocessableEntityException(e.message);
  throw new BadRequestException(e.message);
};

export const PUBLIC_ORDER_SELECT = {
  id: true, branchId: true, number: true, queueNumber: true, type: true, status: true, fulfillment: true, customerId: true,
  customerName: true, customerPhone: true, pickupAt: true, note: true, createdAt: true, paidAt: true, readyAt: true, completedAt: true, version: true,
  subtotal: true, discountTotal: true, serviceCharge: true, taxTotal: true, deliveryFee: true, rounding: true, total: true, taxInclusive: true, taxRateBp: true,
  branch: { select: { code: true, name: true, taxLabel: true } },
  reservation: { select: { id: true, code: true, reservedFor: true } },
  items: {
    where: { voidedAt: null },
    select: {
      id: true, productId: true, productName: true, quantity: true, unitPrice: true, lineTotal: true, note: true,
      product: { select: { imageUrl: true } },
      modifiers: {
        select: {
          modifierOptionId: true,
          optionName: true,
          modifierOption: { select: { isDefault: true, imageUrl: true, group: { select: { isRequired: true, selection: true } } } },
        },
      },
    },
  },
  payments: { select: { status: true, amount: true, provider: true, method: true, option: { select: { code: true, name: true } } } },
  delivery: {
    select: {
      status: true, recipientName: true, recipientPhone: true, addressText: true, addressNote: true, latitude: true, longitude: true, distanceKm: true, fee: true,
      driverName: true, driverPhone: true, vehiclePlate: true, trackingUrl: true, estimatedAt: true,
      courier: { select: { code: true, name: true, provider: true } },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof PUBLIC_ORDER_SELECT }>;

export type OrderStage = 'awaiting_payment' | 'scheduled' | 'received' | 'preparing' | 'ready' | 'on_delivery' | 'completed' | 'cancelled';

/** Bentuk pesanan untuk pelanggan (tanpa data kasir/perangkat). */
export function toPublic(o: OrderRow) {
  const succeeded = o.payments.filter((p) => p.status === 'SUCCEEDED');
  const pending = o.payments.find((p) => p.status === 'PENDING');
  const paid = o.status === 'PAID' || o.status === 'REFUNDED';
  const chosen = pending?.option ?? succeeded[0]?.option ?? null;
  const online = !!pending || (!!chosen && chosen.code !== 'cash');
  const payment = {
    code: pending?.option?.code ?? (paid ? (succeeded[0]?.option?.code ?? null) : 'cashier'),
    name: chosen?.name ?? (paid ? 'Lunas' : 'Bayar di kasir'),
    online,
    state: paid ? 'paid' : pending ? 'pending' : o.status === 'VOIDED' ? 'void' : 'cashier',
  } as const;
  let stage: OrderStage;
  if (o.status === 'VOIDED' || o.status === 'REFUNDED' || o.fulfillment === 'CANCELLED') stage = 'cancelled';
  else if (payment.state === 'pending') stage = 'awaiting_payment';
  else if (o.fulfillment === 'COMPLETED') stage = 'completed';
  else if (o.fulfillment === 'OUT_FOR_DELIVERY') stage = 'on_delivery';
  else if (o.fulfillment === 'READY') stage = 'ready';
  else if (o.fulfillment === 'PREPARING') stage = 'preparing';
  else if (o.pickupAt && o.pickupAt.getTime() - PREP_MINUTES * 60_000 > Date.now()) stage = 'scheduled';
  else stage = 'received';
  const d = o.delivery;
  return {
    id: o.id,
    number: o.number,
    queueNumber: o.queueNumber,
    branch: { code: o.branch.code, name: o.branch.name },
    type: o.type,
    status: o.status,
    fulfillment: o.fulfillment,
    stage,
    payment,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    pickupAt: o.pickupAt,
    note: o.note,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    readyAt: o.readyAt,
    completedAt: o.completedAt,
    version: o.version,
    items: o.items.map((i) => ({
      id: i.id,
      /** Untuk "Pesan lagi": menu & opsi yang sama dimasukkan lagi ke keranjang (harga mengikuti menu terbaru). */
      productId: i.productId,
      optionIds: i.modifiers.map((m) => m.modifierOptionId),
      name: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      note: i.note,
      imageUrl: i.modifiers.find((m) => m.modifierOption.imageUrl)?.modifierOption.imageUrl ?? i.product.imageUrl,
      summary: i.modifiers
        .filter((m) => m.modifierOption.group.isRequired || m.modifierOption.group.selection === 'MULTIPLE' || !m.modifierOption.isDefault)
        .map((m) => (m.modifierOption.group.selection === 'MULTIPLE' ? `+ ${m.optionName}` : m.optionName))
        .join(' · '),
    })),
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    serviceCharge: o.serviceCharge,
    taxTotal: o.taxTotal,
    taxLabel: o.branch.taxLabel,
    taxInclusive: o.taxInclusive,
    deliveryFee: o.deliveryFee,
    rounding: o.rounding,
    total: o.total,
    reservation: o.reservation,
    delivery: d
      ? {
          status: d.status, courierCode: d.courier.code, courierName: d.courier.name, provider: d.courier.provider,
          recipientName: d.recipientName, recipientPhone: d.recipientPhone, addressText: d.addressText, addressNote: d.addressNote,
          lat: d.latitude.toNumber(), lng: d.longitude.toNumber(), distanceKm: d.distanceKm.toNumber(), fee: d.fee,
          driverName: d.driverName, driverPhone: d.driverPhone, vehiclePlate: d.vehiclePlate, trackingUrl: d.trackingUrl, estimatedAt: d.estimatedAt,
        }
      : null,
  };
}
export type PublicOrder = ReturnType<typeof toPublic>;

@Injectable()
export class PublicOrdersService {
  /** Pesanan baru: 20 per IP & 10 per nomor dalam 10 menit. */
  private readonly perIp = new RateLimiter(Number(process.env.PUBLIC_ORDER_IP_LIMIT) || 20, 10 * 60_000, 10 * 60_000);
  private readonly perPhone = new RateLimiter(10, 10 * 60_000, 10 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async get(id: string): Promise<PublicOrder> {
    const o = await this.prisma.db.order.findUnique({ where: { id }, select: PUBLIC_ORDER_SELECT });
    if (!o) throw new NotFoundException('Pesanan tidak ditemukan');
    return toPublic(o);
  }

  /** Pemilik pesanan: pelanggan yang login & tercatat di pesanan. */
  async ownedBy(id: string, customerId: string): Promise<boolean> {
    const o = await this.prisma.db.order.findUnique({ where: { id }, select: { customerId: true } });
    return !!o && o.customerId === customerId;
  }

  async mine(customer: CustomerCtx) {
    const rows = await this.prisma.db.order.findMany({
      where: { OR: [{ customerId: customer.id }, { customerPhone: customer.phone, source: 'PWA' }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: PUBLIC_ORDER_SELECT,
    });
    return rows.map((o) => ({ ...toPublic(o), accessToken: orderToken(o.id) }));
  }

  async lookup(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.db.order.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'desc' }, select: PUBLIC_ORDER_SELECT });
    return rows.map(toPublic);
  }

  /** Pelanggan menandai pesanan sudah diambil/diterima (hanya setelah siap / diantar). */
  async received(id: string): Promise<PublicOrder> {
    const o = await this.prisma.db.order.findUnique({ where: { id }, select: { branchId: true, fulfillment: true, status: true } });
    if (!o) throw new NotFoundException('Pesanan tidak ditemukan');
    if (o.fulfillment === 'COMPLETED') return this.get(id);
    if (o.fulfillment !== 'READY' && o.fulfillment !== 'OUT_FOR_DELIVERY') throw new ConflictException('Pesanan belum siap');
    await this.prisma.db.order.update({ where: { id }, data: { fulfillment: 'COMPLETED', completedAt: new Date() } });
    this.events.emit({ branchId: o.branchId, type: 'order', data: { id } });
    return this.get(id);
  }

  /** Pelanggan batal bayar online lalu bayar di kasir (prototipe lama: "Bayar di kasir saja").
      Hanya selama pembayaran online belum dikonfirmasi kasir; delivery tetap wajib bayar online.
      Pesanan biasa langsung masuk dapur (sama seperti memilih bayar di kasir sejak awal); pre-order reservasi tetap
      menunggu jam reservasi. Versi naik SERVER_VERSION_STEP → salinan lama di POS tidak bisa menimpa diam-diam. */
  async payAtCashier(id: string): Promise<PublicOrder> {
    const o = await this.prisma.db.order.findUnique({
      where: { id },
      select: { branchId: true, number: true, status: true, type: true, reservationId: true, payments: { select: { status: true } } },
    });
    if (!o) throw new NotFoundException('Pesanan tidak ditemukan');
    const pending = o.payments.some((p) => p.status === 'PENDING');
    if (o.status === 'OPEN' && !pending && !o.payments.some((p) => p.status === 'SUCCEEDED')) return this.get(id); // sudah bayar di kasir
    if (o.type === 'DELIVERY') throw new ConflictException('Delivery dibayar online (QRIS / e-wallet)');
    if (o.status !== 'OPEN' || !pending) throw new ConflictException('Pembayaran pesanan ini sudah diproses kasir');
    const now = new Date();
    await this.withRetry(async (tx) => {
      // Bersyarat: kasir bisa mengonfirmasi pembayaran online pada saat yang sama.
      const cur = await tx.order.findUnique({ where: { id }, select: { status: true, note: true } });
      const failed = await tx.payment.updateMany({ where: { orderId: id, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (!cur || cur.status !== 'OPEN' || !failed.count) throw new ConflictException('Pembayaran pesanan ini sudah diproses kasir');
      // Segmen pertama catatan selalu metode bayar (lihat createChecked); catatan pelanggan tetap utuh.
      const rest = (cur.note ?? '').split(' · ').filter(Boolean);
      if (rest[0]?.startsWith('Bayar ')) rest.shift();
      await tx.order.update({
        where: { id },
        data: { note: ['Bayar di kasir (pelanggan batal bayar online)', ...rest].join(' · ').slice(0, 300), version: { increment: SERVER_VERSION_STEP } },
      });
      if (!o.reservationId) await tx.orderItem.updateMany({ where: { orderId: id, sentToKitchenAt: null, voidedAt: null }, data: { sentToKitchenAt: now } });
      await this.audit.log({ action: 'pwa.order.pay_at_cashier', entity: 'Order', entityId: id, branchId: o.branchId, actorId: null, detail: { number: o.number } }, tx);
    });
    this.events.emit({ branchId: o.branchId, type: 'feed', data: { at: Date.now() } });
    this.events.emit({ branchId: o.branchId, type: 'order', data: { id } });
    return this.get(id);
  }

  /** Status real-time satu pesanan (SSE): status awal, lalu setiap ada perubahan pesanan di cabangnya. */
  stream(id: string): Observable<SseMessage> {
    let last = '';
    const status = (): Observable<SseMessage> =>
      from(this.get(id)).pipe(map((o) => ({ type: 'status', data: JSON.stringify(o) })));
    return defer(() => from(this.prisma.db.order.findUnique({ where: { id }, select: { branchId: true } }))).pipe(
      switchMap((o) => {
        if (!o) throw new NotFoundException('Pesanan tidak ditemukan');
        const changes = this.events.stream(o.branchId, (e) => e.type === 'feed' || (e.type === 'order' && e.data.id === id));
        return concat(of<SseMessage | null>(null), changes);
      }),
      concatMap((m) => (m && m.type === 'ping' ? of(m) : status())),
      filter((m) => {
        if (m.type !== 'status') return true;
        if (m.data === last) return false;
        last = m.data;
        return true;
      }),
    );
  }

  async create(dto: CreateOrderDto, customer: CustomerCtx | null, ip: string): Promise<{ order: PublicOrder; accessToken: string }> {
    const phone = phoneOrThrow(dto.phone);
    hit(this.perIp, ip);
    hit(this.perPhone, phone);

    // Kirim ulang pesanan yang sama (mis. koneksi putus): kembalikan pesanan yang sudah ada.
    if (dto.id) {
      const prev = await this.prisma.db.order.findUnique({ where: { id: dto.id }, select: { id: true, customerPhone: true, source: true } });
      if (prev) {
        if (prev.source !== 'PWA' || prev.customerPhone !== phone) throw new ConflictException('ID pesanan sudah dipakai');
        return { order: await this.get(prev.id), accessToken: orderToken(prev.id) };
      }
    }

    try {
      return await this.createChecked(dto, customer, phone);
    } catch (e) {
      if (e instanceof Reject) return throwReject(e);
      throw e;
    }
  }

  private async createChecked(dto: CreateOrderDto, customer: CustomerCtx | null, phone: string) {
    const branch = await this.catalog.branchRow(dto.branchCode);
    if (!branch.acceptsPwa) throw new Reject(400, `${branch.name} belum menerima pesanan online`);
    const cfg = await this.catalog.taxConfig(branch);
    const now = new Date();

    // --- Pembayaran: online dikonfirmasi kasir, atau bayar di kasir.
    let paymentOption: Awaited<ReturnType<PrismaService['db']['paymentOption']['findUnique']>> = null;
    if (dto.payment !== 'cashier') {
      const po = await this.prisma.db.paymentOption.findUnique({ where: { code: dto.payment } });
      if (!po || !po.isActive || !(ONLINE_METHODS as readonly string[]).includes(po.method)) throw new Reject(400, 'Metode pembayaran tidak tersedia');
      paymentOption = po;
    }

    // --- Pre-order reservasi
    let reservation: { id: string; reservedFor: Date; code: string } | null = null;
    if (dto.reservationId) {
      const r = await this.prisma.db.reservation.findUnique({ where: { id: dto.reservationId } });
      // Milik pelanggan yang masuk (akun, atau dibuat sebagai tamu dengan nomornya), atau tamu dengan token reservasi.
      const owner = !!r && !!customer && (r.customerId === customer.id || (r.customerId === null && r.phone === customer.phone));
      if (!r || !(owner || reservationTokenValid(dto.reservationToken, r.id)) || r.branchId !== branch.id) throw new Reject(400, 'Reservasi tidak ditemukan');
      if (r.status !== 'PENDING' && r.status !== 'CONFIRMED') throw new Reject(409, 'Reservasi sudah dibatalkan atau selesai');
      const dup = await this.prisma.db.order.count({ where: { reservationId: r.id, status: { notIn: ['VOIDED', 'REFUNDED'] } } });
      if (dup) throw new Reject(409, 'Reservasi ini sudah punya pre-order');
      reservation = { id: r.id, reservedFor: r.reservedFor, code: r.code };
      if (dto.type !== 'CLICK_COLLECT') throw new Reject(400, 'Pre-order reservasi tidak bisa diantar');
    }

    // --- Waktu ambil
    let pickupAt: Date | null = reservation ? reservation.reservedFor : null;
    if (!reservation && dto.type === 'CLICK_COLLECT' && dto.pickupAt) {
      pickupAt = new Date(dto.pickupAt);
      const t = pickupAt.getTime();
      if (t < now.getTime() - 5 * 60_000 || t > now.getTime() + 2 * 24 * 3600e3) throw new Reject(400, 'Waktu ambil tidak valid');
    }
    if (dto.type === 'DELIVERY' && dto.pickupAt) throw new Reject(400, 'Delivery dikirim secepatnya');

    // --- Menu & opsi
    const products = await this.products(dto.items.map((i) => i.productId), branch.id);
    const lines = dto.items.map((it, n) => {
      const p = products.get(it.productId);
      if (!p) throw new Reject(400, `Baris ${n + 1}: menu tidak tersedia`);
      if (!p.available) throw new Reject(409, `${p.menu.name} sedang habis`);
      const unknown = it.optionIds.filter((id) => !p.menu.modifierGroups.some((g) => g.options.some((o) => o.id === id)));
      if (unknown.length) throw new Reject(400, `${p.menu.name}: pilihan tidak cocok dengan menu`);
      const sel: Selection = {};
      for (const g of p.menu.modifierGroups) sel[g.id] = it.optionIds.filter((id) => g.options.some((o) => o.id === id));
      const errs = selectionErrors(p.menu, sel);
      if (errs.length) throw new Reject(400, `${p.menu.name}: ${errs.join(', ')}`);
      const price = unitPrice(p.menu, sel);
      if (it.unitPrice != null && it.unitPrice !== price) throw new Reject(409, `Harga ${p.menu.name} sudah berubah. Muat ulang menu.`);
      return { it, p, mods: chosenModifiers(p.menu, sel), price, id: uuidv7() };
    });

    // --- Delivery: jarak & ongkir dihitung server
    let delivery: { courierId: string; courierName: string; km: number; fee: number; eta: number } | null = null;
    if (dto.type === 'DELIVERY') {
      if (!dto.delivery) throw new Reject(400, 'Alamat pengiriman wajib diisi');
      if (!branch.acceptsDelivery || branch.latitude == null || branch.longitude == null) throw new Reject(400, `${branch.name} belum melayani delivery`);
      if (!paymentOption) throw new Reject(400, 'Delivery dibayar online (QRIS / e-wallet)');
      const courier = await this.prisma.db.courierService.findUnique({ where: { code: dto.delivery.courierCode } });
      if (!courier || !courier.isActive) throw new Reject(400, 'Kurir tidak tersedia');
      const km = distanceKm({ lat: branch.latitude.toNumber(), lng: branch.longitude.toNumber() }, { lat: dto.delivery.lat, lng: dto.delivery.lng });
      const max = branch.deliveryMaxKm?.toNumber() ?? null;
      if (max != null && km > max) throw new Reject(422, `Di luar jangkauan pengiriman (±${km} km, maks. ${max} km)`);
      delivery = { courierId: courier.id, courierName: courier.name, km, fee: deliveryFee(courier, km), eta: deliveryEtaMinutes(km, PREP_MINUTES) };
    }

    const { totals, amounts } = calcOrder({ lines: lines.map((l) => ({ id: l.id, unitPrice: l.price, quantity: l.it.quantity })), deliveryFee: delivery?.fee ?? 0 }, cfg);
    if (dto.expectedTotal != null && dto.expectedTotal !== totals.total) throw new Reject(409, 'Total pesanan berubah. Periksa keranjang lalu pesan lagi.');

    const notes = [
      paymentOption ? `Bayar ${paymentOption.name} — menunggu konfirmasi kasir` : 'Bayar di kasir',
      dto.cutlery ? 'Perlu alat makan' : null,
      reservation ? `Pre-order reservasi ${reservation.code}` : null,
      dto.note || null,
    ].filter(Boolean);
    const online = !!paymentOption;
    const createdAt = now;
    const bd = businessDate(createdAt.getTime(), branch.timezone, branch.dayStartMinute);
    const type = reservation ? 'DINE_IN' : dto.type;
    const id = dto.id ?? uuidv7();
    // Tiket dapur langsung untuk bayar di kasir (seperti prototipe lama); pembayaran online menunggu konfirmasi kasir,
    // pre-order menunggu jam reservasi (dikirim ke dapur dari POS).
    const sendToKitchen = !online && !reservation ? createdAt : null;
    const amountById = new Map(amounts.map((a) => [a.id, a]));

    const order = await this.withRetry(async (tx) => {
      const seq = (await tx.order.count({ where: { branchId: branch.id, source: 'PWA', businessDate: new Date(`${bd}T00:00:00Z`) } })) + 1;
      const o = await tx.order.create({
        data: {
          id,
          branchId: branch.id,
          number: receiptNo(branch.code, PWA_TERMINAL, bd, seq),
          queueNumber: `A${String(seq % 1000).padStart(3, '0')}`,
          source: 'PWA',
          type,
          status: 'OPEN',
          fulfillment: 'RECEIVED',
          customerName: dto.name,
          customerId: customer?.id ?? null,
          customerPhone: phone,
          businessDate: new Date(`${bd}T00:00:00Z`),
          pickupAt,
          note: notes.join(' · ').slice(0, 300),
          reservationId: reservation?.id ?? null,
          subtotal: totals.gross,
          discountTotal: totals.discount,
          serviceCharge: totals.service,
          taxTotal: totals.tax,
          deliveryFee: totals.deliveryFee,
          rounding: totals.rounding,
          total: totals.total,
          taxRateBp: cfg.taxRateBp,
          taxInclusive: cfg.taxInclusive,
          serviceRateBp: cfg.serviceRateBp,
          taxOnService: cfg.taxOnService,
          roundingUnit: cfg.roundingUnit,
          roundingMode: cfg.roundingMode,
          createdAt,
          version: 1,
        },
        select: { id: true, number: true },
      });
      for (const l of lines) {
        await tx.orderItem.create({
          data: {
            id: l.id,
            orderId: id,
            productId: l.it.productId,
            productName: l.p.menu.name,
            quantity: l.it.quantity,
            unitPrice: l.price,
            discountAmount: amountById.get(l.id)?.discount ?? 0,
            lineTotal: amountById.get(l.id)?.amount ?? l.price * l.it.quantity,
            note: l.it.note || null,
            station: l.p.station,
            sentToKitchenAt: sendToKitchen,
            modifiers: { create: l.mods.map((m) => ({ modifierOptionId: m.optionId, groupName: m.groupName, optionName: m.optionName, priceDelta: m.priceDelta })) },
          },
        });
      }
      if (paymentOption) {
        await tx.payment.create({
          data: {
            branchId: branch.id, orderId: id, method: paymentOption.method, provider: paymentOption.provider, paymentOptionId: paymentOption.id,
            status: 'PENDING', amount: totals.total, createdAt,
          },
        });
      }
      if (delivery && dto.delivery) {
        await tx.delivery.create({
          data: {
            branchId: branch.id, orderId: id, courierServiceId: delivery.courierId, recipientName: dto.name, recipientPhone: phone,
            addressText: dto.delivery.addressText, addressNote: dto.delivery.addressNote || null,
            latitude: new Prisma.Decimal(dto.delivery.lat.toFixed(6)), longitude: new Prisma.Decimal(dto.delivery.lng.toFixed(6)),
            distanceKm: new Prisma.Decimal(delivery.km), fee: delivery.fee, estimatedAt: new Date(createdAt.getTime() + delivery.eta * 60_000),
          },
        });
      }
      await this.audit.log({
        action: 'pwa.order.create', entity: 'Order', entityId: id, branchId: branch.id, actorId: null,
        detail: { number: o.number, total: totals.total, payment: paymentOption?.code ?? 'cashier', type, customerId: customer?.id ?? null },
      }, tx);
      return o;
    });

    if (customer && dto.delivery?.saveAddress && delivery) {
      const count = await this.prisma.db.customerAddress.count({ where: { customerId: customer.id } });
      const same = await this.prisma.db.customerAddress.findFirst({ where: { customerId: customer.id, addressText: dto.delivery.addressText } });
      if (!same && count < 20) {
        await this.prisma.db.customerAddress.create({
          data: {
            customerId: customer.id, addressText: dto.delivery.addressText, addressNote: dto.delivery.addressNote || null,
            latitude: new Prisma.Decimal(dto.delivery.lat.toFixed(6)), longitude: new Prisma.Decimal(dto.delivery.lng.toFixed(6)),
            recipientName: dto.name, recipientPhone: phone, isDefault: count === 0,
          },
        });
      }
    }
    if (customer && !customer.name) await this.prisma.db.customer.update({ where: { id: customer.id }, data: { name: dto.name } });

    // POS (feed tagihan terbuka) & layar dapur langsung melihat pesanan baru.
    this.events.emit({ branchId: branch.id, type: 'feed', data: { at: Date.now() } });
    this.events.emit({ branchId: branch.id, type: 'order', data: { id: order.id } });
    return { order: await this.get(order.id), accessToken: orderToken(order.id) };
  }

  /** Transaksi serializable; nomor urut bentrok (pesanan bersamaan) → ulangi. */
  private async withRetry<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15_000 });
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : '';
        if ((code === 'P2034' || code === 'P2002') && attempt < 5) continue;
        throw e;
      }
    }
  }

  /** Menu aktif cabang untuk validasi (bentuk @robucca/core). Opsi nonaktif dianggap tidak dikenal. */
  private async products(ids: string[], branchId: string) {
    const rows = await this.prisma.db.product.findMany({
      where: { id: { in: [...new Set(ids)] }, isActive: true, category: { isActive: true } },
      select: {
        id: true, name: true, basePrice: true, station: true, imageUrl: true,
        category: { select: { station: true } },
        branchSettings: { where: { branchId }, select: { priceOverride: true, isAvailable: true } },
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          where: { group: { isActive: true } },
          select: {
            showWhenOptionIds: true,
            group: {
              select: {
                id: true, name: true, selection: true, isRequired: true, maxSelect: true,
                options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, priceDelta: true, isDefault: true, imageUrl: true } },
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
          imageUrl: r.imageUrl,
          modifierGroups: r.modifierGroups.map((g) => ({ ...g.group, showWhenOptionIds: g.showWhenOptionIds })),
        };
        return [r.id, { menu, station: r.station ?? r.category.station, available: r.branchSettings[0]?.isAvailable ?? true }] as const;
      }),
    );
  }
}
