/* =========================================================
   Uang (Rupiah) — semua nominal disimpan sebagai bilangan bulat Rupiah.
   Modul bersama: dipakai aplikasi POS (browser) dan server (Node).
   ========================================================= */

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 87000 → "Rp87.000", -5000 → "-Rp5.000" */
export const rp = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + 'Rp' + group(Math.abs(v));
};

/** 87000 → "87.000" (tanpa "Rp") */
export const num = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + group(Math.abs(v));
};

/** Ringkas untuk sumbu grafik: 1250000 → "1,3 jt", 87000 → "87 rb" */
export const short = (n) => {
  const v = Math.abs(Number(n) || 0); const s = n < 0 ? '-' : '';
  if (v >= 1e9) return s + (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (v >= 1e6) return s + (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (v >= 1e3) return s + Math.round(v / 1e3).toLocaleString('id-ID') + ' rb';
  return s + String(Math.round(v));
};

/** "Rp 100.000" / "100.000" / "100000" → 100000 (hanya digit; tanda minus di depan diizinkan) */
export const parse = (s) => {
  const str = String(s ?? '').trim();
  const neg = str.startsWith('-');
  const d = str.replace(/\D/g, '');
  return d ? (neg ? -1 : 1) * parseInt(d, 10) : 0;
};

/** Pembulatan ke kelipatan `unit` (mis. 100). mode: 'nearest' | 'down' | 'up' */
export function roundTo(n, unit = 1, mode = 'nearest') {
  if (!unit || unit <= 1) return Math.round(n) + 0;
  const q = n / unit;
  const r = mode === 'down' ? Math.floor(q + 1e-9) : mode === 'up' ? Math.ceil(q - 1e-9) : Math.round(q);
  return r * unit + 0; // + 0 menormalkan -0
}

/** Persentase dari nominal, dibulatkan ke Rupiah penuh. pct dalam persen (10 = 10%). */
export const pctOf = (base, pct) => Math.round((base * (Number(pct) || 0)) / 100);

/** Persentase untuk tampilan: 10 → "10%", 2.5 → "2,5%" */
export const pctLabel = (p) => `${(Number(p) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
