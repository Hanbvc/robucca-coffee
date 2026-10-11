'use client';
/* Pilih cabang. Menu, harga, stok, jam buka, delivery, dan reservasi mengikuti cabang pilihan. */
import { Icon } from '@/components/Icon';
import { confirmSheet } from '@/components/Sheets';
import { switchBranch, switchNeedsConfirm } from '@/lib/cart';
import { useBranches } from '@/lib/data';
import { shortAddress } from '@/lib/platform';
import { closeSheet, openSheet } from '@/lib/sheets';
import { getState, useApp } from '@/lib/store';
import { closeOf, dot, isOpen, openOf } from '@/lib/time';
import { toast } from '@/lib/ui';
import type { Branch } from '@/lib/types';

/** Pindah cabang; tanya dulu bila keranjang berisi menu cabang lain. */
export function chooseBranch(b: Branch, then?: () => void): void {
  const done = (): void => {
    switchBranch(b.code);
    toast(`Cabang ${b.name}`, 'store');
    then?.();
  };
  if (!switchNeedsConfirm(b.code)) {
    done();
    return;
  }
  const cur = getState().cartBranch;
  confirmSheet({
    title: 'Ganti cabang?',
    text: `Keranjangmu berisi menu dari cabang ${cur ?? 'lain'}. Harga & stok tiap cabang berbeda, jadi keranjang akan dikosongkan.`,
    ok: 'Ganti cabang',
    onOk: done,
  });
}

function BranchSheet({ then }: { then?: () => void }) {
  const { data: branches, error, reload } = useBranches();
  const { branch } = useApp();
  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>Pilih cabang</h2>
          <p>Menu, harga, stok, dan jam buka mengikuti cabang yang kamu pilih.</p>
        </div>
        <div className="sheet-pad">
          {!branches && !error && <p className="faint">Memuat cabang…</p>}
          {!branches && error && (
            <div className="note-bar">
              <Icon n="info" cls="sm" />
              <span>
                {error}{' '}
                <button className="link" style={{ fontWeight: 600, textDecoration: 'underline' }} onClick={() => void reload()}>
                  Coba lagi
                </button>
              </span>
            </div>
          )}
          {branches?.map((b) => {
            const open = isOpen(b);
            const on = b.code === branch;
            const feats = [b.acceptsPwa ? 'Pick Up' : null, b.acceptsDelivery ? 'Delivery' : null, b.acceptsReservations ? 'Reservasi' : null].filter(Boolean).join(' · ');
            return (
              <button
                key={b.code}
                className={`pay ${on ? 'on' : ''}`}
                role="radio"
                aria-checked={on}
                onClick={() => closeSheet(() => chooseBranch(b, then))}
              >
                <span className="pl" style={{ background: open ? 'var(--olive)' : 'var(--ink)' }}>
                  <Icon n="store" cls="sm" />
                </span>
                <span className="grow">
                  <b>{b.name}</b>
                  <small>{shortAddress(b.address, 60) || 'Alamat belum diisi'}</small>
                  <small>
                    {open ? `Buka · tutup ${dot(closeOf(b))}` : `Tutup · buka ${dot(openOf(b))}`}
                    {feats ? ` · ${feats}` : ''}
                  </small>
                </span>
                <span className="mark" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function openBranchPicker(then?: () => void): void {
  openSheet(<BranchSheet then={then} />);
}
