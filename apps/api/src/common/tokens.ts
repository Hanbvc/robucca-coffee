import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (prefix: string): string => `${prefix}_${randomBytes(32).toString('base64url')}`;

let secret: Buffer | null = null;
function key(): Buffer {
  if (secret) return secret;
  const env = process.env.AUTH_SECRET;
  if (env && env.length >= 32) secret = Buffer.from(env);
  else if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET (min. 32 karakter) wajib diisi di produksi');
  else {
    // Dev: sesi hilang saat server dimulai ulang.
    secret = randomBytes(32);
    console.warn('[auth] AUTH_SECRET kosong: memakai kunci acak sementara (khusus pengembangan).');
  }
  return secret;
}

/** Token bertanda tangan HMAC: base64url(payload).base64url(sig). */
export function sign(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const sig = createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verify<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', key()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return typeof p.exp === 'number' && p.exp * 1000 > Date.now() ? p : null;
  } catch {
    return null;
  }
}
