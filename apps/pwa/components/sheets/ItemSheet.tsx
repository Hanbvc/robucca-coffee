'use client';
/* Detail menu: pilihan (ukuran, suhu, topping…), catatan, jumlah. Port openItem() prototipe. */
import { defaultSelection, groupVisible, productImage, rp, unitPrice, type Selection } from '@robucca/core';
import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { addToCart, replaceLine } from '@/lib/cart';
import { menuKey, useMenu } from '@/lib/data';
import { cleanSel, indexMenu, notePlaceholder } from '@/lib/menu';
import { peek } from '@/lib/remote';
import { haptic } from '@/lib/platform';
import { closeSheet, openSheet } from '@/lib/sheets';
import { getState, useApp } from '@/lib/store';
import type { Category, Menu, MenuGroup, Product } from '@/lib/types';
import { bump, toast } from '@/lib/ui';

function initSel(p: Product, edit: Selection | undefined): Selection {
  const sel = defaultSelection(p);
  if (edit) for (const [gid, ids] of Object.entries(edit)) if (p.modifierGroups.some((g) => g.id === gid)) sel[gid] = [...ids];
  return sel;
}

const picked = (g: MenuGroup, sel: Selection): string[] => (sel[g.id] ?? []).filter((id) => g.options.some((o) => o.id === id));

function Body({ p, c, editKey }: { p: Product; c: Category; editKey?: string }) {
  const line = editKey ? getState().cart.find((l) => l.key === editKey) : undefined;
  const [sel, setSel] = useState<Selection>(() => initSel(p, line?.sel));
  const [qty, setQty] = useState(line?.qty ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const [miss, setMiss] = useState<{ gid: string; n: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const groups = p.modifierGroups.filter((g) => groupVisible(g, sel));
  const price = unitPrice(p, sel) * qty;

  const choose = (g: MenuGroup, id: string): void => {
    setMiss((m) => (m?.gid === g.id ? null : m));
    setSel((cur) => {
      const now = picked(g, cur);
      if (g.selection === 'SINGLE') return { ...cur, [g.id]: [id] };
      if (now.includes(id)) return { ...cur, [g.id]: now.filter((x) => x !== id) };
      if (g.maxSelect && now.length >= g.maxSelect) {
        toast(`${g.name}: maksimal ${g.maxSelect} pilihan`, 'info');
        return cur;
      }
      return { ...cur, [g.id]: [...now, id] };
    });
  };

  const addNote = (v: string): void => {
    const cur = note.trim();
    if (!cur.toLowerCase().includes(v.toLowerCase())) setNote((cur ? `${cur}, ${v.toLowerCase()}` : v).slice(0, 120));
  };

  const submit = (): void => {
    const missing = p.modifierGroups.find((g) => g.isRequired && groupVisible(g, sel) && !picked(g, sel).length);
    if (missing) {
      const el = body.current?.querySelector<HTMLElement>(`.og[data-g="${missing.id}"]`);
      const b = body.current;
      if (el && b) b.scrollTo({ top: el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 70, behavior: 'smooth' });
      setMiss((m) => ({ gid: missing.id, n: (m?.n ?? 0) + 1 }));
      return;
    }
    const clean = cleanSel(p, sel);
    if (line) replaceLine(line.key, p.id, clean, note, qty);
    else addToCart(p.id, clean, note, qty);
    haptic();
    closeSheet(() => {
      bump();
      toast(line ? 'Pesanan diperbarui' : `${p.name} masuk keranjang`);
    });
  };

  return (
    <>
      <div className="sheet-body" ref={body}>
        <button className="sheet-x" onClick={() => closeSheet()} aria-label="Tutup">
          <Icon n="x" />
        </button>
        <Pic src={productImage(p, sel)} name={p.name} cls="pd-img" big eager />
        <div className="pd-head">
          {(p.isSignature || !p.available) && (
            <div className="tags">
              {p.isSignature && <span className="tag dark">★ Signature</span>}
              {!p.available && <span className="tag red">Sedang habis</span>}
            </div>
          )}
          <h2>{p.name}</h2>
          <div className="pr">{rp(unitPrice(p, defaultSelection(p)))}</div>
          {p.description ? (
            <p>{p.description}</p>
          ) : (
            <p className="faint">
              {c.name}
              {c.description ? ` · ${c.description}` : ''}
            </p>
          )}
        </div>
        <div>
          {groups.map((g) => {
            const on = new Set(picked(g, sel));
            const prices = g.options.map((o) => o.priceDelta);
            const same = g.selection === 'MULTIPLE' && prices.length > 0 && prices.every((x) => x === prices[0]) && prices[0]! > 0;
            const isMiss = miss?.gid === g.id;
            const tag = isMiss ? (
              <span key={miss.n} className="tag req-miss">
                Pilih {g.name.replace(/^Pilih /i, '').toLowerCase()}
              </span>
            ) : g.isRequired ? (
              <span className="tag olive">Wajib</span>
            ) : g.selection === 'MULTIPLE' ? (
              <span className="tag">{g.maxSelect ? `Maks. ${g.maxSelect}` : 'Opsional'}</span>
            ) : (
              <span className="tag">Pilih 1</span>
            );
            const head = (
              <div className="og-h">
                <b>
                  {g.name}
                  {same && (
                    <span className="faint" style={{ fontWeight: 500, fontSize: 13 }}>
                      {' '}
                      · +{rp(prices[0]!)}
                    </span>
                  )}
                </b>
                {tag}
              </div>
            );
            if (same) {
              return (
                <div className="og" data-g={g.id} key={g.id}>
                  {head}
                  <div className="opt-grid">
                    {g.options.map((o) => (
                      <button key={o.id} className={`chip sm ${on.has(o.id) ? 'on' : ''}`} aria-pressed={on.has(o.id)} onClick={() => choose(g, o.id)}>
                        {o.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div className="og" data-g={g.id} key={g.id}>
                {head}
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    className={`opt ${g.selection === 'MULTIPLE' ? 'multi' : ''} ${on.has(o.id) ? 'on' : ''}`}
                    role={g.selection === 'MULTIPLE' ? 'checkbox' : 'radio'}
                    aria-checked={on.has(o.id)}
                    onClick={() => choose(g, o.id)}
                  >
                    <span className="mark">
                      <Icon n="check" />
                    </span>
                    <span className="lbl">{o.name}</span>
                    {o.priceDelta ? <span className="op">+{rp(o.priceDelta)}</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="notes bg-in">
          <b>
            Catatan{' '}
            <span className="faint" style={{ fontWeight: 400 }}>
              (opsional)
            </span>
          </b>
          <textarea className="textarea" maxLength={120} placeholder={`Contoh: ${notePlaceholder(c)}`} value={note} onChange={(e) => setNote(e.target.value)} />
          {c.quickNotes.length > 0 && (
            <div className="hscroll">
              {c.quickNotes.map((n) => (
                <button key={n} className={`chip sm ${note.toLowerCase().includes(n.toLowerCase()) ? 'on' : ''}`} onClick={() => addNote(n)}>
                  + {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="sheet-foot">
        <div className="qty lg">
          <button aria-label="Kurangi" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Icon n="minus" cls="sm" />
          </button>
          <b>{qty}</b>
          <button aria-label="Tambah" onClick={() => setQty((q) => Math.min(50, q + 1))}>
            <Icon n="plus" cls="sm" />
          </button>
        </div>
        {p.available ? (
          <button className="btn grow" onClick={submit}>
            {line ? 'Simpan' : 'Tambah'} · <span className="price">{rp(price)}</span>
          </button>
        ) : (
          <button className="btn grow" disabled>
            Sedang habis
          </button>
        )}
      </div>
    </>
  );
}

function ItemSheet({ productId, editKey }: { productId: string; editKey?: string }) {
  const { branch } = useApp();
  const { idx, error } = useMenu(branch);
  const hit = idx?.products.get(productId);
  if (!hit) {
    return (
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>{idx ? 'Menu tidak tersedia' : error ? 'Gagal memuat menu' : 'Memuat…'}</h2>
          <p>{idx ? 'Menu ini sudah tidak ada di cabang ini.' : (error ?? '')}</p>
        </div>
      </div>
    );
  }
  return <Body p={hit.p} c={hit.c} editKey={editKey} />;
}

export function openItem(productId: string, editKey?: string): void {
  const code = getState().branch;
  const m = code ? peek<Menu>(menuKey(code)) : undefined;
  const p = m ? indexMenu(m).products.get(productId)?.p : undefined;
  openSheet(<ItemSheet productId={productId} editKey={editKey} />, { handleOnImg: !!p?.imageUrl });
}
