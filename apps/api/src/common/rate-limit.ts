import { HttpException, HttpStatus } from '@nestjs/common';

/** Pembatas percobaan sederhana di memori (per proses): kunci diblokir setelah `max` gagal dalam `windowMs`. */
export class RateLimiter {
  private readonly fails = new Map<string, { n: number; until: number; first: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly blockMs: number,
  ) {}

  check(key: string): void {
    const f = this.fails.get(key);
    if (f && f.until > Date.now()) {
      const s = Math.ceil((f.until - Date.now()) / 1000);
      throw new HttpException(`Terlalu banyak percobaan. Coba lagi dalam ${s} detik.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  fail(key: string): void {
    const now = Date.now();
    let f = this.fails.get(key);
    if (!f || now - f.first > this.windowMs) f = { n: 0, until: 0, first: now };
    f.n += 1;
    if (f.n >= this.max) f.until = now + this.blockMs;
    this.fails.set(key, f);
    if (this.fails.size > 10000) this.fails.clear();
  }

  ok(key: string): void {
    this.fails.delete(key);
  }
}
