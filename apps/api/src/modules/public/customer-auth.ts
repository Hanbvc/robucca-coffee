/* Identitas pelanggan PWA: nomor WhatsApp + OTP 6 digit → token pelanggan (HMAC, 90 hari).
   - Kode disimpan di tabel CustomerOtp sebagai HMAC berkunci AUTH_SECRET (tidak pernah teks biasa), berlaku 5 menit,
     sekali pakai, hangus setelah 5 percobaan. Bertahan saat API dimulai ulang dan berlaku lintas instance.
   - Permintaan kode dibatasi per nomor & per IP, tebakan salah per nomor (pembatas di memori: per instance API).
   - Pengiriman: OTP_WEBHOOK_URL (gateway WhatsApp/SMS pilihan Robucca) menerima POST JSON {phone, code, message}.
     Di luar produksi kode juga dicetak ke log dan dikembalikan sebagai devCode agar bisa dicoba.
     Di produksi tanpa webhook, masuk dengan WhatsApp dimatikan (503); pelanggan tetap bisa memesan sebagai tamu. */
import {
  BadGatewayException, BadRequestException, type CanActivate, createParamDecorator, type ExecutionContext, Injectable, Logger,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { normalizePhone, randDigits } from '@robucca/core';
import { Prisma } from '@robucca/db';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { RateLimiter } from '../../common/rate-limit';
import { keyedHash, sign, verify } from '../../common/tokens';
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
  private readonly dev = process.env.NODE_ENV !== 'production';
  private readonly webhook = process.env.OTP_WEBHOOK_URL || '';
  /** Permintaan kode: 3 per nomor per 10 menit, 10 per IP per 10 menit. */
  private readonly perPhone = new RateLimiter(3, 10 * 60_000, 10 * 60_000);
  private readonly perIp = new RateLimiter(Number(process.env.PUBLIC_OTP_IP_LIMIT) || 10, 10 * 60_000, 10 * 60_000);
  /** Verifikasi salah: 5 per nomor per 15 menit. */
  private readonly verifyFails = new RateLimiter(OTP_MAX_TRIES, 15 * 60_000, 15 * 60_000);
  private requests = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Masuk dengan WhatsApp tersedia (ada pengirim kode, atau mode pengembangan). */
  get available(): boolean {
    return this.dev || !!this.webhook;
  }

  private hash(phone: string, code: string): string {
    return keyedHash('otp', `${phone}:${code}`);
  }

  async requestOtp(rawPhone: string, ip: string): Promise<{ sent: true; phone: string; expiresIn: number; devCode?: string }> {
    if (!this.available) throw new ServiceUnavailableException('Masuk dengan WhatsApp belum tersedia. Kamu tetap bisa memesan sebagai tamu.');
    const phone = phoneOrThrow(rawPhone);
    hit(this.perIp, ip);
    hit(this.perPhone, phone);
    const code = randDigits(6);
    const row = { codeHash: this.hash(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0, createdAt: new Date() };
    await this.prisma.db.customerOtp.upsert({ where: { phone }, update: row, create: { phone, ...row } });
    // Bersih-bersih kode lama sesekali (tabel kecil: satu baris per nomor, dihapus saat dipakai).
    if (++this.requests % 100 === 0) await this.prisma.db.customerOtp.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3600e3) } } });
    if (this.webhook) await this.deliver(phone, code, row.codeHash);
    if (this.dev) this.log.log(`Kode OTP untuk ${phone}: ${code}`);
    return { sent: true, phone, expiresIn: OTP_TTL_MS / 1000, ...(this.dev ? { devCode: code } : {}) };
  }

  /** Kirim kode lewat webhook gateway. Gagal → kode dihapus (tidak ada kode yatim yang bisa ditebak). */
  private async deliver(phone: string, code: string, codeHash: string): Promise<void> {
    const message = `Kode masuk Robucca: ${code}. Berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`;
    try {
      const r = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.OTP_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.OTP_WEBHOOK_SECRET}` } : {}) },
        body: JSON.stringify({ phone, code, message }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      this.log.warn(`Gagal mengirim OTP ke ${phone.slice(0, 5)}…: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.db.customerOtp.deleteMany({ where: { phone, codeHash } });
      throw new BadGatewayException('Kode belum bisa dikirim ke WhatsApp. Coba lagi sebentar lagi.');
    }
  }

  async verifyOtp(rawPhone: string, code: string, name?: string) {
    const phone = phoneOrThrow(rawPhone);
    this.verifyFails.check(phone);
    const now = new Date();
    // Setiap percobaan memakai satu jatah secara atomik (aman bila ada tebakan bersamaan).
    let row: { codeHash: string } | null = null;
    try {
      row = await this.prisma.db.customerOtp.update({
        where: { phone, attempts: { lt: OTP_MAX_TRIES }, expiresAt: { gt: now } },
        data: { attempts: { increment: 1 } },
        select: { codeHash: true },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e;
    }
    const given = Buffer.from(this.hash(phone, code), 'hex');
    const ok = !!row && timingSafeEqual(Buffer.from(row.codeHash, 'hex'), given);
    // Sekali pakai: hanya satu verifikasi yang berhasil menghapus baris kode ini.
    const used = ok && (await this.prisma.db.customerOtp.deleteMany({ where: { phone, codeHash: row!.codeHash } })).count === 1;
    if (!used) {
      this.verifyFails.fail(phone);
      if (!row) {
        const cur = await this.prisma.db.customerOtp.findUnique({ where: { phone }, select: { expiresAt: true, attempts: true } });
        if (cur && cur.expiresAt <= now) throw new UnauthorizedException('Kode OTP sudah kedaluwarsa, minta kode baru');
        if (cur && cur.attempts >= OTP_MAX_TRIES) throw new UnauthorizedException('Terlalu banyak percobaan, minta kode baru');
      }
      throw new UnauthorizedException('Kode OTP salah');
    }
    this.verifyFails.ok(phone);
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

/** Token akses satu reservasi (tamu tanpa akun): lihat, batalkan, dan pre-order untuk reservasi itu saja. */
export const reservationToken = (id: string): string => sign({ rid: id, typ: 'rsv' }, ORDER_TOKEN_TTL);
export const reservationTokenValid = (token: string | undefined, id: string): boolean => {
  if (!token) return false;
  const p = verify<{ rid: string; typ: string }>(token);
  return !!p && p.typ === 'rsv' && p.rid === id;
};
