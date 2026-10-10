/* Delivery kurir (GoSend / GrabExpress) dari PWA: jarak & ongkir perkiraan.
   Port dari js/app.js lama (distKm, dlvFee, dlvEta). Dihitung di PWA untuk tampilan,
   lalu dihitung ulang server sebelum pesanan disimpan. Tarif final nanti dari API kurir. */

/** Jarak garis lurus × faktor jalan (perkiraan jarak tempuh). */
export const ROAD_FACTOR = 1.3;
/** Ongkir dibulatkan ke atas ke kelipatan ini. */
export const DELIVERY_FEE_ROUND = 500;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CourierTariff {
  baseFee: number;
  perKmFee: number;
  minFee: number;
}

/** Perkiraan jarak jalan (km, 1 desimal) dari toko ke alamat tujuan. */
export function distanceKm(from: LatLng, to: LatLng, roadFactor = ROAD_FACTOR): number {
  const R = 6371;
  const rad = (x: number): number => (x * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * roadFactor * 10) / 10;
}

/** Ongkir = maks(minimum, dasar + per km × jarak), dibulatkan ke atas ke Rp500. */
export function deliveryFee(c: CourierTariff, km: number): number {
  return Math.ceil(Math.max(c.minFee, c.baseFee + c.perKmFee * km) / DELIVERY_FEE_ROUND) * DELIVERY_FEE_ROUND;
}

/** Perkiraan tiba (menit): waktu siap + jemput + perjalanan. */
export const deliveryEtaMinutes = (km: number, prepMinutes = 15): number => prepMinutes + 10 + Math.ceil(km * 3);
