/* Menu cabang & keranjang. Harga, opsi, dan total memakai @robucca/core — sama persis dengan hitungan server,
   sehingga total yang tampil = total yang disimpan (server menolak bila beda). */
import {
  calcOrder, chosenModifiers, defaultSelection, lineKey, modifiersSummary, productImage, unitPrice, type OrderTotals, type Selection, type TaxConfig,
} from '@robucca/core';
import { CONTENT } from './content';
import type { CartLine } from './store';
import type { Category, Menu, Product } from './types';

export interface MenuIndex {
  menu: Menu;
  products: Map<string, { p: Product; c: Category }>;
  cats: Category[];
  bySlug: Map<string, Category>;
  byId: Map<string, Category>;
}

const cache = new WeakMap<Menu, MenuIndex>();

export function indexMenu(menu: Menu): MenuIndex {
  const hit = cache.get(menu);
  if (hit) return hit;
  const products = new Map<string, { p: Product; c: Category }>();
  const bySlug = new Map<string, Category>();
  const byId = new Map<string, Category>();
  for (const c of menu.categories) {
    byId.set(c.id, c);
    if (c.slug) bySlug.set(c.slug, c);
    for (const p of c.products) products.set(p.id, { p, c });
  }
  const idx = { menu, products, cats: menu.categories, bySlug, byId };
  cache.set(menu, idx);
  return idx;
}

/** Kunci kategori di URL & jangkar (?cat=coffee). */
export const catKey = (c: Category): string => c.slug ?? c.id;
export const findCat = (idx: MenuIndex, key: string | null | undefined): Category | undefined => (key ? (idx.bySlug.get(key) ?? idx.byId.get(key)) : undefined);

export const hasOpts = (p: Product): boolean => p.modifierGroups.length > 0;

/** Pilihan bersih: hanya grup yang tampil, urut sesuai menu (untuk kunci keranjang & dikirim ke server). */
export function cleanSel(p: Product, sel: Selection): Selection {
  const out: Selection = {};
  for (const m of chosenModifiers(p, sel)) (out[m.groupId] ??= []).push(m.optionId);
  return out;
}

export const keyOf = (productId: string, sel: Selection, note: string): string => lineKey(productId, sel, note, 0);

export function addLine(cart: CartLine[], productId: string, sel: Selection, note: string, qty: number): CartLine[] {
  const key = keyOf(productId, sel, note);
  const ex = cart.find((l) => l.key === key);
  if (ex) return cart.map((l) => (l === ex ? { ...l, qty: Math.min(50, l.qty + qty) } : l));
  return [...cart, { key, productId, sel, note: note.trim(), qty }];
}

export const qtyOf = (cart: CartLine[], productId: string): number => cart.filter((l) => l.productId === productId).reduce((a, l) => a + l.qty, 0);

export interface LineView {
  line: CartLine;
  p: Product | null;
  c: Category | null;
  name: string;
  unit: number;
  total: number;
  summary: string;
  image: string | null;
  /** Kenapa baris tidak bisa dipesan (menu dihapus / habis / opsi berubah). */
  problem: string | null;
}

export function viewCart(cart: CartLine[], idx: MenuIndex | null): LineView[] {
  return cart.map((line) => {
    const hit = idx?.products.get(line.productId);
    if (!hit) {
      return { line, p: null, c: null, name: 'Menu tidak tersedia', unit: 0, total: 0, summary: '', image: null, problem: idx ? 'Menu ini sudah tidak tersedia' : null };
    }
    const { p, c } = hit;
    const unit = unitPrice(p, line.sel);
    const mods = chosenModifiers(p, line.sel);
    const known = Object.values(line.sel).flat().every((id) => p.modifierGroups.some((g) => g.options.some((o) => o.id === id)));
    return {
      line, p, c, name: p.name, unit, total: unit * line.qty,
      summary: modifiersSummary(p, mods),
      image: productImage(p, line.sel),
      problem: !p.available ? 'Sedang habis' : !known ? 'Pilihan menu berubah, ubah lagi' : null,
    };
  });
}

export const cartCount = (cart: CartLine[]): number => cart.reduce((a, l) => a + l.qty, 0);

/** Total keranjang dengan konfigurasi pajak cabang (+ ongkir). */
export function cartTotals(views: LineView[], cfg: TaxConfig | null | undefined, deliveryFee = 0): OrderTotals {
  return calcOrder({ lines: views.filter((v) => v.p).map((v) => ({ id: v.line.key, unitPrice: v.unit, quantity: v.line.qty })), deliveryFee }, cfg ?? null).totals;
}

/** Harga tampil di daftar menu: harga dasar + opsi bawaan (mis. ukuran Regular). */
export const displayPrice = (p: Product): number => unitPrice(p, defaultSelection(p));

/** Contoh catatan sesuai jenis menu. */
export const notePlaceholder = (c: Category | null): string =>
  c?.group === 'DRINKS' ? 'es dipisah' : c?.group === 'PASTRY' ? 'dibungkus terpisah' : 'tidak pakai daun bawang';

/** Pencarian menu: semua kata harus ada di nama/keterangan/kategori (tanpa beda huruf & aksen). */
export const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function searchMenu(idx: MenuIndex, q: string): Product[] {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out: Product[] = [];
  for (const { p, c } of idx.products.values()) {
    const hay = norm(`${p.name} ${p.description ?? ''} ${c.name} ${c.description ?? ''}`);
    if (toks.every((t) => hay.includes(t))) out.push(p);
  }
  return out;
}

/** Catatan harga di bawah menu: pajak cabang (termasuk / belum termasuk), atau catatan umum. */
export function priceNote(menu: Menu | undefined): string {
  const t = menu?.taxConfig;
  const label = menu?.branch.taxLabel || 'pajak';
  if (t && t.taxRateBp > 0) return t.taxInclusive ? `Harga sudah termasuk ${label}.` : `Harga belum termasuk ${label} ${t.taxRateBp / 100}%.`;
  return CONTENT.priceNote;
}
