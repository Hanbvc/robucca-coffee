/* "Pesan lagi": menu & pilihan pesanan lama dimasukkan lagi ke keranjang, dengan harga & stok menu cabang saat ini. */
import { defaultSelection, selectionErrors, type Selection } from '@robucca/core';
import { chooseBranch } from '@/components/sheets/BranchSheet';
import { errText } from './api';
import { addToCart } from './cart';
import { branchOf, loadMenu } from './data';
import { cleanSel, indexMenu } from './menu';
import { getState, setState } from './store';
import type { PublicOrder } from './types';
import { toast } from './ui';

export function reorder(o: PublicOrder, go: (path: string) => void): void {
  const code = o.branch.code;
  const run = async (): Promise<void> => {
    let idx;
    try {
      idx = indexMenu(await loadMenu(code));
    } catch (e) {
      toast(errText(e), 'info');
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const it of o.items) {
      const hit = it.productId ? idx.products.get(it.productId) : undefined;
      if (!hit || !hit.p.available) {
        skipped += it.quantity;
        continue;
      }
      const p = hit.p;
      // Pilihan lama per grup; grup baru/wajib yang kosong memakai pilihan bawaan menu sekarang.
      const old: Selection = {};
      for (const g of p.modifierGroups) {
        const ids = it.optionIds.filter((id) => g.options.some((x) => x.id === id));
        if (ids.length) old[g.id] = ids;
      }
      const sel = cleanSel(p, { ...defaultSelection(p), ...old });
      if (selectionErrors(p, sel).length) {
        skipped += it.quantity;
        continue;
      }
      addToCart(p.id, sel, it.note ?? '', it.quantity);
      added += it.quantity;
    }
    if (!added) {
      toast('Menu pesanan ini sedang tidak tersedia', 'info');
      return;
    }
    setState({ mode: o.type === 'DELIVERY' ? 'delivery' : 'pickup', preRsv: null });
    go('/checkout/');
    setTimeout(() => toast(`${added} item ditambahkan ke keranjang${skipped ? ` · ${skipped} sedang habis` : ''}`), 250);
  };
  if (getState().branch === code) {
    void run();
    return;
  }
  const b = branchOf(code);
  if (!b) {
    toast('Cabang pesanan ini sudah tidak menerima pesanan', 'info');
    return;
  }
  chooseBranch(b, () => void run());
}
