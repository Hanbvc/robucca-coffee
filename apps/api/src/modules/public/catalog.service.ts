/* Data publik untuk PWA: cabang, menu, banner, kurir, metode bayar. Tanpa data internal. */
import { Injectable, NotFoundException } from '@nestjs/common';
import { taxConfigFor, type TaxConfig } from '@robucca/core';
import { PrismaService } from '../../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';

/** Metode bayar yang bisa dipilih pelanggan: QRIS & e-wallet (dikonfirmasi kasir), atau bayar di kasir. */
export const ONLINE_METHODS = ['QRIS', 'E_WALLET'] as const;
export const CASHIER = { code: 'cashier', name: 'Bayar di Kasir', method: null, provider: null, online: false } as const;

const num = (d: { toNumber(): number } | null): number | null => (d == null ? null : d.toNumber());

/** Identitas brand untuk PWA (nama, tagline, akun Instagram & TikTok). */
const orgOut = (s: { orgName: string; tagline: string | null; instagram: string | null; tiktok: string | null } | null) => ({
  name: s?.orgName ?? 'Robucca', tagline: s?.tagline ?? null, instagram: s?.instagram ?? null, tiktok: s?.tiktok ?? null,
});

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menu: MenuService,
  ) {}

  private publicBranch(b: {
    code: string; name: string; address: string | null; phone: string | null; timezone: string; openTime: string | null; closeTime: string | null;
    latitude: { toNumber(): number } | null; longitude: { toNumber(): number } | null; acceptsPwa: boolean; acceptsDelivery: boolean; deliveryMaxKm: { toNumber(): number } | null;
    acceptsReservations: boolean; maxReservationGuests: number; reservationAreas: string[]; taxLabel: string; taxRateBp: number; taxInclusive: boolean;
  }) {
    return {
      code: b.code, name: b.name, address: b.address, phone: b.phone, timezone: b.timezone, openTime: b.openTime, closeTime: b.closeTime,
      lat: num(b.latitude), lng: num(b.longitude),
      acceptsPwa: b.acceptsPwa, acceptsDelivery: b.acceptsDelivery && b.latitude != null && b.longitude != null, deliveryMaxKm: num(b.deliveryMaxKm),
      acceptsReservations: b.acceptsReservations, maxReservationGuests: b.maxReservationGuests, reservationAreas: b.reservationAreas,
      taxLabel: b.taxLabel, taxRateBp: b.taxRateBp, taxInclusive: b.taxInclusive,
    };
  }

  async branches() {
    const rows = await this.prisma.db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return rows.map((b) => this.publicBranch(b));
  }

  async branchRow(code: string) {
    const b = await this.prisma.db.branch.findFirst({ where: { code, isActive: true } });
    if (!b) throw new NotFoundException(`Cabang ${code} tidak ditemukan`);
    return b;
  }

  async taxConfig(branch: { taxRateBp: number; taxInclusive: boolean; taxOnService: boolean; serviceRateBp: number }): Promise<TaxConfig> {
    const s = await this.prisma.db.organizationSetting.findUnique({ where: { id: 1 } });
    return taxConfigFor(branch, { roundingUnit: s?.roundingUnit ?? 100, roundingMode: s?.roundingMode ?? 'DOWN' });
  }

  /** Menu cabang (layanan menu yang sama dengan GET /branches/:kode/menu) + konfigurasi pajak untuk hitung total di PWA. */
  async menuFor(code: string) {
    const b = await this.branchRow(code);
    const [menu, taxConfig, settings] = await Promise.all([this.menu.forBranch(code), this.taxConfig(b), this.prisma.db.organizationSetting.findUnique({ where: { id: 1 } })]);
    return { branch: this.publicBranch(b), taxConfig, org: orgOut(settings), categories: menu.categories };
  }

  async appConfig(otpLogin: boolean) {
    const s = await this.prisma.db.organizationSetting.findUnique({ where: { id: 1 } });
    return { org: orgOut(s), otpLogin };
  }

  banners() {
    return this.prisma.db.banner.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, imageUrl: true, label: true, categoryId: true, objectPosition: true },
    });
  }

  couriers() {
    return this.prisma.db.courierService.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, provider: true, baseFee: true, perKmFee: true, minFee: true },
    });
  }

  async paymentOptions() {
    const rows = await this.prisma.db.paymentOption.findMany({
      where: { isActive: true, method: { in: [...ONLINE_METHODS] } },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, method: true, provider: true },
    });
    return [...rows.map((r) => ({ ...r, online: true })), CASHIER];
  }
}
