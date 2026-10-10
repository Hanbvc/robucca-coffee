/* Autentikasi POS: perangkat (token pasang) + staf (sesi PIN), dan dasbor (sesi email/password).
   Header: `X-Device-Token`, `X-Session` (atau query ?device=&session= untuk EventSource). */
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { sha256, verify } from './tokens';

export interface DeviceCtx {
  id: string;
  branchId: string | null;
  terminalNo: number;
  name: string;
}

export interface StaffCtx {
  id: string;
  name: string;
  role: string;
  permissions: string[];
  /** Cabang yang boleh diakses; null = semua (Super Admin). */
  branchIds: string[] | null;
}

export interface AuthedRequest extends Request {
  device?: DeviceCtx;
  staff?: StaffCtx;
}

export const SESSION_TTL_SECONDS = 12 * 3600;

export const can = (staff: StaffCtx, perm: string): boolean => staff.permissions.includes('*') || staff.permissions.includes(perm);
export const canBranch = (staff: StaffCtx, branchId: string): boolean => staff.branchIds === null || staff.branchIds.includes(branchId);

export function needPerm(staff: StaffCtx, perm: string): void {
  if (!can(staff, perm)) throw new ForbiddenException('Anda tidak punya akses untuk tindakan ini');
}

const header = (req: Request, name: string, query: string): string | undefined => {
  const h = req.headers[name];
  if (typeof h === 'string' && h) return h;
  const q = req.query[query];
  return typeof q === 'string' && q ? q : undefined;
};

export const PERMISSION_KEY = 'robucca:permission';
/** Hak akses yang wajib dimiliki staf untuk rute ini. */
export const RequirePermission = (perm: string) => SetMetadata(PERMISSION_KEY, perm);

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext): DeviceCtx => {
  const d = ctx.switchToHttp().getRequest<AuthedRequest>().device;
  if (!d) throw new UnauthorizedException('Perangkat belum dipasangkan');
  return d;
});

export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffCtx => {
  const s = ctx.switchToHttp().getRequest<AuthedRequest>().staff;
  if (!s) throw new UnauthorizedException('Silakan masuk dengan PIN');
  return s;
});

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async device(token: string | undefined): Promise<DeviceCtx> {
    if (!token) throw new UnauthorizedException('Perangkat belum dipasangkan');
    const d = await this.prisma.db.device.findUnique({ where: { tokenHash: sha256(token) } });
    if (!d || d.revokedAt) throw new UnauthorizedException('Perangkat tidak dikenal atau sudah dicabut');
    if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 60_000) {
      await this.prisma.db.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    }
    return { id: d.id, branchId: d.branchId, terminalNo: d.terminalNo, name: d.name };
  }

  /** Staf aktif dengan peran & cabangnya. */
  async staffById(id: string): Promise<StaffCtx | null> {
    const u = await this.prisma.db.user.findUnique({
      where: { id },
      include: { role: true, branches: { select: { branchId: true } } },
    });
    if (!u || !u.isActive) return null;
    return {
      id: u.id,
      name: u.name,
      role: u.role.code,
      permissions: u.role.permissions,
      branchIds: u.role.code === 'SUPER_ADMIN' ? null : u.branches.map((b) => b.branchId),
    };
  }

  async session(token: string | undefined, device: DeviceCtx | null): Promise<StaffCtx> {
    // typ wajib 'sess': token lain bertanda tangan sama (persetujuan manajer, pelanggan, akses pesanan) bukan sesi staf.
    const p = token ? verify<{ sub: string; dev?: string; typ?: string }>(token) : null;
    if (!p || p.typ !== 'sess') throw new UnauthorizedException('Sesi berakhir, silakan masuk lagi');
    if (device && p.dev !== device.id) throw new UnauthorizedException('Sesi bukan untuk perangkat ini');
    const staff = await this.staffById(p.sub);
    if (!staff) throw new UnauthorizedException('Akun tidak aktif');
    if (device?.branchId && !canBranch(staff, device.branchId)) throw new ForbiddenException('Cabang di luar akses Anda');
    return staff;
  }
}

/** Rute POS: wajib token perangkat. */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.device = await this.auth.device(header(req, 'x-device-token', 'device'));
    return true;
  }
}

/** Rute staf: token perangkat (bila ada) + sesi staf, dan hak akses dari @RequirePermission. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const devToken = header(req, 'x-device-token', 'device');
    const device = devToken ? await this.auth.device(devToken) : null;
    if (device) req.device = device;
    req.staff = await this.auth.session(header(req, 'x-session', 'session'), device);
    const perm = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (perm) needPerm(req.staff, perm);
    return true;
  }
}
