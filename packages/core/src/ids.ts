/* ID & penomoran. ID dibuat di perangkat (UUIDv7: urut waktu, aman saat offline).
   Nomor struk unik tanpa koordinasi: {KODE CABANG}{TERMINAL}-{YYMMDD}-{URUT} → IJN1-261006-0042. */

const rnd = (n: number): Uint8Array => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
};
const hex = (a: Uint8Array): string => [...a].map((b) => b.toString(16).padStart(2, '0')).join('');

/** UUID versi 7 (48 bit waktu ms + acak). */
export function uuidv7(now = Date.now()): string {
  const b = rnd(16);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Kode angka acak tanpa bias (mis. kode pairing 6 digit). */
export function randDigits(n = 6): string {
  let out = '';
  while (out.length < n) {
    for (const x of rnd(n * 2)) if (x < 250 && out.length < n) out += String(x % 10);
  }
  return out;
}

/** Kode huruf/angka acak tanpa karakter mirip (0/O, 1/I), mis. kode reservasi. */
export function randCode(n = 4): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  while (out.length < n) {
    for (const x of rnd(n * 2)) if (x < 224 && out.length < n) out += A[x % 32];
  }
  return out;
}

export const receiptNo = (branchCode: string, terminalNo: number, businessDate: string, seq: number): string =>
  `${branchCode}${terminalNo}-${businessDate.slice(2).replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

/** Nomor antrean: terminal 1 → "007", terminal 2 → "B007"; PWA memakai awalan "A". */
export const queueNo = (terminalNo: number, seq: number): string =>
  `${terminalNo > 1 ? String.fromCharCode(64 + Math.min(terminalNo, 26)) : ''}${String(seq % 1000).padStart(3, '0')}`;

/** Kode cabang: 2–4 huruf/angka kapital, diawali huruf. */
export const validBranchCode = (c: unknown): boolean => /^[A-Z][A-Z0-9]{1,3}$/.test(String(c ?? ''));

/** Nomor WhatsApp Indonesia → E.164 tanpa "+": 0812… / +62812… / 62812… → 62812…; null bila tidak valid. */
export function normalizePhone(input: string): string | null {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^628\d{7,12}$/.test(d) ? d : null;
}
