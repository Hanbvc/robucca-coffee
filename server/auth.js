/* Token perangkat, sesi staf, kode pasang, dan pembatas percobaan (rate limit). */
import crypto from 'node:crypto';

export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const token = (prefix) => `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
export function code6() {
  // 6 digit tanpa bias modulo
  let out = '';
  while (out.length < 6) { const b = crypto.randomBytes(8); for (const x of b) if (x < 250 && out.length < 6) out += String(x % 10); }
  return out;
}

/** Hash PIN dari perangkat harus berformat kita & iterasi wajar (mencegah DoS verifikasi) */
export const validPinHash = (h) => {
  const m = /^pbkdf2\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(String(h || ''));
  return !!m && +m[1] >= 1000 && +m[1] <= 200000;
};

/** Pembatas percobaan sederhana di memori: max `n` kegagalan per `ms` per kunci */
export class Limiter {
  constructor(n, ms) { this.n = n; this.ms = ms; this.map = new Map(); }
  blocked(key) {
    const e = this.map.get(key);
    if (!e) return 0;
    if (e.until && e.until > Date.now()) return Math.ceil((e.until - Date.now()) / 1000);
    if (e.until && e.until <= Date.now()) this.map.delete(key);
    return 0;
  }
  fail(key) {
    const now = Date.now();
    const e = this.map.get(key) || { hits: [], until: 0 };
    e.hits = e.hits.filter((t) => now - t < this.ms);
    e.hits.push(now);
    if (e.hits.length >= this.n) { e.until = now + this.ms; e.hits = []; }
    this.map.set(key, e);
  }
  ok(key) { this.map.delete(key); }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if ((!e.until || e.until < now) && !e.hits.some((t) => now - t < this.ms)) this.map.delete(k); }
}
