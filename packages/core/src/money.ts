/* Uang (Rupiah): semua nominal bilangan bulat Rupiah. Persentase dalam basis poin (1000 = 10%). */

export type RoundingMode = 'DOWN' | 'NEAREST' | 'UP';

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 87000 → "Rp87.000", -5000 → "-Rp5.000" */
export function rp(n: number): string {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + 'Rp' + group(Math.abs(v));
}

/** 87000 → "87.000" (tanpa "Rp") */
export function num(n: number): string {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + group(Math.abs(v));
}

/** Ringkas untuk sumbu grafik: 1250000 → "1,3 jt", 87000 → "87 rb" */
export function short(n: number): string {
  const v = Math.abs(Number(n) || 0);
  const s = n < 0 ? '-' : '';
  if (v >= 1e9) return s + (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (v >= 1e6) return s + (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (v >= 1e3) return s + Math.round(v / 1e3).toLocaleString('id-ID') + ' rb';
  return s + String(Math.round(v));
}

/** "Rp 100.000" / "100.000" / "100000" → 100000 (hanya digit; minus di depan diizinkan) */
export function parse(s: unknown): number {
  const str = String(s ?? '').trim();
  const neg = str.startsWith('-');
  const d = str.replace(/\D/g, '');
  return d ? (neg ? -1 : 1) * parseInt(d, 10) : 0;
}

/** Pembulatan ke kelipatan `unit` (mis. 100). */
export function roundTo(n: number, unit = 1, mode: RoundingMode = 'NEAREST'): number {
  if (!unit || unit <= 1) return Math.round(n) + 0;
  const q = n / unit;
  const r = mode === 'DOWN' ? Math.floor(q + 1e-9) : mode === 'UP' ? Math.ceil(q - 1e-9) : Math.round(q);
  return r * unit + 0; // + 0 menormalkan -0
}

/** Bagian `bp` basis poin dari nominal, dibulatkan ke Rupiah penuh. */
export const bpOf = (base: number, bp: number): number => Math.round((base * (Number(bp) || 0)) / 10000);

/** Persen ↔ basis poin: 10 → 1000, 7.5 → 750 */
export const pctToBp = (pct: number): number => Math.round((Number(pct) || 0) * 100);
export const bpToPct = (bp: number): number => (Number(bp) || 0) / 100;

/** Basis poin untuk tampilan: 1000 → "10%", 250 → "2,5%" */
export const bpLabel = (bp: number): string =>
  `${bpToPct(bp).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
