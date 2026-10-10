/* Data milik pelanggan yang login: reservasi meja (+ pre-order) dan alamat delivery tersimpan. */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randCode, zonedEpoch } from '@robucca/core';
import { Prisma } from '@robucca/db';
import { RateLimiter } from '../../common/rate-limit';
import { SERVER_VERSION_STEP } from '../../common/versions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { CatalogService } from './catalog.service';
import { type CustomerCtx, hit, phoneOrThrow, reservationToken } from './customer-auth';
import type { AddressDto, ReservationDto } from './public.dto';

/** Reservasi bisa dibuat mulai 60 menit dari sekarang, paling jauh 30 hari ke depan. */
export const RSV_MIN_LEAD_MS = 60 * 60_000;
export const RSV_MAX_AHEAD_MS = 30 * 24 * 3600e3;
/** Jam kedatangan terakhir = jam tutup − 90 menit (prototipe lama: 08.00–19.30 untuk toko 08.00–21.00). */
export const RSV_LAST_BEFORE_CLOSE_MIN = 90;
const toMin = (s: string): number => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const RSV_SELECT = {
  id: true, code: true, name: true, phone: true, reservedFor: true, guests: true, area: true, occasion: true, note: true, status: true, createdAt: true,
  branch: { select: { code: true, name: true, address: true, timezone: true } },
  preOrders: { where: { status: { notIn: ['VOIDED', 'REFUNDED'] } }, select: { id: true, number: true, total: true, status: true } },
} satisfies Prisma.ReservationSelect;

const ADDRESS_SELECT = {
  id: true, label: true, addressText: true, addressNote: true, latitude: true, longitude: true, recipientName: true, recipientPhone: true, isDefault: true, updatedAt: true,
} satisfies Prisma.CustomerAddressSelect;

const addressOut = (a: Prisma.CustomerAddressGetPayload<{ select: typeof ADDRESS_SELECT }>) => ({
  ...a, latitude: undefined, longitude: undefined, lat: a.latitude.toNumber(), lng: a.longitude.toNumber(),
});

@Injectable()
export class CustomerService {
  /** Tulis data pelanggan: 30 per pelanggan per 10 menit. */
  private readonly writes = new RateLimiter(30, 10 * 60_000, 10 * 60_000);
  /** Reservasi baru: 5 per akun / nomor tamu per jam, dan per IP (tamu tanpa akun). */
  private readonly rsvLimit = new RateLimiter(5, 3600e3, 3600e3);
  private readonly rsvIp = new RateLimiter(Number(process.env.PUBLIC_RSV_IP_LIMIT) || 10, 3600e3, 3600e3);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  me(c: CustomerCtx) {
    return this.prisma.db.customer.findUniqueOrThrow({ where: { id: c.id }, select: { id: true, phone: true, name: true, pointsBalance: true, phoneVerifiedAt: true } });
  }

  updateProfile(c: CustomerCtx, name: string) {
    hit(this.writes, c.id);
    return this.prisma.db.customer.update({ where: { id: c.id }, data: { name }, select: { id: true, phone: true, name: true, pointsBalance: true } });
  }

  // --- Reservasi ---------------------------------------------------------------

  /** Milik pelanggan: dibuat dengan akunnya, atau sebagai tamu dengan nomor WhatsApp yang sama (nomor sudah terverifikasi OTP). */
  private ownerWhere(c: CustomerCtx): Prisma.ReservationWhereInput {
    return { OR: [{ customerId: c.id }, { customerId: null, phone: c.phone }] };
  }

  async reservations(c: CustomerCtx) {
    const rows = await this.prisma.db.reservation.findMany({ where: this.ownerWhere(c), orderBy: { reservedFor: 'desc' }, take: 50, select: RSV_SELECT });
    return rows.map((r) => ({ ...r, accessToken: reservationToken(r.id) }));
  }

  async ownsReservation(id: string, c: CustomerCtx): Promise<boolean> {
    return (await this.prisma.db.reservation.count({ where: { id, ...this.ownerWhere(c) } })) > 0;
  }

  /** Satu reservasi (hak akses sudah diperiksa guard: token reservasi atau pemiliknya). */
  async reservation(id: string) {
    const r = await this.prisma.db.reservation.findUnique({ where: { id }, select: RSV_SELECT });
    if (!r) throw new NotFoundException('Reservasi tidak ditemukan');
    return r;
  }

  /** Beberapa reservasi sekaligus (riwayat di perangkat tamu); token sudah diperiksa pemanggil. */
  async lookupReservations(ids: string[]) {
    if (!ids.length) return [];
    return this.prisma.db.reservation.findMany({ where: { id: { in: ids } }, orderBy: { reservedFor: 'desc' }, select: RSV_SELECT });
  }

  /** Reservasi baru. Tamu boleh (masuk dengan WhatsApp bisa tidak tersedia); hasilnya membawa token akses reservasi. */
  async createReservation(c: CustomerCtx | null, dto: ReservationDto, ip: string) {
    const phone = phoneOrThrow(dto.phone);
    hit(this.rsvIp, ip);
    hit(this.rsvLimit, c?.id ?? phone);
    const b = await this.catalog.branchRow(dto.branchCode);
    if (!b.acceptsReservations) throw new BadRequestException(`${b.name} belum menerima reservasi online`);
    if (dto.guests > b.maxReservationGuests) throw new BadRequestException(`Maksimal ${b.maxReservationGuests} orang per reservasi`);
    const area = dto.area || null;
    if (area && area !== 'Bebas' && b.reservationAreas.length && !b.reservationAreas.includes(area)) throw new BadRequestException('Area tidak tersedia');
    const at = zonedEpoch(dto.date, dto.time, b.timezone);
    if (Number.isNaN(at)) throw new BadRequestException('Tanggal/jam tidak valid');
    if (at < Date.now() + RSV_MIN_LEAD_MS - 60_000) throw new BadRequestException('Reservasi paling cepat 1 jam dari sekarang');
    if (at > Date.now() + RSV_MAX_AHEAD_MS) throw new BadRequestException('Reservasi paling jauh 30 hari ke depan');
    const m = toMin(dto.time);
    if (b.openTime && b.closeTime && (m < toMin(b.openTime) || m > toMin(b.closeTime) - RSV_LAST_BEFORE_CLOSE_MIN)) {
      throw new BadRequestException('Jam reservasi di luar jam buka');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await this.prisma.db.reservation.create({
          data: {
            branchId: b.id, code: `RSV-${randCode(4)}`, customerId: c?.id ?? null, name: dto.name, phone, reservedFor: new Date(at), guests: dto.guests,
            area, occasion: dto.occasion || null, note: dto.note || null,
          },
          select: RSV_SELECT,
        });
        if (c && !c.name) await this.prisma.db.customer.update({ where: { id: c.id }, data: { name: dto.name } });
        await this.audit.log({
          action: 'pwa.reservation.create', entity: 'Reservation', entityId: r.id, branchId: b.id,
          detail: { code: r.code, guests: r.guests, at: r.reservedFor.toISOString(), guest: !c },
        });
        this.events.emit({ branchId: b.id, type: 'feed', data: { at: Date.now(), reservation: r.id } });
        return { ...r, accessToken: reservationToken(r.id) };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // kode kembar
        throw e;
      }
    }
    throw new ConflictException('Gagal membuat kode reservasi, coba lagi');
  }

  /** Batal oleh pelanggan (hak akses diperiksa guard). Pre-order yang belum dibayar ikut dibatalkan (versi naik → POS melihat perubahan). */
  async cancelReservation(id: string) {
    hit(this.writes, `rsv:${id}`);
    const r = await this.prisma.db.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Reservasi tidak ditemukan');
    if (r.status === 'CANCELLED') return this.reservation(id);
    if (r.status !== 'PENDING' && r.status !== 'CONFIRMED') throw new ConflictException('Reservasi ini tidak bisa dibatalkan');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
      const pre = await tx.order.findMany({ where: { reservationId: id, status: 'OPEN', payments: { none: { status: 'SUCCEEDED' } } }, select: { id: true } });
      let voided = 0;
      for (const o of pre) {
        // Bersyarat status OPEN: bila kasir melunasinya bersamaan, pre-order itu tidak ikut dibatalkan.
        const n = await tx.order.updateMany({
          where: { id: o.id, status: 'OPEN' },
          data: { status: 'VOIDED', fulfillment: 'CANCELLED', voidReason: 'Reservasi dibatalkan pelanggan', voidedAt: new Date(), version: { increment: SERVER_VERSION_STEP } },
        });
        if (!n.count) continue;
        voided++;
        await tx.payment.updateMany({ where: { orderId: o.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      }
      await this.audit.log({ action: 'pwa.reservation.cancel', entity: 'Reservation', entityId: id, branchId: r.branchId, detail: { code: r.code, preOrdersVoided: voided } }, tx);
    });
    this.events.emit({ branchId: r.branchId, type: 'feed', data: { at: Date.now(), reservation: id } });
    return this.reservation(id);
  }

  // --- Alamat tersimpan -----------------------------------------------------------

  async addresses(c: CustomerCtx) {
    const rows = await this.prisma.db.customerAddress.findMany({ where: { customerId: c.id }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], select: ADDRESS_SELECT });
    return rows.map(addressOut);
  }

  private data(dto: AddressDto) {
    return {
      label: dto.label || null,
      addressText: dto.addressText,
      addressNote: dto.addressNote || null,
      latitude: new Prisma.Decimal(dto.lat.toFixed(6)),
      longitude: new Prisma.Decimal(dto.lng.toFixed(6)),
      recipientName: dto.recipientName,
      recipientPhone: phoneOrThrow(dto.recipientPhone),
    };
  }

  async addAddress(c: CustomerCtx, dto: AddressDto) {
    hit(this.writes, c.id);
    const count = await this.prisma.db.customerAddress.count({ where: { customerId: c.id } });
    if (count >= 20) throw new BadRequestException('Maksimal 20 alamat tersimpan');
    const isDefault = dto.isDefault ?? count === 0;
    const a = await this.prisma.db.$transaction(async (tx) => {
      if (isDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id }, data: { isDefault: false } });
      return tx.customerAddress.create({ data: { customerId: c.id, ...this.data(dto), isDefault }, select: ADDRESS_SELECT });
    });
    return addressOut(a);
  }

  async updateAddress(c: CustomerCtx, id: string, dto: AddressDto) {
    hit(this.writes, c.id);
    const prev = await this.prisma.db.customerAddress.findUnique({ where: { id } });
    if (!prev || prev.customerId !== c.id) throw new NotFoundException('Alamat tidak ditemukan');
    const a = await this.prisma.db.$transaction(async (tx) => {
      if (dto.isDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id, id: { not: id } }, data: { isDefault: false } });
      return tx.customerAddress.update({ where: { id }, data: { ...this.data(dto), ...(dto.isDefault != null ? { isDefault: dto.isDefault } : {}) }, select: ADDRESS_SELECT });
    });
    return addressOut(a);
  }

  async deleteAddress(c: CustomerCtx, id: string) {
    hit(this.writes, c.id);
    const prev = await this.prisma.db.customerAddress.findUnique({ where: { id } });
    if (!prev || prev.customerId !== c.id) throw new NotFoundException('Alamat tidak ditemukan');
    await this.prisma.db.customerAddress.delete({ where: { id } });
    return { ok: true };
  }
}
