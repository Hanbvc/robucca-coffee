/* Konfigurasi build (diisi saat `next build`, lihat README). */

/** Alamat API NestJS. Produksi: wajib diisi (mis. https://api.robucca.id) dan origin aplikasi ini ada di CORS_ORIGINS API. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** Sub-path hosting (sama dengan basePath di next.config.ts). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

/** Kunci Google Maps (Maps JavaScript API + Places API (New)) untuk mencari alamat delivery.
    Batasi kunci ke domain aplikasi di Google Cloud. Kosong → cari lewat peta biasa + lokasi perangkat. */
export const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

/** Mode demo: alamat & penerima contoh terisi otomatis (seperti prototipe lama). Jangan dipakai di produksi. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

/** Path aset di folder public (foto menu "assets/img/x.jpg", logo) → URL dengan basePath. URL lengkap dibiarkan. */
export function asset(p: string | null | undefined): string {
  if (!p) return '';
  if (/^(https?:|data:|blob:)/.test(p)) return p;
  return `${BASE_PATH}/${p.replace(/^\/+/, '')}`;
}
