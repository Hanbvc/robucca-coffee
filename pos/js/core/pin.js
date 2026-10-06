/* =========================================================
   Hash PIN karyawan: PBKDF2-HMAC-SHA256 dengan salt per karyawan.
   Memakai WebCrypto bila ada; di konteks tidak aman (http://IP-LAN) WebCrypto
   tidak tersedia, jadi ada implementasi JS murni sebagai cadangan.
   Format simpan: "pbkdf2$<iterasi>$<salt hex>$<hash hex>"

   Catatan keamanan: PIN 4–6 digit hanya punya 10^4–10^6 kemungkinan, jadi hash
   PIN yang tersimpan di perangkat kasir tetap bisa ditebak oleh orang yang menguasai
   perangkat. PIN berfungsi sebagai identitas & akuntabilitas staf di perangkat yang
   sudah dipasangkan; akses kantor pusat diverifikasi server (dengan batas percobaan).
   ========================================================= */
import { randHex } from './ids.js';

export const PIN_ITER = 20000;
export const validPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));

const enc = (s) => new TextEncoder().encode(String(s));
const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));
const toHex = (a) => [...a].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ---------- SHA-256 / HMAC / PBKDF2 dalam JS murni (cadangan) ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const W = new Uint32Array(64);

export function sha256(bytes) {
  const l = bytes.length; const size = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(size); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(size - 4, (l * 8) >>> 0); dv.setUint32(size - 8, Math.floor((l * 8) / 2 ** 32));
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  for (let off = 0; off < size; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]; const b = W[i - 2];
      W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32); const o = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => o.setUint32(i * 4, v >>> 0));
  return out;
}

function hmac(key, msg) {
  let k = key.length > 64 ? sha256(key) : key;
  const kp = new Uint8Array(64); kp.set(k); k = kp;
  const inner = new Uint8Array(64 + msg.length); const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msg, 64); outer.set(sha256(inner), 64);
  return sha256(outer);
}

export function pbkdf2Js(password, salt, iter) {
  const s = new Uint8Array(salt.length + 4); s.set(salt); s[salt.length + 3] = 1; // blok #1 (32 byte cukup)
  let u = hmac(password, s); const t = u.slice();
  for (let i = 1; i < iter; i++) { u = hmac(password, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
  return t;
}

async function pbkdf2(pin, salt, iter) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    try {
      const key = await subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
      return new Uint8Array(bits);
    } catch (e) { /* jatuh ke JS murni */ }
  }
  return pbkdf2Js(enc(pin), salt, iter);
}

export async function hashPin(pin, saltHex = randHex(16), iter = PIN_ITER) {
  const h = await pbkdf2(String(pin), fromHex(saltHex), iter);
  return `pbkdf2$${iter}$${saltHex}$${toHex(h)}`;
}

/** Perbandingan waktu-konstan untuk string hex sepanjang sama */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPin(pin, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2' || !salt || !hash || !validPin(pin)) return false;
  const h = await pbkdf2(String(pin), fromHex(salt), Number(iter) || PIN_ITER);
  return safeEqual(toHex(h), hash);
}

export const sha256Hex = (s) => toHex(sha256(enc(s)));
