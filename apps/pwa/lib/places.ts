/* Alamat delivery: saran Google Places (bila NEXT_PUBLIC_GOOGLE_MAPS_KEY diisi), titik dari GPS, atau koordinat/tautan
   Google Maps yang ditempel. Port bagian "cari alamat lewat Google Maps" prototipe. Jarak & ongkir dihitung ulang server. */
import { distanceKm } from '@robucca/core';
import { GMAPS_KEY } from './env';
import { cityOf, gmapsLink, mapEmbed } from './platform';
import type { Addr } from './store';
import type { Branch } from './types';

// --- Alamat & jarak -------------------------------------------------------------------

/** Titik lokasi sudah diketahui (wajib untuk delivery: ongkir dihitung dari titik). */
export const located = (a: Addr): boolean => a.lat != null && a.lng != null;
export const hasAddr = (a: Addr): boolean => a.text.trim().length >= 8 || located(a);

export function addrKm(b: Branch | null | undefined, a: Addr): number | null {
  if (!b || b.lat == null || b.lng == null || a.lat == null || a.lng == null) return null;
  return distanceKm({ lat: b.lat, lng: b.lng }, { lat: a.lat, lng: a.lng });
}

export const isFar = (b: Branch | null | undefined, km: number | null): boolean => km != null && b?.deliveryMaxKm != null && km > b.deliveryMaxKm;

/** Cabang melayani delivery (aktif & titik lokasi cabang sudah diisi — ongkir dihitung dari titik itu). */
export const canDeliver = (b: Branch | null | undefined): boolean => !!b?.acceptsDelivery && b.lat != null && b.lng != null;

/** Judul & keterangan alamat untuk kartu rute. */
export function addrLines(a: Addr): { title: string; sub: string } {
  const t = a.text.trim();
  if (!hasAddr(a)) return { title: 'Pilih alamat pengiriman', sub: 'Cari lewat Google Maps atau pakai lokasimu' };
  const title = a.name || (t ? t.split(',')[0]!.trim() : 'Lokasi saat ini');
  const rest = t.startsWith(title) ? t.slice(title.length).replace(/^[\s,]+/, '') : t;
  const sub = [rest || (t ? '' : 'Titik dari GPS perangkatmu'), a.note].filter(Boolean).join(' · ');
  return { title, sub: sub || t };
}

/** "Jl. A No. 1, Kota" → "Jl. A No. 1" (maks. 30 huruf) */
export const addrHead = (s: string): string => {
  const t = s.split(',')[0]!.trim();
  return t.length > 30 ? `${t.slice(0, 29)}…` : t;
};

/** Peta pratinjau: titik bila ada, selain itu hasil pencarian teks (+ kota cabang). */
export function addrMapSrc(a: Addr, b: Branch | null | undefined): string {
  if (a.lat != null && a.lng != null) return mapEmbed(`${a.lat},${a.lng}`, 17);
  const t = a.text.trim();
  if (t.length < 6) return '';
  const city = cityOf(b?.address);
  return mapEmbed(city && !t.toLowerCase().includes(city.toLowerCase()) ? `${t}, ${city}` : t);
}
export function addrMapLink(a: Addr, b: Branch | null | undefined): string {
  if (a.lat != null && a.lng != null) return gmapsLink(a.lat, a.lng);
  const city = cityOf(b?.address);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.text.trim()}${city ? `, ${city}` : ''}`)}`;
}

/** Koordinat dari teks yang ditempel: "-7.94, 112.62", tautan Google Maps panjang (@lat,lng / q=lat,lng / !3dlat!4dlng). */
export function parseCoords(s: string): { lat: number; lng: number } | null {
  const t = s.trim();
  const pats = [
    /^(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})$/,
    /@(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
    /[?&](?:q|query|ll|daddr|destination)=(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,
  ];
  for (const re of pats) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Tautan pendek (maps.app.goo.gl) tidak bisa dibaca dari browser: minta tautan panjang atau lokasi. */
export const isShortMapsLink = (s: string): boolean => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(s.trim());

// --- Google Places --------------------------------------------------------------------

interface LatLngFn {
  lat: () => number;
  lng: () => number;
}
interface PlaceLike {
  formattedAddress?: string;
  location?: LatLngFn;
  fetchFields: (o: { fields: string[] }) => Promise<unknown>;
}
interface Prediction {
  mainText?: { text: string } | null;
  secondaryText?: { text: string } | null;
  text?: { text: string } | null;
  toPlace: () => PlaceLike;
}
interface PlacesLib {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (r: Record<string, unknown>) => Promise<{ suggestions: { placePrediction?: Prediction | null }[] }>;
  };
}
type GWin = Window & {
  google?: { maps?: { importLibrary?: (n: string) => Promise<unknown> } };
  __gmReady?: () => void;
  gm_authFailure?: () => void;
};

let lib: PlacesLib | null = null;
let loading: Promise<PlacesLib> | null = null;
let failed = false;
let token: object | null = null;
const failSubs = new Set<() => void>();

/** Google Places bisa dipakai (ada kunci & belum gagal). */
export const placesOn = (): boolean => !!GMAPS_KEY && !failed;
/** Dipanggil saat kunci ditolak / gagal dimuat: tampilan jatuh ke peta biasa. */
export const onPlacesFail = (f: () => void): (() => void) => {
  failSubs.add(f);
  return () => failSubs.delete(f);
};
function fail(): void {
  failed = true;
  failSubs.forEach((f) => f());
}

function loadPlaces(): Promise<PlacesLib> {
  if (lib) return Promise.resolve(lib);
  if (!loading) {
    const w = window as GWin;
    loading = new Promise<void>((res, rej) => {
      if (w.google?.maps?.importLibrary) {
        res();
        return;
      }
      w.__gmReady = () => res();
      w.gm_authFailure = fail;
      const sc = document.createElement('script');
      sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GMAPS_KEY)}&loading=async&callback=__gmReady&language=id&region=ID&v=weekly`;
      sc.async = true;
      sc.onerror = () => rej(new Error('Google Maps gagal dimuat'));
      document.head.appendChild(sc);
    })
      .then(() => w.google!.maps!.importLibrary!('places') as Promise<PlacesLib>)
      .then((l) => {
        lib = l;
        return l;
      });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface Sugg {
  main: string;
  sub: string;
  p: Prediction;
}

/** Saran alamat di sekitar cabang. Galat → mode tanpa Google (peta biasa). */
export async function suggest(q: string, b: Branch | null | undefined): Promise<Sugg[]> {
  try {
    const l = await loadPlaces();
    token ??= new l.AutocompleteSessionToken();
    const req: Record<string, unknown> = { input: q, sessionToken: token, includedRegionCodes: ['id'], language: 'id', region: 'id' };
    if (b?.lat != null && b.lng != null) req.locationBias = { center: { lat: b.lat, lng: b.lng }, radius: Math.min(50000, (b.deliveryMaxKm ?? 15) * 1000) };
    const { suggestions } = await l.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return suggestions
      .map((x) => x.placePrediction)
      .filter((pp): pp is Prediction => !!pp)
      .slice(0, 5)
      .map((pp) => ({ p: pp, main: pp.mainText?.text || pp.text?.text || '', sub: pp.secondaryText?.text || '' }));
  } catch {
    fail();
    return [];
  }
}

/** Ambil alamat lengkap & titik dari saran (hanya field SKU Essentials). */
export async function resolve(s: Sugg): Promise<{ text: string; lat: number; lng: number }> {
  const place = s.p.toPlace();
  await place.fetchFields({ fields: ['formattedAddress', 'location'] });
  token = null;
  if (!place.location) throw new Error('Titik lokasi tidak ditemukan');
  return { text: place.formattedAddress || s.main, lat: place.location.lat(), lng: place.location.lng() };
}
