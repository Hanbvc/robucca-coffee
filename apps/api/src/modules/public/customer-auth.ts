/* Identitas pelanggan PWA: nomor WhatsApp + OTP 6 digit → token pelanggan (HMAC, 90 hari).
   - Kode disimpan sebagai HMAC (tidak pernah teks biasa), berlaku 5 menit, maks. 5 kali salah.
   - Permintaan kode dibatasi per nomor & per IP.
   - Pengiriman WhatsApp/SMS belum tersambung: di luar produksi kode dicetak ke log server dan
     dikembalikan di respons (devCode) agar bisa dicoba; di produksi tidak pernah dikembalikan.
   Catatan: penyimpanan kode di memori proses (cukup untuk satu instance API). */
import {
  BadRequestException, type CanActivate, createParamDecorator, type ExecutionContext, Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import { normalizePhone, randDigits } from '@robucca/core';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { RateLimiter } from '../../common/rate-limit';
import { sign, verify } from '../../common/tokens';
import { PrismaService } from '../../prisma/prisma.service';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_TRIES = 5;
export const CUSTOMER_TOKEN_TTL = 90 * 24 * 3600;

export interface CustomerCtx {
  id: string;
  phone: string;
  name: string | null;
}

export interface CustomerRequest extends Request {
  customer?: CustomerCtx;
}

/** Hitungan permintaan (bukan hanya gagal): setiap panggilan dihitung, diblokir setelah `max` dalam jendela. */
export function hit(limiter: RateLimiter, key: string): void {
  limiter.check(key);
  limiter.fail(key);
}

/** IP klien dari socket (X-Forwarded-For hanya dipercaya bila TRUST_PROXY diatur di main.ts). */
export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

export function phoneOrThrow(input: string): string {
  const p = normalizePhone(input);
  if (!p) throw new BadRequestException('Nomor WhatsApp belum valid');
  return p;
}

@Injectable()
export class CustomerAuthService {
  private readonly log = new Logger('OTP');
  private readonly key = randomBytes(32);
  private readonly codes = new Map<string, { hash: Buffer; exp: number; tries: number }>();
  /** Permintaan kode: 3 per nomor per 10 menit, 10 per IP per 10 menit. */
  private readonly perPhone = new RateLimiter(3, 10 * 60_000, 10 * 60_000);
  private readonly perIp = new RateLimiter(Number(process.env.PUBLIC_OTP_IP_LIMIT) || 10, 10 * 60_000, 10 * 60_000);
  /** Verifikasi salah: 5 per nomor per 15 menit. */
  private readonly verifyFails = new RateLimiter(OTP_MAX_TRIES, 15 * 60_000, 15 * 60_000);

  constructor(private readonly prisma: PrismaService) {}

  private hash(phone: string, code: string): Buffer {
    return createHmac('sha256', this.key).update(`${phone}:${code}`).digest();
  }

  requestOtp(rawPhone: string, ip: string): { sent: true; phone: string; expiresIn: number; devCode?: string } {
    const phone = phoneOrThrow(rawPhone);
    hit(this.perIp, ip);
    hit(this.perPhone, phone);
    const code = randDigits(6);
    this.codes.set(phone, { hash: this.hash(phone, code), exp: Date.now() + OTP_TTL_MS, tries: 0 });
    if (this.codes.size > 50_000) for (const [k, v] of this.codes) if (v.exp < Date.now()) this.codes.delete(k);
    const dev = process.env.NODE_ENV !== 'production';
    // TODO: kirim lewat WhatsApp Business API / SMS. Sementara: log server (khusus pengembangan).
    if (dev) this.log.log(`Kode OTP untuk ${phone}: ${code}`);
    return { sent: true, phone, expiresIn: OTP_TTL_MS / 1000, ...(dev ? { devCode: code } : {}) };
  }

  async verifyOtp(rawPhone: string, code: string, name?: string) {
    const phone = phoneOrThrow(rawPhone);
    this.verifyFails.check(phone);
    const entry = this.codes.get(phone);
    const ok = !!entry && entry.exp > Date.now() && entry.tries < OTP_MAX_TRIES && timingSafeEqual(entry.hash, this.hash(phone, code));
    if (!ok) {
      if (entry) entry.tries += 1;
      this.verifyFails.fail(phone);
      throw new UnauthorizedException(entry && entry.exp <= Date.now() ? 'Kode OTP sudah kedaluwarsa, minta kode baru' : 'Kode OTP salah');
    }
    this.codes.delete(phone);
    this.verifyFails.ok(phone);
    const now = new Date();
    const customer = await this.prisma.db.customer.upsert({
      where: { phone },
      update: { phoneVerifiedAt: now, ...(name ? { name } : {}) },
      create: { phone, name: name || null, phoneVerifiedAt: now },
      select: { id: true, phone: true, name: true, pointsBalance: true },
    });
    return { token: sign({ sub: customer.id, typ: 'cust' }, CUSTOMER_TOKEN_TTL), customer };
  }

  /** Token pelanggan → pelanggan (null bila tidak sah). */
  async fromToken(token: string | undefined): Promise<CustomerCtx | null> {
    if (!token) return null;
    const p = verify<{ sub: string; typ: string }>(token);
    if (!p || p.typ !== 'cust') return null;
    const c = await this.prisma.db.customer.findUnique({ where: { id: p.sub }, select: { id: true, phone: true, name: true } });
    return c;
  }
}

const tokenOf = (req: Request): string | undefined => {
  const h = req.headers['x-customer-token'];
  return typeof h === 'string' && h ? h : undefined;
};

/** Rute pelanggan: wajib token (header X-Customer-Token). */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly auth: CustomerAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    const c = await this.auth.fromToken(tokenOf(req));
    if (!c) throw new UnauthorizedException('Silakan masuk dengan nomor WhatsApp');
    req.customer = c;
    return true;
  }
}

/** Rute yang boleh tamu: token pelanggan dipakai bila ada & sah. */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly auth: CustomerAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    const token = tokenOf(req);
    if (token) {
      const c = await this.auth.fromToken(token);
      if (!c) throw new UnauthorizedException('Sesi berakhir, silakan masuk lagi');
      req.customer = c;
    }
    return true;
  }
}

export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerCtx | null => {
  return ctx.switchToHttp().getRequest<CustomerRequest>().customer ?? null;
});

export const ORDER_TOKEN_TTL = 180 * 24 * 3600;
/** Token akses satu pesanan (untuk tamu tanpa akun): tidak bisa ditebak, hanya untuk pesanan itu. */
export const orderToken = (orderId: string): string => sign({ oid: orderId, typ: 'order' }, ORDER_TOKEN_TTL);
export const orderTokenValid = (token: string | undefined, orderId: string): boolean => {
  if (!token) return false;
  const p = verify<{ oid: string; typ: string }>(token);
  return !!p && p.typ === 'order' && p.oid === orderId;
};
