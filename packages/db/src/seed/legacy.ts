/* Membaca data menu & toko dari aplikasi pelanggan lama (js/data.js) tanpa menjalankannya
   di browser: dievaluasi di sandbox `vm` dengan objek `window` kosong (sama seperti server/data-loader.js). */
import fs from 'node:fs';
import vm from 'node:vm';

export interface LegacyChoice {
  n: string;
  p?: number;
  img?: string;
}

export interface LegacyOptionGroup {
  id: string;
  name: string;
  type: 'single' | 'multi';
  required?: boolean;
  def?: string;
  choices: LegacyChoice[];
  /** Grup hanya tampil bila grup lain memilih salah satu nama ini, mis. { size: ["Iced · Regular", "Iced · Large"] }. */
  showIf?: Record<string, string[]>;
}

export interface LegacyItem {
  id: string;
  name: string;
  price: number;
  img?: string | null;
  sig?: boolean;
  desc?: string;
  opts?: LegacyOptionGroup[];
}

export interface LegacyCategory {
  id: string;
  name: string;
  group?: string;
  notes?: string[];
  items: LegacyItem[];
}

export interface LegacyCourier {
  id: string;
  name: string;
  by: string;
  base: number;
  perKm: number;
  min: number;
}

export interface LegacyConfig {
  storeName?: string;
  branch?: string;
  tagline?: string;
  address?: string;
  phoneDisplay?: string;
  handle?: string;
  lat?: number;
  lng?: number;
  open?: string;
  close?: string;
  maxGuests?: number;
  areas?: { v: string }[];
  delivery?: { maxKm?: number; couriers?: LegacyCourier[] };
}

export interface LegacyBanner {
  img: string;
  cat?: string;
  label: string;
  pos?: string;
}

export interface LegacyData {
  MENU: LegacyCategory[];
  CONFIG: LegacyConfig;
  BANNERS: LegacyBanner[];
}

export function loadLegacyData(file: string): LegacyData {
  const ctx: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file, timeout: 2000 });
  const w = ctx.window;
  if (!Array.isArray(w.MG_MENU)) throw new Error(`MG_MENU tidak ditemukan di ${file}`);
  // Salin keluar dari konteks vm agar menjadi objek biasa.
  return JSON.parse(JSON.stringify({ MENU: w.MG_MENU, CONFIG: w.MG_CONFIG ?? {}, BANNERS: w.MG_BANNERS ?? [] })) as LegacyData;
}
