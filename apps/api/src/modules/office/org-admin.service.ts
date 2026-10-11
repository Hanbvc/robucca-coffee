/* Promo, karyawan, perangkat, cabang, pengaturan pusat, dan log aktivitas. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { zonedEpoch } from '@robucca/core';
import { Prisma } from '@robucca/db';
import bcrypt from 'bcryptjs';
import { canBranch, type StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { assertBranch, branchWhere, dec, DEFAULT_TZ, isSuper, looseWindow, OfficeEvents, resolveRange, scopeBranches, todayFor, bizDateOf } from './office.common';
import type {
  AuditQueryDto, BannerDto, BranchDto, ChannelDto, CourierDto, OfficeDeviceDto, PaymentOptionDto, PromoDto, RoleCodeDto, SettingsDto, StaffDto, StaffQueryDto,
  UpdateBannerDto, UpdateBranchDto, UpdateChannelDto, UpdateCourierDto, UpdatePaymentOptionDto, UpdatePromoDto, UpdateStaffDto,
} from './office.dto';

const strip = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const unique = (e: unknown, msg: string): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(msg);
  throw e;
};
/** Peran yang boleh dikelola manajer cabang (POS lama: manajer hanya kasir & dapur). */
const MANAGER_ASSIGNABLE: RoleCodeDto[] = ['CASHIER', 'KITCHEN'];

/** 'YYYY-MM-DD' = awal (from) / akhir (until) hari WIB; selain itu ISO 8601. */
function promoDate(v: string | null | undefined, end: boolean): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(zonedEpoch(v, '00:00', DEFAULT_TZ) + (end ? 86_400_000 - 1 : 0)) : new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Tanggal promo tidak valid');
  return d;
}

const STAFF_SELECT = {
  id: true, name: true, email: true, isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true, pinHash: true, passwordHash: true,
  role: { select: { code: true, name: true } },
  branches: { select: { branch: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserSelect;
type StaffRow = Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>;
const staffOut = ({ pinHash, passwordHash, branches, ...u }: StaffRow) => ({ ...u, hasPin: !!pinHash, hasPassword: !!passwordHash, branches: branches.map((b) => b.branch) });

@Injectable()
export class OrgAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly office: OfficeEvents,
    private readonly devices: DevicesService,
  ) {}

  // ================================================================ promo

  async promos(staff: StaffCtx) {
    const rows = await this.prisma.db.promotion.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { branches: { select: { branchId: true } }, _count: { select: { orders: true, orderItems: true } } },
    });
    return rows
      .map(({ branches, _count, ...p }) => ({ ...p, branchIds: branches.map((b) => b.branchId), usedCount: _count.orders + _count.orderItems }))
      .filter((p) => isSuper(staff) || p.allBranches || p.branchIds.some((b) => canBranch(staff, b)));
  }

  private checkPromo(type: string, value: number, allBranches: boolean, branchIds: string[], from: Date | null, until: Date | null) {
    if (type === 'PERCENT' && value > 10000) throw new BadRequestException('Persen maksimal 100% (10000 bp)');
    if (!allBranches && !branchIds.length) throw new BadRequestException('Pilih minimal satu cabang');
    if (from && until && from > until) throw new BadRequestException('Tanggal mulai melewati tanggal selesai');
  }

  async createPromo(staff: StaffCtx, b: PromoDto) {
    const allBranches = b.allBranches ?? !(b.branchIds?.length);
    const branchIds = allBranches ? [] : [...new Set(b.branchIds ?? [])];
    for (const id of branchIds) assertBranch(staff, id);
    if (allBranches && !isSuper(staff)) throw new ForbiddenException('Promo semua cabang hanya untuk Super Admin');
    const validFrom = promoDate(b.validFrom, false) ?? null;
    const validUntil = promoDate(b.validUntil, true) ?? null;
    this.checkPromo(b.type, b.value, allBranches, branchIds, validFrom, validUntil);
    const p = await this.prisma.db.promotion.create({
      data: {
        name: b.name, type: b.type, value: b.value, requiresApproval: b.requiresApproval ?? false, allBranches, validFrom, validUntil, isActive: b.isActive ?? true,
        branches: { create: branchIds.map((branchId) => ({ branchId })) },
      },
      include: { branches: { select: { branchId: true } } },
    });
    await this.office.log(staff, 'promo.create', 'Promotion', p.id, branchIds.length === 1 ? branchIds[0]! : null, { name: p.name, type: p.type, value: p.value, requiresApproval: p.requiresApproval, branchIds });
    this.office.master(allBranches ? null : branchIds, 'promo');
    return { ...p, branchIds: p.branches.map((x) => x.branchId) };
  }

  async updatePromo(staff: StaffCtx, id: string, b: UpdatePromoDto) {
    const prev = await this.prisma.db.promotion.findUnique({ where: { id }, include: { branches: true } });
    if (!prev) throw new NotFoundException('Promo tidak ditemukan');
    const prevBranches = prev.branches.map((x) => x.branchId);
    if (!isSuper(staff) && (prev.allBranches || !prevBranches.every((x) => canBranch(staff, x)))) throw new ForbiddenException('Promo ini di luar akses Anda');
    const allBranches = b.allBranches ?? (b.branchIds ? false : prev.allBranches);
    const branchIds = allBranches ? [] : [...new Set(b.branchIds ?? prevBranches)];
    for (const x of branchIds) assertBranch(staff, x);
    if (allBranches && !isSuper(staff)) throw new ForbiddenException('Promo semua cabang hanya untuk Super Admin');
    const validFrom = promoDate(b.validFrom, false);
    const validUntil = promoDate(b.validUntil, true);
    this.checkPromo(b.type ?? prev.type, b.value ?? prev.value, allBranches, branchIds, validFrom === undefined ? prev.validFrom : validFrom, validUntil === undefined ? prev.validUntil : validUntil);
    const p = await this.prisma.db.$transaction(async (tx) => {
      await tx.promotionBranch.deleteMany({ where: { promotionId: id } });
      if (branchIds.length) await tx.promotionBranch.createMany({ data: branchIds.map((branchId) => ({ promotionId: id, branchId })) });
      return tx.promotion.update({
        where: { id },
        data: strip({ name: b.name, type: b.type, value: b.value, requiresApproval: b.requiresApproval, isActive: b.isActive, allBranches, validFrom, validUntil }),
        include: { branches: { select: { branchId: true } } },
      });
    });
    await this.office.log(staff, 'promo.update', 'Promotion', id, branchIds.length === 1 ? branchIds[0]! : null, { name: p.name, changes: strip({ ...b }) });
    this.office.master(allBranches || prev.allBranches ? null : [...prevBranches, ...branchIds], 'promo');
    return { ...p, branchIds: p.branches.map((x) => x.branchId) };
  }

  /** Promo yang sudah dipakai transaksi tidak dihapus, hanya dinonaktifkan (riwayat tetap utuh). */
  async deletePromo(staff: StaffCtx, id: string) {
    const prev = await this.prisma.db.promotion.findUnique({ where: { id }, include: { branches: true, _count: { select: { orders: true, orderItems: true } } } });
    if (!prev) throw new NotFoundException('Promo tidak ditemukan');
    const prevBranches = prev.branches.map((x) => x.branchId);
    if (!isSuper(staff) && (prev.allBranches || !prevBranches.every((x) => canBranch(staff, x)))) throw new ForbiddenException('Promo ini di luar akses Anda');
    const used = prev._count.orders + prev._count.orderItems > 0;
    if (used) await this.prisma.db.promotion.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.db.promotion.delete({ where: { id } });
    await this.office.log(staff, used ? 'promo.deactivate' : 'promo.delete', 'Promotion', id, null, { name: prev.name });
    this.office.master(prev.allBranches ? null : prevBranches, 'promo');
    return { ok: true, deleted: !used, deactivated: used };
  }

  // ================================================================ karyawan

  roles(staff: StaffCtx) {
    return this.prisma.db.role.findMany({ orderBy: { code: 'asc' } }).then((rows) =>
      rows.map((r) => ({ ...r, assignable: isSuper(staff) || MANAGER_ASSIGNABLE.includes(r.code as RoleCodeDto) })),
    );
  }

  async staffList(staff: StaffCtx, q: StaffQueryDto) {
    if (q.branchId) assertBranch(staff, q.branchId);
    const scope = q.branchId ? [q.branchId] : staff.branchIds;
    const rows = await this.prisma.db.user.findMany({
      where: {
        ...(q.includeInactive ? {} : { isActive: true }),
        ...(scope ? { role: { code: { not: 'SUPER_ADMIN' } }, branches: { some: { branchId: { in: scope } } } } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: STAFF_SELECT,
    });
    return rows.map((u) => ({ ...staffOut(u), editable: this.canEdit(staff, u) }));
  }

  private canEdit(staff: StaffCtx, u: StaffRow): boolean {
    if (isSuper(staff)) return true;
    return MANAGER_ASSIGNABLE.includes(u.role.code as RoleCodeDto) && u.branches.length > 0 && u.branches.every((b) => canBranch(staff, b.branch.id));
  }

  /** PIN tidak boleh sama dengan staf aktif lain di cabang yang sama: persetujuan PIN manajer & login harus menunjuk satu orang. */
  private async pinTaken(pin: string, branchIds: string[], exceptId: string | null): Promise<boolean> {
    const others = await this.prisma.db.user.findMany({
      where: {
        isActive: true, pinHash: { not: null }, ...(exceptId ? { id: { not: exceptId } } : {}),
        ...(branchIds.length ? { OR: [{ role: { code: 'SUPER_ADMIN' } }, { branches: { some: { branchId: { in: branchIds } } } }] } : {}),
      },
      select: { pinHash: true },
    });
    for (const o of others) if (await bcrypt.compare(pin, o.pinHash!)) return true;
    return false;
  }

  private checkAssign(staff: StaffCtx, role: RoleCodeDto, branchIds: string[]) {
    if (!isSuper(staff) && !MANAGER_ASSIGNABLE.includes(role)) throw new ForbiddenException('Manajer hanya bisa mengelola kasir & dapur');
    if (role !== 'SUPER_ADMIN' && !branchIds.length) throw new BadRequestException('Pilih minimal satu cabang');
    for (const b of branchIds) assertBranch(staff, b);
  }

  private async activeSupers(exceptId: string): Promise<number> {
    return this.prisma.db.user.count({ where: { isActive: true, role: { code: 'SUPER_ADMIN' }, id: { not: exceptId } } });
  }

  private masterFor(role: string, branchIds: string[]): string[] | null {
    return role === 'SUPER_ADMIN' ? null : branchIds;
  }

  async createStaff(staff: StaffCtx, b: StaffDto) {
    const branchIds = b.role === 'SUPER_ADMIN' ? [] : [...new Set(b.branchIds ?? [])];
    this.checkAssign(staff, b.role, branchIds);
    if (b.pin && (await this.pinTaken(b.pin, branchIds, null))) throw new ConflictException('PIN sudah dipakai staf lain di cabang ini, pilih PIN lain');
    if (b.password && !b.email) throw new BadRequestException('Password butuh email untuk login dasbor');
    const u = await this.prisma.db.user
      .create({
        data: {
          name: b.name, email: b.email ?? null, isActive: b.isActive ?? true,
          pinHash: b.pin ? await bcrypt.hash(b.pin, 10) : null,
          passwordHash: b.password ? await bcrypt.hash(b.password, 10) : null,
          role: { connect: { code: b.role } },
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: STAFF_SELECT,
      })
      .catch((e: unknown) => unique(e, 'Email sudah dipakai'));
    await this.office.log(staff, 'staff.create', 'User', u.id, branchIds.length === 1 ? branchIds[0]! : null, { name: u.name, role: b.role, branchIds, pin: !!b.pin });
    this.office.master(this.masterFor(b.role, branchIds), 'staff');
    return staffOut(u);
  }

  private async target(staff: StaffCtx, id: string): Promise<StaffRow> {
    const u = await this.prisma.db.user.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!u) throw new NotFoundException('Karyawan tidak ditemukan');
    if (!this.canEdit(staff, u)) throw new ForbiddenException('Karyawan ini di luar akses Anda');
    return u;
  }

  async updateStaff(staff: StaffCtx, id: string, b: UpdateStaffDto) {
    const prev = await this.target(staff, id);
    const role = (b.role ?? prev.role.code) as RoleCodeDto;
    const prevBranches = prev.branches.map((x) => x.branch.id);
    const branchIds = role === 'SUPER_ADMIN' ? [] : [...new Set(b.branchIds ?? prevBranches)];
    this.checkAssign(staff, role, branchIds);
    if (id === staff.id && b.isActive === false) throw new BadRequestException('Tidak bisa menonaktifkan akun sendiri');
    if (prev.role.code === 'SUPER_ADMIN' && (role !== 'SUPER_ADMIN' || b.isActive === false) && (await this.activeSupers(id)) < 1) {
      throw new BadRequestException('Harus ada minimal satu Super Admin aktif');
    }
    const u = await this.prisma.db
      .$transaction(async (tx) => {
        if (b.branchIds || b.role) {
          await tx.userBranch.deleteMany({ where: { userId: id } });
          if (branchIds.length) await tx.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId: id, branchId })) });
        }
        return tx.user.update({
          where: { id },
          data: { ...strip({ name: b.name, isActive: b.isActive, email: b.email }), ...(b.role ? { role: { connect: { code: b.role } } } : {}) },
          select: STAFF_SELECT,
        });
      })
      .catch((e: unknown) => unique(e, 'Email sudah dipakai'));
    await this.office.log(staff, b.isActive === false ? 'staff.deactivate' : 'staff.update', 'User', id, branchIds.length === 1 ? branchIds[0]! : null, { name: u.name, changes: strip({ ...b }) });
    this.office.master(prev.role.code === 'SUPER_ADMIN' || role === 'SUPER_ADMIN' ? null : [...prevBranches, ...branchIds], 'staff');
    return staffOut(u);
  }

  async setPin(staff: StaffCtx, id: string, pin: string) {
    const u = await this.target(staff, id);
    const branchIds = u.branches.map((x) => x.branch.id);
    if (await this.pinTaken(pin, branchIds, id)) throw new ConflictException('PIN sudah dipakai staf lain di cabang ini, pilih PIN lain');
    await this.prisma.db.user.update({ where: { id }, data: { pinHash: await bcrypt.hash(pin, 10) } });
    await this.office.log(staff, 'staff.pin', 'User', id, branchIds.length === 1 ? branchIds[0]! : null, { name: u.name });
    this.office.master(this.masterFor(u.role.code, branchIds), 'staff');
    return { ok: true };
  }

  async setPassword(staff: StaffCtx, id: string, password: string) {
    const u = await this.target(staff, id);
    if (!u.email) throw new BadRequestException('Isi email karyawan dulu');
    await this.prisma.db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await this.office.log(staff, 'staff.password', 'User', id, null, { name: u.name });
    return { ok: true };
  }

  // ================================================================ perangkat

  async deviceList(staff: StaffCtx) {
    const rows = await this.prisma.db.device.findMany({
      where: staff.branchIds ? { branchId: { in: staff.branchIds } } : {},
      orderBy: [{ branchId: 'asc' }, { terminalNo: 'asc' }],
      select: { id: true, name: true, branchId: true, terminalNo: true, lastSeenAt: true, revokedAt: true, createdAt: true, pairingExpiresAt: true, tokenHash: true, branch: { select: { code: true, name: true } } },
    });
    const now = Date.now();
    return rows.map(({ tokenHash, ...d }) => ({
      ...d,
      paired: !!tokenHash,
      status: d.revokedAt ? 'REVOKED' : !tokenHash ? 'PENDING' : d.lastSeenAt && now - d.lastSeenAt.getTime() < 120_000 ? 'ONLINE' : 'OFFLINE',
    }));
  }

  async createDevice(staff: StaffCtx, b: OfficeDeviceDto) {
    let branchCode: string | undefined;
    if (b.branchId) {
      assertBranch(staff, b.branchId);
      const br = await this.prisma.db.branch.findUnique({ where: { id: b.branchId }, select: { code: true } });
      if (!br) throw new NotFoundException('Cabang tidak ditemukan');
      branchCode = br.code;
    } else if (!isSuper(staff)) throw new ForbiddenException('Hanya Super Admin yang bisa menambah perangkat kantor pusat');
    return this.devices.create({ branchCode, terminalNo: b.branchId ? b.terminalNo : 0, name: b.name }, staff.id);
  }

  private async deviceTarget(staff: StaffCtx, id: string) {
    const d = await this.prisma.db.device.findUnique({ where: { id }, select: { id: true, branchId: true } });
    if (!d) throw new NotFoundException('Perangkat tidak ditemukan');
    if (d.branchId ? !canBranch(staff, d.branchId) : !isSuper(staff)) throw new ForbiddenException('Perangkat di luar akses Anda');
    return d;
  }

  async devicePairingCode(staff: StaffCtx, id: string) {
    await this.deviceTarget(staff, id);
    return this.devices.newPairingCode(id, staff.id);
  }

  async revokeDevice(staff: StaffCtx, id: string, currentDeviceId: string | undefined) {
    await this.deviceTarget(staff, id);
    if (id === currentDeviceId) throw new BadRequestException('Tidak bisa mencabut perangkat yang sedang dipakai');
    return this.devices.revoke(id, staff.id);
  }

  // ================================================================ cabang

  async branchList(staff: StaffCtx) {
    const rows = await this.prisma.db.branch.findMany({
      where: staff.branchIds ? { id: { in: staff.branchIds } } : {},
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { orders: true, devices: true, staff: true } } },
    });
    return rows.map(({ _count, latitude, longitude, deliveryMaxKm, ...b }) => ({
      ...b, latitude: dec(latitude), longitude: dec(longitude), deliveryMaxKm: dec(deliveryMaxKm),
      orderCount: _count.orders, deviceCount: _count.devices, staffCount: _count.staff, codeLocked: _count.orders > 0,
    }));
  }

  private branchData(b: UpdateBranchDto) {
    const { latitude, longitude, deliveryMaxKm, ...rest } = b;
    return {
      ...strip(rest),
      ...(latitude !== undefined ? { latitude: latitude === null ? null : new Prisma.Decimal(latitude) } : {}),
      ...(longitude !== undefined ? { longitude: longitude === null ? null : new Prisma.Decimal(longitude) } : {}),
      ...(deliveryMaxKm !== undefined ? { deliveryMaxKm: deliveryMaxKm === null ? null : new Prisma.Decimal(deliveryMaxKm) } : {}),
    };
  }

  async createBranch(staff: StaffCtx, b: BranchDto) {
    if (!isSuper(staff)) throw new ForbiddenException('Hanya Super Admin yang bisa menambah cabang');
    const br = await this.prisma.db.branch
      .create({ data: { ...(this.branchData(b) as Prisma.BranchCreateInput), code: b.code, name: b.name } })
      .catch((e: unknown) => unique(e, `Kode ${b.code} sudah dipakai cabang lain`));
    await this.office.log(staff, 'branch.create', 'Branch', br.id, br.id, { code: br.code, name: br.name });
    this.office.master([br.id], 'branch');
    return br;
  }

  async updateBranch(staff: StaffCtx, id: string, b: UpdateBranchDto) {
    assertBranch(staff, id);
    const prev = await this.prisma.db.branch.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
    if (!prev) throw new NotFoundException('Cabang tidak ditemukan');
    if (b.code && b.code !== prev.code && prev._count.orders > 0) throw new BadRequestException('Kode cabang tidak bisa diubah setelah ada transaksi (dipakai di nomor struk)');
    const br = await this.prisma.db.branch.update({ where: { id }, data: this.branchData(b) }).catch((e: unknown) => unique(e, `Kode ${b.code} sudah dipakai cabang lain`));
    const taxKeys = ['taxRateBp', 'taxInclusive', 'serviceRateBp', 'taxOnService', 'taxLabel'] as const;
    const taxChanged = taxKeys.some((k) => b[k] !== undefined && b[k] !== prev[k]);
    await this.office.log(staff, taxChanged ? 'branch.tax.update' : 'branch.update', 'Branch', id, id, { code: br.code, changes: strip({ ...b }) });
    this.office.master([id], 'branch');
    return br;
  }

  // ================================================================ pengaturan pusat

  async settings() {
    const db = this.prisma.db;
    const [settings, channels, paymentOptions, couriers, banners] = await Promise.all([
      db.organizationSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
      db.salesChannel.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.paymentOption.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.courierService.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.banner.findMany({ orderBy: { sortOrder: 'asc' }, include: { category: { select: { name: true } } } }),
    ]);
    return { settings, channels, paymentOptions, couriers, banners };
  }

  async updateSettings(staff: StaffCtx, b: SettingsDto) {
    const prev = await this.prisma.db.organizationSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const warn = b.kdsWarnMinutes ?? prev.kdsWarnMinutes;
    const late = b.kdsLateMinutes ?? prev.kdsLateMinutes;
    if (late < warn) throw new BadRequestException('Batas tiket merah harus ≥ batas kuning');
    const s = await this.prisma.db.organizationSetting.update({ where: { id: 1 }, data: strip(b) });
    await this.office.log(staff, 'settings.update', 'OrganizationSetting', '1', null, { changes: strip({ ...b }) });
    this.office.master(null, 'settings');
    return s;
  }

  async createChannel(staff: StaffCtx, b: ChannelDto) {
    if (b.type !== 'FOOD_PLATFORM' && b.markupBp) throw new BadRequestException('Markup hanya untuk kanal ojol');
    const c = await this.prisma.db.salesChannel.create({ data: { ...b, markupBp: b.markupBp ?? 0 } }).catch((e: unknown) => unique(e, `Kode ${b.code} sudah dipakai`));
    await this.office.log(staff, 'channel.create', 'SalesChannel', c.id, null, { code: c.code, name: c.name, markupBp: c.markupBp });
    this.office.master(null, 'settings');
    return c;
  }

  async updateChannel(staff: StaffCtx, id: string, b: UpdateChannelDto) {
    const prev = await this.prisma.db.salesChannel.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException('Kanal tidak ditemukan');
    if (prev.type !== 'FOOD_PLATFORM' && b.markupBp) throw new BadRequestException('Markup hanya untuk kanal ojol');
    if (b.isActive === false && prev.isActive && (await this.prisma.db.salesChannel.count({ where: { isActive: true, id: { not: id } } })) === 0) {
      throw new BadRequestException('Minimal satu tipe pesanan harus aktif');
    }
    const c = await this.prisma.db.salesChannel.update({ where: { id }, data: strip(b) });
    await this.office.log(staff, b.markupBp !== undefined && b.markupBp !== prev.markupBp ? 'channel.markup.update' : 'channel.update', 'SalesChannel', id, null, { code: c.code, changes: strip({ ...b }) });
    this.office.master(null, 'settings');
    return c;
  }

  async createPaymentOption(staff: StaffCtx, b: PaymentOptionDto) {
    const p = await this.prisma.db.paymentOption.create({ data: { ...b, provider: b.provider ?? null } }).catch((e: unknown) => unique(e, `Kode ${b.code} sudah dipakai`));
    await this.office.log(staff, 'payment_option.create', 'PaymentOption', p.id, null, { code: p.code, name: p.name });
    this.office.master(null, 'settings');
    return p;
  }

  async updatePaymentOption(staff: StaffCtx, id: string, b: UpdatePaymentOptionDto) {
    const prev = await this.prisma.db.paymentOption.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException('Metode bayar tidak ditemukan');
    if (prev.method === 'CASH' && b.isActive === false) throw new BadRequestException('Tunai tidak bisa dinonaktifkan');
    const p = await this.prisma.db.paymentOption.update({ where: { id }, data: strip(b) });
    await this.office.log(staff, 'payment_option.update', 'PaymentOption', id, null, { code: p.code, changes: strip({ ...b }) });
    this.office.master(null, 'settings');
    return p;
  }

  async createCourier(staff: StaffCtx, b: CourierDto) {
    const c = await this.prisma.db.courierService.create({ data: b }).catch((e: unknown) => unique(e, `Kode ${b.code} sudah dipakai`));
    await this.office.log(staff, 'courier.create', 'CourierService', c.id, null, { code: c.code, name: c.name });
    this.office.master(null, 'settings');
    return c;
  }

  async updateCourier(staff: StaffCtx, id: string, b: UpdateCourierDto) {
    if (!(await this.prisma.db.courierService.findUnique({ where: { id } }))) throw new NotFoundException('Kurir tidak ditemukan');
    const c = await this.prisma.db.courierService.update({ where: { id }, data: strip(b) });
    await this.office.log(staff, 'courier.update', 'CourierService', id, null, { code: c.code, changes: strip({ ...b }) });
    this.office.master(null, 'settings');
    return c;
  }

  private async checkCategory(id: string | null | undefined) {
    if (id && !(await this.prisma.db.category.findUnique({ where: { id } }))) throw new BadRequestException('Kategori tidak dikenal');
  }

  async createBanner(staff: StaffCtx, b: BannerDto) {
    await this.checkCategory(b.categoryId);
    const x = await this.prisma.db.banner.create({ data: { ...b, categoryId: b.categoryId ?? null } });
    await this.office.log(staff, 'banner.create', 'Banner', x.id, null, { label: x.label });
    return x;
  }

  async updateBanner(staff: StaffCtx, id: string, b: UpdateBannerDto) {
    if (!(await this.prisma.db.banner.findUnique({ where: { id } }))) throw new NotFoundException('Banner tidak ditemukan');
    await this.checkCategory(b.categoryId);
    const x = await this.prisma.db.banner.update({ where: { id }, data: strip(b) });
    await this.office.log(staff, 'banner.update', 'Banner', id, null, { label: x.label, changes: strip({ ...b }) });
    return x;
  }

  async deleteBanner(staff: StaffCtx, id: string) {
    const x = await this.prisma.db.banner.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Banner tidak ditemukan');
    await this.prisma.db.banner.delete({ where: { id } });
    await this.office.log(staff, 'banner.delete', 'Banner', id, null, { label: x.label });
    return { ok: true };
  }

  // ================================================================ log aktivitas

  async audit(staff: StaffCtx, q: AuditQueryDto) {
    if (q.central && !isSuper(staff)) throw new ForbiddenException('Log pusat hanya untuk Super Admin');
    const scope = scopeBranches(staff, q.branchId);
    const one = scope?.length === 1 ? await this.prisma.db.branch.findUnique({ where: { id: scope[0]! }, select: { timezone: true, dayStartMinute: true } }) : null;
    const r = resolveRange(q, todayFor(one), '7d');
    const where: Prisma.AuditLogWhereInput = {
      createdAt: looseWindow(r),
      ...(q.central ? { branchId: null } : branchWhere(scope)),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    };
    const limit = q.limit ?? 300;
    const offset = q.offset ?? 0;
    const rows = await this.prisma.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20_000,
      select: {
        id: true, action: true, entity: true, entityId: true, detail: true, createdAt: true, branchId: true,
        branch: { select: { code: true, name: true, timezone: true, dayStartMinute: true } },
        actor: { select: { id: true, name: true } },
      },
    });
    const inRange = rows.filter((a) => {
      const d = bizDateOf(a.createdAt, a.branch ?? undefined);
      return d >= r.from && d <= r.to;
    });
    return {
      range: r,
      total: inRange.length,
      limit,
      offset,
      rows: inRange.slice(offset, offset + limit).map(({ branch, actor, ...a }) => ({
        ...a, branchCode: branch?.code ?? null, branchName: branch?.name ?? null, actorId: actor?.id ?? null, actorName: actor?.name ?? null,
      })),
    };
  }

  async auditActions(staff: StaffCtx) {
    const rows = await this.prisma.db.auditLog.groupBy({ by: ['action'], where: staff.branchIds ? { branchId: { in: staff.branchIds } } : {}, _count: true, orderBy: { action: 'asc' } });
    return rows.map((r) => ({ action: r.action, count: r._count }));
  }
}
