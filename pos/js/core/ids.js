/* =========================================================
   ID unik & penomoran struk/antrean.
   Nomor struk unik tanpa koordinasi antarperangkat (aman saat offline):
   {KODE CABANG}{NO. TERMINAL}-{YYMMDD}-{URUT 4 DIGIT}  → IJN1-261006-0042
   ========================================================= */

const rnd = (n) => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
};
const hex = (a) => [...a].map((b) => b.toString(16).padStart(2, '0')).join('');

/** UUID v4 (pakai crypto.randomUUID bila tersedia; tidak tersedia di http non-localhost) */
export function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    try { return globalThis.crypto.randomUUID(); } catch (e) { /* konteks tidak aman → fallback */ }
  }
  const b = rnd(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const randHex = (bytes = 16) => hex(rnd(bytes));
/** Kode angka acak (mis. kode pairing 6 digit) */
export function randDigits(n = 6) {
  let out = '';
  while (out.length < n) {
    for (const x of rnd(n * 2)) if (x < 250 && out.length < n) out += String(x % 10); // buang 250..255 agar tidak bias
  }
  return out;
}

export const receiptNo = (branchCode, terminalNo, bizDate, seq) => `${branchCode}${terminalNo}-${bizDate.slice(2).replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

/** Nomor antrean: terminal 1 → "007", terminal 2 → "B007" */
export const queueNo = (terminalNo, seq) => `${terminalNo > 1 ? String.fromCharCode(64 + Math.min(terminalNo, 26)) : ''}${String(seq % 1000).padStart(3, '0')}`;

/** Kode cabang: 2–4 huruf/angka kapital */
export const validBranchCode = (c) => /^[A-Z][A-Z0-9]{1,3}$/.test(String(c || ''));
