/* Aksi keranjang & tipe pesanan. Keranjang terikat pada satu cabang (harga & stok per cabang). */
import type { Selection } from '@robucca/core';
import { addLine } from './menu';
import { getState, setState, type Mode, type PreRsv } from './store';

export function addToCart(productId: string, sel: Selection, note: string, qty: number): void {
  setState((s) => ({ cart: addLine(s.cart, productId, sel, note, qty), cartBranch: s.cart.length ? s.cartBranch : s.branch }));
}

/** Ganti baris yang diubah (lembar menu dibuka dari keranjang). */
export function replaceLine(key: string, productId: string, sel: Selection, note: string, qty: number): void {
  setState((s) => {
    const idx = s.cart.findIndex((l) => l.key === key);
    const rest = s.cart.filter((l) => l.key !== key);
    const next = addLine(rest, productId, sel, note, qty);
    // Pertahankan urutan: baris yang diubah tetap di posisinya bila tidak digabung dengan baris lain.
    if (idx >= 0 && next.length === rest.length + 1) {
      const moved = next.at(-1)!;
      next.splice(next.length - 1, 1);
      next.splice(idx, 0, moved);
    }
    return { cart: next };
  });
}

export function setLineQty(key: string, qty: number): void {
  setState((s) => ({ cart: qty <= 0 ? s.cart.filter((l) => l.key !== key) : s.cart.map((l) => (l.key === key ? { ...l, qty: Math.min(50, qty) } : l)) }));
}

/** Kurangi satu dari baris terakhir menu ini (tombol − di daftar menu). */
export function decProduct(productId: string): void {
  setState((s) => {
    const l = s.cart.filter((x) => x.productId === productId).at(-1);
    if (!l) return {};
    return { cart: l.qty <= 1 ? s.cart.filter((x) => x !== l) : s.cart.map((x) => (x === l ? { ...x, qty: x.qty - 1 } : x)) };
  });
}

export const clearCart = (): void => setState({ cart: [], cartBranch: null });

/** Pre-order aktif hanya untuk cabang reservasinya. */
export function activePre(): PreRsv | null {
  const s = getState();
  return s.preRsv && s.preRsv.branch === s.branch ? s.preRsv : null;
}

/** Ganti tipe pesanan; pre-order ikut batal. true bila pre-order dibatalkan. */
export function setMode(m: Mode): boolean {
  const had = !!getState().preRsv;
  setState({ mode: m === 'delivery' ? 'delivery' : 'pickup', preRsv: null });
  return had;
}

/** Pindah cabang. Keranjang dari cabang lain dikosongkan (harga & stok berbeda per cabang). */
export function switchBranch(code: string): void {
  setState((s) => {
    if (s.branch === code) return {};
    const keepCart = !s.cart.length || s.cartBranch === code;
    return {
      branch: code,
      ...(keepCart ? {} : { cart: [], cartBranch: null }),
      preRsv: s.preRsv && s.preRsv.branch === code ? s.preRsv : null,
    };
  });
}

/** Perlu konfirmasi sebelum pindah ke cabang ini? (keranjang berisi menu cabang lain) */
export function switchNeedsConfirm(code: string): boolean {
  const s = getState();
  return s.branch !== code && s.cart.length > 0 && s.cartBranch !== code;
}
