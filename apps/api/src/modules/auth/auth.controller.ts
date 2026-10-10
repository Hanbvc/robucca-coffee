import { Body, Controller, Get, HttpCode, Ip, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  AuthService, can, canBranch, CurrentDevice, CurrentStaff, DeviceGuard, SESSION_TTL_SECONDS, StaffGuard,
  type DeviceCtx, type StaffCtx,
} from '../../common/auth';
import { RateLimiter } from '../../common/rate-limit';
import { sign } from '../../common/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { ApproveDto, PasswordLoginDto, PinLoginDto } from './auth.dto';

// PIN 4–6 digit mudah ditebak: batasi per perangkat+staf dan per IP.
const pinLimit = new RateLimiter(5, 10 * 60_000, 5 * 60_000);
const ipLimit = new RateLimiter(30, 10 * 60_000, 10 * 60_000);
export const APPROVAL_TTL_SECONDS = 5 * 60;

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /** Login kasir/dapur/manajer di perangkat terpasang: pilih nama, masukkan PIN. */
  @Post('pos/login')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  async pinLogin(@Body() body: PinLoginDto, @CurrentDevice() device: DeviceCtx, @Ip() ip: string) {
    const key = `${device.id}:${body.userId}`;
    pinLimit.check(key);
    ipLimit.check(ip);
    const user = await this.prisma.db.user.findUnique({ where: { id: body.userId }, select: { pinHash: true } });
    const staff = await this.auth.staffById(body.userId);
    const allowed = !!staff && (device.branchId ? canBranch(staff, device.branchId) : staff.branchIds === null || can(staff, 'report.view'));
    if (!allowed || !user?.pinHash || !(await bcrypt.compare(body.pin, user.pinHash))) {
      pinLimit.fail(key);
      ipLimit.fail(ip);
      throw new UnauthorizedException('PIN salah');
    }
    pinLimit.ok(key);
    await this.prisma.db.user.update({ where: { id: body.userId }, data: { lastLoginAt: new Date() } });
    const session = sign({ sub: staff.id, dev: device.id }, SESSION_TTL_SECONDS);
    return { session, expiresIn: SESSION_TTL_SECONDS, staff: { id: staff.id, name: staff.name, role: staff.role, permissions: staff.permissions } };
  }

  /**
   * Persetujuan manajer (void, refund, diskon besar) saat online: PIN diperiksa server dan
   * menghasilkan token persetujuan 5 menit yang dilampirkan pada transaksi.
   */
  @Post('pos/approve')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async approve(@Body() body: ApproveDto, @CurrentDevice() device: DeviceCtx, @CurrentStaff() staff: StaffCtx, @Ip() ip: string) {
    const key = `approve:${device.id}`;
    pinLimit.check(key);
    ipLimit.check(ip);
    const candidates = await this.prisma.db.user.findMany({
      where: {
        isActive: true,
        pinHash: { not: null },
        OR: [{ role: { code: 'SUPER_ADMIN' } }, { branches: { some: { branchId: device.branchId ?? undefined } } }],
      },
      select: { id: true, name: true, pinHash: true, role: { select: { permissions: true } } },
    });
    for (const c of candidates) {
      const p = c.role.permissions;
      if (!(p.includes('*') || p.includes(body.permission))) continue;
      if (await bcrypt.compare(body.pin, c.pinHash!)) {
        pinLimit.ok(key);
        const approval = sign({ sub: c.id, perm: body.permission, dev: device.id, req: staff.id }, APPROVAL_TTL_SECONDS);
        return { approval, approver: { id: c.id, name: c.name } };
      }
    }
    pinLimit.fail(key);
    ipLimit.fail(ip);
    throw new UnauthorizedException('PIN salah atau tidak punya hak menyetujui');
  }

  /** Login dasbor kantor (Super Admin / Manajer) dengan email & password. */
  @Post('auth/login')
  @HttpCode(200)
  async passwordLogin(@Body() body: PasswordLoginDto, @Ip() ip: string) {
    const key = `pw:${body.email}`;
    pinLimit.check(key);
    ipLimit.check(ip);
    const user = await this.prisma.db.user.findUnique({ where: { email: body.email }, select: { id: true, passwordHash: true } });
    const staff = user ? await this.auth.staffById(user.id) : null;
    if (!staff || !user?.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash)) || !can(staff, 'report.view')) {
      pinLimit.fail(key);
      ipLimit.fail(ip);
      throw new UnauthorizedException('Email atau password salah');
    }
    pinLimit.ok(key);
    const session = sign({ sub: staff.id }, SESSION_TTL_SECONDS);
    return { session, expiresIn: SESSION_TTL_SECONDS, staff };
  }

  @Get('auth/me')
  @UseGuards(StaffGuard)
  me(@CurrentStaff() staff: StaffCtx) {
    return staff;
  }
}
