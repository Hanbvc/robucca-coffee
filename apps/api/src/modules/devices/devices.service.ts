import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canBranch, type StaffCtx } from '../../common/auth';
import { randDigits } from '@robucca/core';
import { randomToken, sha256 } from '../../common/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const PAIRING_TTL_MS = 15 * 60_000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Manajer hanya mengelola perangkat cabangnya; perangkat kantor pusat (tanpa cabang) khusus Super Admin. */
  async assertAccess(staff: StaffCtx, target: { deviceId?: string; branchCode?: string | undefined }): Promise<void> {
    let branchId: string | null = null;
    if (target.deviceId) {
      const d = await this.prisma.db.device.findUnique({ where: { id: target.deviceId }, select: { branchId: true } });
      if (!d) throw new NotFoundException('Perangkat tidak ditemukan');
      branchId = d.branchId;
    } else if (target.branchCode) {
      const b = await this.prisma.db.branch.findUnique({ where: { code: target.branchCode }, select: { id: true } });
      if (!b) throw new NotFoundException(`Cabang ${target.branchCode} tidak ditemukan`);
      branchId = b.id;
    }
    if (branchId ? !canBranch(staff, branchId) : staff.branchIds !== null) throw new ForbiddenException('Perangkat di luar akses Anda');
  }

  list(branchIds: string[] | null = null) {
    return this.prisma.db.device.findMany({
      where: branchIds ? { branchId: { in: branchIds } } : {},
      orderBy: [{ branchId: 'asc' }, { terminalNo: 'asc' }],
      select: {
        id: true, name: true, terminalNo: true, lastSeenAt: true, revokedAt: true, createdAt: true, pairingExpiresAt: true,
        branch: { select: { code: true, name: true } },
      },
    });
  }

  /** Daftarkan perangkat (terminal) dan buat kode pasang 6 digit, berlaku 15 menit. */
  async create(input: { branchCode?: string | undefined; terminalNo: number; name: string }, actorId: string | null) {
    let branchId: string | null = null;
    if (input.branchCode) {
      const b = await this.prisma.db.branch.findUnique({ where: { code: input.branchCode } });
      if (!b) throw new NotFoundException(`Cabang ${input.branchCode} tidak ditemukan`);
      branchId = b.id;
      if (input.terminalNo < 1) throw new BadRequestException('Nomor terminal cabang mulai dari 1');
    }
    const taken = await this.prisma.db.device.findFirst({ where: { branchId, terminalNo: input.terminalNo, revokedAt: null } });
    if (taken) throw new ConflictException(`Terminal ${input.terminalNo} sudah dipakai "${taken.name}". Cabut dulu atau pakai nomor lain.`);
    const code = randDigits(6);
    // Baris lama yang sudah dicabut melepas nomor terminalnya.
    await this.prisma.db.device.deleteMany({ where: { branchId, terminalNo: input.terminalNo, revokedAt: { not: null }, shifts: { none: {} }, orders: { none: {} } } });
    const device = await this.prisma.db.device.create({
      data: {
        branchId,
        terminalNo: input.terminalNo,
        name: input.name,
        pairingCodeHash: sha256(code),
        pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      },
    });
    await this.audit.log({ action: 'device.create', entity: 'Device', entityId: device.id, branchId, actorId, detail: { name: input.name, terminalNo: input.terminalNo } });
    return { device: { id: device.id, name: device.name, terminalNo: device.terminalNo }, code, expiresAt: device.pairingExpiresAt };
  }

  async newPairingCode(id: string, actorId: string | null) {
    const code = randDigits(6);
    const d = await this.prisma.db.device.update({
      where: { id },
      data: { pairingCodeHash: sha256(code), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), revokedAt: null, tokenHash: null },
    });
    await this.audit.log({ action: 'device.repair', entity: 'Device', entityId: id, branchId: d.branchId, actorId });
    return { code, expiresAt: d.pairingExpiresAt };
  }

  /** Perangkat menukar kode pasang dengan token (sekali pakai). */
  async pair(code: string, name: string | undefined) {
    const d = await this.prisma.db.device.findUnique({ where: { pairingCodeHash: sha256(code) }, include: { branch: { select: { code: true, name: true } } } });
    if (!d || !d.pairingExpiresAt || d.pairingExpiresAt.getTime() < Date.now()) return null;
    const token = randomToken('dev');
    await this.prisma.db.device.update({
      where: { id: d.id },
      data: { tokenHash: sha256(token), pairingCodeHash: null, pairingExpiresAt: null, lastSeenAt: new Date(), ...(name ? { name } : {}) },
    });
    await this.audit.log({ action: 'device.pair', entity: 'Device', entityId: d.id, branchId: d.branchId, actorId: null, detail: { name: name ?? d.name } });
    return { token, device: { id: d.id, name: name ?? d.name, terminalNo: d.terminalNo, branch: d.branch } };
  }

  async revoke(id: string, actorId: string) {
    const d = await this.prisma.db.device.update({ where: { id }, data: { revokedAt: new Date(), tokenHash: null, pairingCodeHash: null } });
    await this.audit.log({ action: 'device.revoke', entity: 'Device', entityId: id, branchId: d.branchId, actorId });
    return { ok: true };
  }
}
