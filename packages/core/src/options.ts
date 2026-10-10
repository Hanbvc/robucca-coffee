/* Opsi menu (modifier): pilihan bawaan, grup bersyarat, validasi, harga, dan ringkasan untuk struk/dapur.
   Bentuk data sama dengan respons API GET /branches/:kode/menu. */
import { channelPrice } from './calc.js';
import { num } from './money.js';

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  imageUrl?: string | null;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  selection: 'SINGLE' | 'MULTIPLE';
  isRequired: boolean;
  maxSelect?: number | null;
  /** Grup hanya tampil bila salah satu opsi ini dipilih. Kosong = selalu tampil. */
  showWhenOptionIds: string[];
  options: MenuOption[];
}

export interface MenuProduct {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  modifierGroups: MenuModifierGroup[];
}

/** Pilihan per grup: id grup → id opsi yang dipilih. */
export type Selection = Record<string, string[]>;

export interface ChosenModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

const selectedIds = (sel: Selection): Set<string> => new Set(Object.values(sel).flat());

export function groupVisible(g: MenuModifierGroup, sel: Selection): boolean {
  if (!g.showWhenOptionIds.length) return true;
  const chosen = selectedIds(sel);
  return g.showWhenOptionIds.some((id) => chosen.has(id));
}

/** Pilihan bawaan: opsi bawaan, atau opsi pertama untuk grup tunggal yang tidak wajib. */
export function defaultSelection(p: MenuProduct): Selection {
  const sel: Selection = {};
  for (const g of p.modifierGroups) {
    const defs = g.options.filter((o) => o.isDefault).map((o) => o.id);
    if (g.selection === 'MULTIPLE') sel[g.id] = defs;
    else if (defs.length) sel[g.id] = [defs[0]!];
    else if (!g.isRequired && g.options.length) sel[g.id] = [g.options[0]!.id];
    else sel[g.id] = [];
  }
  return sel;
}

/** Nama grup wajib yang belum dipilih / pilihan melebihi batas. Kosong = valid. */
export function selectionErrors(p: MenuProduct, sel: Selection): string[] {
  const errors: string[] = [];
  for (const g of p.modifierGroups) {
    if (!groupVisible(g, sel)) continue;
    const picked = (sel[g.id] ?? []).filter((id) => g.options.some((o) => o.id === id));
    if (g.isRequired && picked.length === 0) errors.push(`${g.name} wajib dipilih`);
    if (g.selection === 'SINGLE' && picked.length > 1) errors.push(`${g.name}: pilih satu`);
    if (g.selection === 'MULTIPLE' && g.maxSelect && picked.length > g.maxSelect) errors.push(`${g.name}: maksimal ${g.maxSelect}`);
  }
  for (const gid of Object.keys(sel)) {
    if (!p.modifierGroups.some((g) => g.id === gid) && (sel[gid] ?? []).length) errors.push('Pilihan tidak dikenal');
  }
  return errors;
}

/** Pilihan yang berlaku (grup tersembunyi diabaikan), urut sesuai menu. */
export function chosenModifiers(p: MenuProduct, sel: Selection): ChosenModifier[] {
  const out: ChosenModifier[] = [];
  for (const g of p.modifierGroups) {
    if (!groupVisible(g, sel)) continue;
    const ids = new Set(sel[g.id] ?? []);
    for (const o of g.options) {
      if (ids.has(o.id)) out.push({ groupId: g.id, groupName: g.name, optionId: o.id, optionName: o.name, priceDelta: o.priceDelta });
    }
  }
  return out;
}

/** Ringkasan untuk struk/dapur. Pilihan bawaan grup tunggal opsional tidak ditampilkan (mis. "Normal"). */
export function modifiersSummary(p: MenuProduct, mods: ChosenModifier[]): string {
  return mods
    .filter((m) => {
      const g = p.modifierGroups.find((x) => x.id === m.groupId);
      if (!g || g.isRequired || g.selection === 'MULTIPLE') return true;
      const def = g.options.find((o) => o.isDefault) ?? g.options[0];
      return def?.id !== m.optionId;
    })
    .map((m) => {
      const g = p.modifierGroups.find((x) => x.id === m.groupId);
      return g?.selection === 'MULTIPLE' ? `+ ${m.optionName}` : m.optionName;
    })
    .join(' · ');
}

/** Foto menu mengikuti opsi yang dipilih (mis. versi Hot). */
export function productImage(p: MenuProduct, sel: Selection): string | null {
  for (const m of chosenModifiers(p, sel)) {
    const o = p.modifierGroups.find((g) => g.id === m.groupId)?.options.find((x) => x.id === m.optionId);
    if (o?.imageUrl) return o.imageUrl;
  }
  return p.imageUrl ?? null;
}

/** Harga satuan: harga cabang + opsi, lalu markup kanal. */
export function unitPrice(p: MenuProduct, sel: Selection, markupBp = 0): number {
  const base = p.price + chosenModifiers(p, sel).reduce((a, m) => a + m.priceDelta, 0);
  return channelPrice(base, markupBp);
}

/** Kunci penggabungan baris di keranjang: menu, pilihan, catatan, dan harga sama → digabung. */
export function lineKey(productId: string, sel: Selection, note: string, price: number): string {
  const s = Object.keys(sel)
    .sort()
    .map((k) => [k, [...(sel[k] ?? [])].sort()]);
  return `${productId}|${JSON.stringify(s)}|${note.trim().toLowerCase()}|${price}`;
}

/** Keterangan pilihan berharga untuk pelanggan, mis. ["Iced · Large +4.000", "Hot +2.000"]. */
export function optionNotes(p: MenuProduct, max = 4): string[] {
  const out: string[] = [];
  for (const g of p.modifierGroups) {
    const priced = g.options.some((o) => o.priceDelta > 0);
    const show = g.selection === 'MULTIPLE' ? priced : (g.isRequired || priced) && g.options.length > 1;
    if (!show) continue;
    const def = g.selection === 'MULTIPLE' ? null : (g.options.find((o) => o.isDefault) ?? g.options[0]);
    for (const o of g.options) {
      if (o.id === def?.id) continue;
      out.push(o.priceDelta > 0 ? `${o.name} +${num(o.priceDelta)}` : o.name);
    }
  }
  return out.slice(0, max);
}
