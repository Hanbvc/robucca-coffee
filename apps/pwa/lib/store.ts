/* State aplikasi di perangkat (localStorage), dibaca komponen lewat useApp().
   Pesanan & reservasi tamu disimpan sebagai referensi {id, token}; datanya selalu dari server. */
import type { Selection } from '@robucca/core';
import { useSyncExternalStore } from 'react';

export type Mode = 'pickup' | 'delivery';

export interface CartLine {
  key: string;
  productId: string;
  sel: Selection;
  note: string;
  qty: number;
}

export interface Addr {
  /** Nama tempat singkat (dari Google Maps / alamat tersimpan). */
  name: string;
  text: string;
  note: string;
  lat: number | null;
  lng: number | null;
  /** Alamat tersimpan di akun yang dipakai. */
  savedId?: string | null;
}

export interface Profile {
  name: string;
  phone: string;
}

export interface Auth {
  token: string;
  phone: string;
  name: string | null;
}

export interface Ref {
  id: string;
  token: string;
  at: number;
}

export interface PreRsv {
  id: string;
  token: string;
  code: string;
  reservedFor: string;
  guests: number;
  branch: string;
}

export interface RsvDraft {
  date: string;
  time: string | null;
  guests: number;
  area: string;
  occ: string;
  note: string;
}

export interface State {
  /** Cabang pilihan (kode). */
  branch: string | null;
  /** Cabang tempat isi keranjang dipilih (harga & stok per cabang). */
  cartBranch: string | null;
  cart: CartLine[];
  mode: Mode;
  preRsv: PreRsv | null;
  addr: Addr;
  courier: string;
  pay: string;
  profile: Profile;
  auth: Auth | null;
  orders: Ref[];
  rsvs: Ref[];
  rd: RsvDraft | null;
  iosTipOff: boolean;
}

const KEY = 'rbc:v1';
export const EMPTY_ADDR: Addr = { name: '', text: '', note: '', lat: null, lng: null, savedId: null };
const INITIAL: State = {
  branch: null,
  cartBranch: null,
  cart: [],
  mode: 'pickup',
  preRsv: null,
  addr: EMPTY_ADDR,
  courier: 'gosend',
  pay: 'qris',
  profile: { name: '', phone: '' },
  auth: null,
  orders: [],
  rsvs: [],
  rd: null,
  iosTipOff: false,
};

let state: State = INITIAL;
let loaded = false;
const listeners = new Set<() => void>();

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<State>;
      return {
        ...INITIAL,
        ...s,
        addr: { ...EMPTY_ADDR, ...s.addr },
        profile: { ...INITIAL.profile, ...s.profile },
        cart: Array.isArray(s.cart) ? s.cart : [],
        orders: Array.isArray(s.orders) ? s.orders : [],
        rsvs: Array.isArray(s.rsvs) ? s.rsvs : [],
        mode: s.mode === 'delivery' ? 'delivery' : 'pickup',
      };
    }
    // Pertama kali: bawa nama & WhatsApp dari prototipe lama (mg_profile) bila ada.
    const old = JSON.parse(localStorage.getItem('mg_profile') || 'null') as Partial<Profile> | null;
    if (old && (old.name || old.phone)) return { ...INITIAL, profile: { name: String(old.name ?? ''), phone: String(old.phone ?? '') } };
  } catch {
    /* penyimpanan diblokir / rusak: mulai kosong */
  }
  return INITIAL;
}

let saveT: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* penyimpanan penuh / diblokir */
    }
  }, 60);
}

function ensure(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  state = read();
  // Tab lain mengubah data (mis. pesanan baru): ikut diperbarui.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = read();
    listeners.forEach((l) => l());
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(saveT);
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* noop */
    }
  });
}

export function getState(): State {
  ensure();
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const cur = getState();
  const p = typeof patch === 'function' ? patch(cur) : patch;
  state = { ...cur, ...p };
  persist();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** State lengkap. Saat prerender & hidrasi bernilai awal (kosong), lalu langsung diganti isi perangkat. */
export function useApp(): State {
  return useSyncExternalStore(subscribe, getState, () => INITIAL);
}

/** true setelah komponen berjalan di browser (data perangkat sudah terbaca). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** Simpan referensi pesanan/reservasi (terbaru di depan, maks. 60). */
export function addRef(kind: 'orders' | 'rsvs', id: string, token: string): void {
  setState((s) => ({ [kind]: [{ id, token, at: Date.now() }, ...s[kind].filter((r) => r.id !== id)].slice(0, 60) }));
}

export function tokenOf(kind: 'orders' | 'rsvs', id: string): string | undefined {
  return getState()[kind].find((r) => r.id === id)?.token;
}

/** Hapus semua data aplikasi di perangkat ini (termasuk data prototipe lama mg_*). */
export function wipe(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k === KEY || k.startsWith('rbc:') || k.startsWith('mg_')) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch {
    /* noop */
  }
  state = INITIAL;
  clearTimeout(saveT);
  listeners.forEach((l) => l());
}
