'use client';
/* Cari menu cabang (nama, keterangan, kategori). Port openSearch(). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ItemRow, qtyMap } from '@/components/MenuParts';
import { CONTENT } from '@/lib/content';
import { useMenu } from '@/lib/data';
import { searchMenu } from '@/lib/menu';
import { focusLater, primeKeyboard } from '@/lib/platform';
import { closeSheet, openSheet } from '@/lib/sheets';
import { useApp } from '@/lib/store';

function SearchSheet({ prime }: { prime: HTMLElement | null }) {
  const s = useApp();
  const { idx, error } = useMenu(s.branch);
  const [q, setQ] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const res = useMemo(() => (idx && q.trim() ? searchMenu(idx, q) : []), [idx, q]);
  const qty = useMemo(() => qtyMap(s.cart), [s.cart]);

  useEffect(() => {
    focusLater(inp.current, prime, 380);
  }, [prime]);

  return (
    <>
      <div className="search-top">
        <label className="sbox">
          <Icon n="search" cls="sm" />
          <span className="sr">Cari menu</span>
          <input
            ref={inp}
            className="input"
            type="search"
            placeholder="Cari kopi, matcha, pasta…"
            autoComplete="off"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <button className="btn sm soft" onClick={() => closeSheet()}>
          Batal
        </button>
      </div>
      <div className="sheet-body">
        {!idx ? (
          <div className="empty">
            <p>{error ?? (s.branch ? 'Memuat menu…' : 'Pilih cabang dulu untuk mencari menu.')}</p>
          </div>
        ) : !q.trim() ? (
          <div className="search-sug">
            <span className="eyebrow" style={{ width: '100%', margin: '4px 0' }}>
              Populer dicari
            </span>
            {CONTENT.searchSuggest.map((x) => (
              <button key={x} className="chip sm" onClick={() => setQ(x)}>
                {x}
              </button>
            ))}
          </div>
        ) : res.length ? (
          <div className="search-res">
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {res.length} menu ditemukan
            </p>
            {res.map((p) => (
              <ItemRow key={p.id} p={p} n={qty.get(p.id) ?? 0} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="em-ico">
              <Icon n="search" cls="lg" />
            </div>
            <h3>Belum ketemu</h3>
            <p>Coba kata lain, misalnya “latte” atau “nasi”.</p>
          </div>
        )}
      </div>
    </>
  );
}

export function openSearch(): void {
  const prime = primeKeyboard();
  openSheet(<SearchSheet prime={prime} />, { full: true });
}
