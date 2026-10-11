'use client';
/* Baris menu, kartu signature, dan tombol tambah (+ / stepper jumlah). Port itemRow()/addCtl() prototipe. */
import { rp } from '@robucca/core';
import type { MouseEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { openItem } from '@/components/sheets/ItemSheet';
import { addToCart, decProduct } from '@/lib/cart';
import { displayPrice, hasOpts } from '@/lib/menu';
import { haptic } from '@/lib/platform';
import type { CartLine } from '@/lib/store';
import type { Product } from '@/lib/types';
import { fly, toast } from '@/lib/ui';

export function qtyMap(cart: CartLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of cart) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

/** Tambah cepat dari daftar: menu dengan pilihan membuka lembar detail. */
export function quickAdd(p: Product, from: Element | null): void {
  if (!p.available) {
    toast(`${p.name} sedang habis`, 'info');
    return;
  }
  if (hasOpts(p)) {
    openItem(p.id);
    return;
  }
  addToCart(p.id, {}, '', 1);
  haptic();
  requestAnimationFrame(() => fly(from, p.imageUrl));
  toast(`${p.name} masuk keranjang`);
}

const stop = (e: MouseEvent): void => e.stopPropagation();

export function AddCtl({ p, n, light = false }: { p: Product; n: number; light?: boolean }) {
  if (!p.available) return <span className="sold">Habis</span>;
  if (!hasOpts(p) && n > 0) {
    return (
      <span className="qty" onClick={stop}>
        <button
          aria-label="Kurangi"
          onClick={() => {
            decProduct(p.id);
          }}
        >
          <Icon n="minus" cls="sm" />
        </button>
        <b>{n}</b>
        <button
          aria-label="Tambah"
          onClick={() => {
            addToCart(p.id, {}, '', 1);
            haptic();
          }}
        >
          <Icon n="plus" cls="sm" />
        </button>
      </span>
    );
  }
  return (
    <button
      className={`add ${light ? 'light' : ''}`}
      aria-label={`Tambah ${p.name}`}
      onClick={(e) => {
        e.stopPropagation();
        const card = (e.currentTarget as Element).closest('.item, .sig');
        quickAdd(p, card?.querySelector('.im') ?? e.currentTarget);
      }}
    >
      {n ? <span className="n">{n}</span> : <Icon n="plus" cls="sm" />}
    </button>
  );
}

export function ItemRow({ p, n }: { p: Product; n: number }) {
  return (
    <div className={`item ${p.available ? '' : 'out'}`} role="button" tabIndex={0} onClick={() => openItem(p.id)}>
      <Pic src={p.imageUrl} name={p.name} />
      <div className="it-b">
        <h3>
          {p.name}
          {p.isSignature && (
            <>
              {' '}
              <span className="star" aria-label="Signature">
                ★
              </span>
            </>
          )}
        </h3>
        {p.description && <p>{p.description}</p>}
        <div className="it-f">
          <span className="pr">{rp(displayPrice(p))}</span>
          <AddCtl p={p} n={n} />
        </div>
      </div>
    </div>
  );
}

export function SigCard({ p, n }: { p: Product; n: number }) {
  return (
    <div className={`sig ${p.available ? '' : 'out'}`} role="button" tabIndex={0} onClick={() => openItem(p.id)}>
      <Pic src={p.imageUrl} name={p.name} />
      <span className="tag dark star">★ Signature</span>
      <b>{p.name}</b>
      <span>{rp(displayPrice(p))}</span>
      <AddCtl p={p} n={n} light />
    </div>
  );
}
