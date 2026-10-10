/* =========================================================
   Layar kasir: pilih menu, atur pesanan, diskon, simpan tagihan, bayar.
   Port dari pos/js/views/sell.js. Semua hitungan uang & opsi lewat @robucca/core.
   ========================================================= */
import {
  bpLabel, cashSuggestions, channelPrice, defaultSelection, groupVisible, lineKey, paySummary, pctToBp, rp, selectionErrors, unitPrice, uuidv7,
  type DiscountType, type Selection,
} from '@robucca/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { requireApproval } from '../components/approve';
import { printReceipt, receiptText } from '../components/receipt';
import type { Approval } from '../data/backend';
import { menuOf, typeName } from '../data/master';
import type { Line, LineDisc, MProduct, Order, OrderDiscount, Pay } from '../data/types';
import { useBus, useBusTick } from '../lib/bus';
import { Icon } from '../lib/icons';
import {
  changeChannel, isAppOrder, lineDiscAmount, loadDraft, makeLine, newDraft, payMethodsFor, payOrder, priced, saveOpen, selectionOf, storeDraft, voidOrder,
  type PayMethod,
} from '../ops';
import { S, branch, can, master, nav, setShift, settings } from '../state';
import { FadeImg, initials, Numpad, keyToNp, npKey, useKeys } from '../ui/common';
import { confirmBox, Modal, openLayer, promptBox, toast, type Close } from '../ui/overlay';
import { openShiftDialog } from './Shift';

/** Persen yang diketik kasir → basis poin, maksimal 100%. */
const pctInput = (v: number) => Math.min(10000, pctToBp(v));
const discLabel = (d: { type: DiscountType; value: number }) => (d.type === 'PERCENT' ? bpLabel(d.value) : rp(d.value));
const withApproval = (o: Order, a: Approval | null): Order => (a?.token ? { ...o, discountApproval: a.token, approvalAt: a.at } : o);

export function SellView({ bill }: { bill?: string | undefined }) {
  const be = S.be;
  const b = branch();
  useBusTick(['master', 'soldout', 'app']);
  const [o, setO] = useState<Order>(() => priced(loadDraft()));
  const oRef = useRef(o);
  oRef.current = o;
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [fieldErr, setFieldErr] = useState('');

  const commit = (next: Order) => {
    const p = priced(next);
    setO(p);
    oRef.current = p;
    storeDraft(p);
  };

  /* ---------- muat tagihan terbuka dari halaman Tagihan ---------- */
  useEffect(() => {
    if (!bill) return;
    void (async () => {
      const x = await be.get<Order>('orders', bill);
      history.replaceState(null, '', '#/kasir');
      if (!x || (x.status !== 'OPEN' && x.status !== 'AWAITING_PAYMENT')) {
        if (x) toast(`Tagihan ${x.queueNo} sudah ${x.status === 'PAID' ? 'dibayar' : 'ditutup'}`, 'warn');
        return;
      }
      const cur = oRef.current;
      if (
        cur.lines.length &&
        cur.id !== x.id &&
        cur.status === 'DRAFT' &&
        !(await confirmBox({ title: 'Ganti pesanan?', text: 'Pesanan yang sedang dibuat belum disimpan dan akan dibuang.', ok: 'Buang & buka tagihan', danger: true }))
      )
        return;
      commit({ ...x });
      setCartOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill]);

  /* ---------- tagihan yang sedang dibuka diubah/dibayar di terminal lain ---------- */
  useBus(['orders'], (d) => {
    const cur = oRef.current;
    if (cur.status !== 'OPEN' && cur.status !== 'AWAITING_PAYMENT') return;
    void be.get<Order>('orders', cur.id).then((saved) => {
      if (!saved || oRef.current.id !== cur.id) return;
      if (saved.status !== 'OPEN' && saved.status !== 'AWAITING_PAYMENT') {
        toast(`Tagihan ${cur.queueNo} sudah ${saved.status === 'PAID' ? 'dibayar' : 'dibatalkan'} di terminal lain`, 'warn');
        commit(newDraft(cur.channelCode));
      } else if (d.remote && saved.version > cur.version) commit(saved);
    });
  });

  /* ---------- shift ---------- */
  useEffect(() => {
    if (S.shift) return;
    const t = setTimeout(() => {
      void be.currentShift().then(async (sh) => {
        if (sh) setShift(sh);
        else if (!S.shift && location.hash.startsWith('#/kasir')) await ensureShift();
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ensureShift = async (): Promise<boolean> => {
    if (S.shift) return true;
    const sh = await be.currentShift();
    if (sh) {
      setShift(sh);
      return true;
    }
    return !!(await openShiftDialog());
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && !document.querySelector('.modal-bd')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  /* ---------- menu ---------- */
  const m = master();
  const qtyOf = (id: string) => o.lines.filter((l) => l.productId === id && !l.voided).reduce((a, l) => a + l.qty, 0);
  const cats = m.categories.filter((c) => c.products.length);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s) return m.products.filter((p) => p.name.toLowerCase().includes(s));
    if (cat !== 'all') return m.categories.find((c) => c.id === cat)?.products ?? [];
    return m.products;
  }, [q, cat, m]);

  const addLine = (line: Line) => {
    const cur = oRef.current;
    const p = m.product(line.productId);
    const key = p ? lineKey(line.productId, selectionOf(p, line.optionIds), line.note, line.unitPrice) : '';
    const ex = cur.lines.find((l) => !l.kAt && !l.voided && !l.disc && p && lineKey(l.productId, selectionOf(p, l.optionIds), l.note, l.unitPrice) === key);
    const lines = ex ? cur.lines.map((l) => (l === ex ? { ...l, qty: l.qty + line.qty } : l)) : [...cur.lines, line];
    commit({ ...cur, lines });
  };

  const tapItem = (p: MProduct) => {
    if (m.blocked(p)) {
      toast(m.available(p) ? `Stok ${p.name} habis` : `${p.name} sedang tidak tersedia`, 'warn');
      return;
    }
    if (!p.modifierGroups.length) {
      addLine(makeLine(p, {}, { qty: 1 }, oRef.current));
      return;
    }
    void itemDialog(p);
  };

  const itemDialog = async (p: MProduct, line: Line | null = null) => {
    const r = await openLayer<ItemResult>((close) => <ItemDialog p={p} line={line} order={oRef.current} close={close} />);
    if (!r) return;
    const cur = oRef.current;
    if (r.kind === 'add') addLine(r.line);
    else if (r.kind === 'update') commit(withApproval({ ...cur, lines: cur.lines.map((l) => (l.id === r.line.id ? r.line : l)) }, r.approval));
    else if (r.kind === 'remove') commit({ ...cur, lines: cur.lines.filter((l) => l.id !== r.id) });
    else if (r.kind === 'again') addLine(makeLine(p, selectionOf(p, line!.optionIds), { qty: 1, note: line!.note }, cur));
    else if (r.kind === 'void') {
      const mark = (l: Line): Line => (l.id === r.id ? { ...l, voided: { reason: r.reason, byId: r.approval.staff.id, byName: r.approval.staff.name, at: Date.now() } } : l);
      let next: Order = { ...cur, lines: cur.lines.map(mark) };
      if (cur.status === 'OPEN' || cur.status === 'AWAITING_PAYMENT') {
        // simpan pembatalan saja; baris baru yang belum disimpan tetap di keranjang
        const saved = await be.get<Order>('orders', cur.id);
        if (saved) {
          const [upd] = await be.save('orders', priced({ ...saved, lines: saved.lines.map(mark) }));
          next = { ...next, version: upd!.version, updatedAt: upd!.updatedAt };
        }
      }
      commit(next);
      await be.audit('line.void', { number: cur.number, item: line!.name, qty: line!.qty, reason: r.reason }, r.approval.staff);
    }
  };

  /* ---------- diskon pesanan ---------- */
  const discountDialog = async () => {
    const r = await openLayer<{ discount: OrderDiscount | null; approval: Approval | null }>((close) => <DiscountDialog o={oRef.current} close={close} />);
    if (!r) return;
    commit(withApproval({ ...oRef.current, discount: r.discount }, r.approval));
  };

  /* ---------- simpan tagihan ---------- */
  const hold = async () => {
    if (!(await ensureShift())) return;
    const cur = oRef.current;
    if (!cur.table.trim() && !cur.customerName.trim()) {
      toast(cur.type === 'DINE_IN' ? 'Isi nomor meja atau nama pelanggan dulu' : 'Isi nama pelanggan dulu', 'warn');
      setFieldErr(cur.type === 'DINE_IN' ? 'table' : 'name');
      setCartOpen(true);
      return;
    }
    const wasOpen = cur.status !== 'DRAFT';
    try {
      const saved = await saveOpen(cur);
      toast(`${wasOpen ? 'Tagihan diperbarui' : 'Tagihan disimpan'} · antrean ${saved.queueNo} dikirim ke dapur`);
      commit(newDraft(cur.channelCode));
      setCartOpen(false);
    } catch (e) {
      toast((e as Error).message || 'Gagal menyimpan', 'err');
    }
  };

  /* ---------- pembayaran ---------- */
  const pay = async () => {
    if (!(await ensureShift())) return;
    const cur = priced(oRef.current);
    const paid = await openLayer<Order>((close) => <PayDialog o={cur} close={close} />);
    if (!paid) return;
    commit(newDraft(cur.channelCode));
    setCartOpen(false);
    const opts = { branch: b, settings: settings() };
    if (settings().autoPrintReceipt) printReceipt(paid, opts);
    void openLayer((close) => <DoneDialog paid={paid} close={close} />);
  };

  /* ---------- lain-lain ---------- */
  const more = async () => {
    const cur = oRef.current;
    const isOpen = cur.status !== 'DRAFT';
    const x = await openLayer<string>((close) => (
      <Modal title={isOpen ? `Tagihan ${cur.queueNo}` : 'Pesanan'} size="sm">
        <div className="col">
          {isOpen ? (
            <button className="btn danger ghost block" data-x="void" onClick={() => close('void')}>
              <Icon name="x-circle" size="sm" /> Batalkan tagihan (void)
            </button>
          ) : (
            <button className="btn ghost block" data-x="clear" disabled={!cur.lines.length} onClick={() => close('clear')}>
              <Icon name="trash" size="sm" /> Kosongkan pesanan
            </button>
          )}
          <button className="btn ghost block" data-x="soldout" onClick={() => close('soldout')}>
            <Icon name="box" size="sm" /> Tandai menu habis / tersedia
          </button>
          <button className="btn ghost block" data-x="bills" onClick={() => close('bills')}>
            <Icon name="pause" size="sm" /> Lihat tagihan terbuka
          </button>
        </div>
      </Modal>
    ));
    if (x === 'clear' && (await confirmBox({ title: 'Kosongkan pesanan?', ok: 'Kosongkan', danger: true }))) commit(newDraft(cur.channelCode));
    if (x === 'bills') nav('tagihan');
    if (x === 'soldout') void openLayer(() => <SoldOutDialog />);
    if (x === 'void') {
      const who = await requireApproval('void', { title: 'Batalkan tagihan', text: `Tagihan ${cur.number} (${rp(cur.totals.total)}) akan dibatalkan.` });
      if (!who) return;
      const reason = await promptBox({ title: 'Alasan pembatalan', presets: ['Pelanggan batal', 'Salah input', 'Tagihan ganda'], ok: 'Batalkan tagihan', danger: true });
      if (!reason) return;
      const saved = await be.get<Order>('orders', cur.id);
      await voidOrder(saved ?? cur, { reason, approval: who });
      toast('Tagihan dibatalkan', 'warn');
      commit(newDraft(cur.channelCode));
    }
  };

  const platformPick = async () => {
    const plats = m.channels.filter((x) => x.type === 'FOOD_PLATFORM');
    const code = await openLayer<string>((close) => (
      <Modal title="Pesanan ojol" size="sm">
        <div className="list">
          {plats.map((x) => (
            <button key={x.code} className="li" data-pl={x.code} onClick={() => close(x.code)}>
              <span className="lq">
                <Icon name="scooter" size="sm" />
              </span>
              <div>
                <b>{x.name}</b>
                <small>{x.markupBp ? `Harga +${bpLabel(x.markupBp)}` : 'Harga sama dengan menu'}</small>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    ));
    if (code) commit(changeChannel(oRef.current, code));
  };

  /* ---------- tampilan ---------- */
  const card = (p: MProduct) => {
    const out = m.blocked(p);
    const n = qtyOf(p.id);
    return (
      <button key={p.id} className={`prod ${out ? 'out' : ''}`} data-item={p.id} aria-disabled={out || undefined} onClick={() => tapItem(p)}>
        <div className="ph">
          <FadeImg src={p.imageUrl} />
          <span className="ini" hidden={!!p.imageUrl}>
            {initials(p.name)}
          </span>
        </div>
        <div className="pb">
          <div className="pn">
            {p.name}
            {p.isSignature && (
              <>
                {' '}
                <span className="sig" aria-label="Signature">
                  ★
                </span>
              </>
            )}
          </div>
          <div className="pp">{rp(channelPrice(p.price, o.markupBp))}</div>
        </div>
        <span className="qbadge" hidden={!n}>
          {n}
        </span>
        {p.outOfStock && !out && <span className="sbadge tag amber">Stok menipis</span>}
      </button>
    );
  };

  const t = o.totals;
  const cfg = o.cfg;
  const isOpen = o.status !== 'DRAFT';
  const app = isAppOrder(o);
  const base = m.channels.filter((c) => c.type !== 'FOOD_PLATFORM');
  const plats = m.channels.filter((c) => c.type === 'FOOD_PLATFORM');
  const active = o.lines.filter((l) => !l.voided);
  const nItems = active.reduce((a, l) => a + l.qty, 0);
  const sh = S.shift;

  return (
    <>
      <div className="sell">
        <section className="sell-menu">
          <div className="sm-head">
            <div className="sm-top">
              <div className="input-wrap">
                <Icon name="search" size="sm" />
                <input
                  ref={searchRef}
                  className="input"
                  id="s-q"
                  type="search"
                  placeholder="Cari menu…  ( / )"
                  autoComplete="off"
                  aria-label="Cari menu"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <span className="shift-pill" id="s-shift">
                {sh ? (
                  <>
                    <i />
                    <span>
                      Shift {sh.openedByName.split(' ')[0]} · T{sh.terminalNo}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="lock" size="xs" />
                    <span>Shift belum dibuka</span>
                  </>
                )}
              </span>
            </div>
            <div className="cats" id="s-cats" role="tablist">
              {[{ id: 'all', name: 'Semua' }, ...cats].map((c) => (
                <button
                  key={c.id}
                  className={`chip ${cat === c.id ? 'on' : ''}`}
                  data-cat={c.id}
                  role="tab"
                  onClick={() => {
                    setCat(c.id);
                    setQ('');
                    gridRef.current?.scrollTo({ top: 0 });
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid-wrap" id="s-grid" ref={gridRef}>
            {!items.length ? (
              <div className="empty">
                <div className="em-ico">
                  <Icon name="search" size="lg" />
                </div>
                <h3>Menu tidak ditemukan</h3>
                <p>Coba kata lain.</p>
              </div>
            ) : cat === 'all' && !q.trim() ? (
              cats.map((c) => (
                <div key={c.id}>
                  <h2 className="grid-sec">{c.name}</h2>
                  <div className="pgrid">{c.products.map(card)}</div>
                </div>
              ))
            ) : (
              <div className="pgrid">{items.map(card)}</div>
            )}
          </div>
        </section>

        <aside className={`cart ${cartOpen ? 'open' : ''}`} id="s-cart" aria-label="Pesanan">
          <div className="cart-head">
            <div className="ch-top">
              <button className="icon-btn cart-close" aria-label="Tutup pesanan" onClick={() => setCartOpen(false)}>
                <Icon name="chevron-right" />
              </button>
              <div className="grow">
                <b>{isOpen ? `Tagihan ${o.queueNo}` : 'Pesanan baru'}</b>
                {isOpen && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {o.number} · {app ? 'pesanan aplikasi' : 'tersimpan'}
                  </div>
                )}
              </div>
              {isOpen && (
                <button
                  className="btn ghost sm"
                  data-a="unload"
                  onClick={() => {
                    commit(newDraft(o.channelCode));
                    toast('Tagihan tetap tersimpan di Tagihan');
                  }}
                >
                  <Icon name="x" size="sm" /> Tutup
                </button>
              )}
              <button className="icon-btn" data-a="more" aria-label="Lainnya" onClick={() => void more()}>
                <Icon name="more" />
              </button>
            </div>
            {app ? (
              <div className="row wrap">
                <span className="tag blue">{typeName(o.type)}</span>
                {o.pickupAt && <span className="tag">Ambil {new Date(o.pickupAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>}
                {o.customerPhone && <span className="tag">{o.customerPhone}</span>}
              </div>
            ) : (
              <div className="seg block" role="radiogroup" aria-label="Tipe pesanan">
                {base.map((c) => (
                  <button
                    key={c.code}
                    className={o.channelCode === c.code ? 'on' : ''}
                    data-ch={c.code}
                    role="radio"
                    aria-checked={o.channelCode === c.code}
                    onClick={() => commit(changeChannel(o, c.code))}
                  >
                    {c.name}
                  </button>
                ))}
                {plats.length > 0 && (
                  <button className={o.type === 'FOOD_PLATFORM' ? 'on' : ''} data-a="plat" onClick={() => void platformPick()}>
                    {o.type === 'FOOD_PLATFORM' ? o.channelName : 'Ojol'} <Icon name="chevron-down" size="xs" />
                  </button>
                )}
              </div>
            )}
            <div className="ch-meta">
              {o.type === 'DINE_IN' && (
                <input
                  className={`input sm ${fieldErr === 'table' ? 'err' : ''}`}
                  data-f="table"
                  placeholder="No. meja"
                  inputMode="numeric"
                  aria-label="Nomor meja"
                  maxLength={10}
                  value={o.table}
                  onChange={(e) => {
                    setFieldErr('');
                    commit({ ...o, table: e.target.value });
                  }}
                />
              )}
              <input
                className={`input sm ${fieldErr === 'name' ? 'err' : ''}`}
                data-f="name"
                placeholder={o.type === 'FOOD_PLATFORM' ? 'Nama / ID order ojol' : 'Nama pelanggan'}
                aria-label="Nama pelanggan"
                maxLength={60}
                style={o.type === 'DINE_IN' ? undefined : { gridColumn: 'span 2' }}
                value={o.customerName}
                onChange={(e) => {
                  setFieldErr('');
                  commit({ ...o, customerName: e.target.value });
                }}
              />
            </div>
          </div>
          <div className="cart-lines" id="s-lines">
            {o.lines.length ? (
              o.lines.map((l) => {
                const d = lineDiscAmount(l);
                return (
                  <button
                    key={l.id}
                    className={`cl ${l.kAt ? 'sent' : ''} ${l.voided ? 'voided' : ''}`}
                    data-line={l.id}
                    onClick={() => {
                      if (l.voided) return;
                      const p = m.product(l.productId);
                      if (p) void itemDialog(p, l);
                    }}
                  >
                    <span className="q">{l.qty}</span>
                    <span className="n">
                      <b>{l.name}</b>
                      {l.sum && <small>{l.sum}</small>}
                      {l.note && <small className="note-l">“{l.note}”</small>}
                      {l.disc && <small className="disc-l">Diskon {discLabel(l.disc)}</small>}
                      {l.voided ? (
                        <small className="neg">Dibatalkan</small>
                      ) : l.kAt ? (
                        <small>
                          <Icon name="check" size="xs" /> Terkirim ke {l.station === 'BAR' ? 'bar' : 'dapur'}
                        </small>
                      ) : null}
                    </span>
                    <span className="p">
                      {rp(l.voided ? 0 : l.unitPrice * l.qty - d)}
                      {d > 0 && <s>{rp(l.unitPrice * l.qty)}</s>}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="cart-empty">
                <div>
                  <div className="em-ico">
                    <Icon name="bag" size="lg" />
                  </div>
                  <b>Belum ada pesanan</b>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                    Ketuk menu di kiri untuk menambahkan.
                  </p>
                </div>
              </div>
            )}
          </div>
          {o.lines.length > 0 && (
            <div className="cart-sum">
              <div className="sum-row">
                <span>Subtotal · {t.items} item</span>
                <span>{rp(t.gross)}</span>
              </div>
              {t.discount > 0 && (
                <div className="sum-row disc">
                  <span>Diskon{o.discount ? ` · ${o.discount.name}` : ''}</span>
                  <span>−{rp(t.discount)}</span>
                </div>
              )}
              {t.service > 0 && (
                <div className="sum-row">
                  <span>Biaya layanan {bpLabel(cfg.serviceRateBp)}</span>
                  <span>{rp(t.service)}</span>
                </div>
              )}
              {t.tax > 0 && !cfg.taxInclusive && (
                <div className="sum-row">
                  <span>
                    {b.taxLabel || 'PB1'} {bpLabel(cfg.taxRateBp)}
                  </span>
                  <span>{rp(t.tax)}</span>
                </div>
              )}
              {t.deliveryFee > 0 && (
                <div className="sum-row">
                  <span>Ongkir</span>
                  <span>{rp(t.deliveryFee)}</span>
                </div>
              )}
              {t.rounding !== 0 && (
                <div className="sum-row">
                  <span>Pembulatan</span>
                  <span>{rp(t.rounding)}</span>
                </div>
              )}
              <div className="sum-row total">
                <span>Total</span>
                <span id="s-total">{rp(t.total)}</span>
              </div>
              {t.tax > 0 && cfg.taxInclusive && (
                <div className="sum-row info">
                  <span>
                    Termasuk {b.taxLabel || 'PB1'} {bpLabel(cfg.taxRateBp)}
                  </span>
                  <span>{rp(t.tax)}</span>
                </div>
              )}
            </div>
          )}
          <div className="cart-actions">
            <button className="btn soft lg" data-a="disc" disabled={!o.lines.length} aria-label="Diskon" onClick={() => void discountDialog()}>
              <Icon name="percent" size="sm" />
            </button>
            <button className="btn ghost lg" data-a="hold" disabled={!o.lines.length} onClick={() => void hold()}>
              <Icon name="pause" size="sm" /> {isOpen ? 'Perbarui' : 'Simpan'}
            </button>
            <button className="btn lg pay-btn" data-a="pay" disabled={!active.length} onClick={() => void pay()}>
              <span>Bayar</span>
              <span>{rp(t.total)}</span>
            </button>
          </div>
        </aside>
      </div>
      <button className="cart-fab" id="s-fab" hidden={!nItems && !isOpen} onClick={() => setCartOpen(true)}>
        <span className="n">{nItems}</span>
        <span>{isOpen ? `Tagihan ${o.queueNo}` : 'Lihat pesanan'}</span>
        <span className="t">{rp(t.total)}</span>
      </button>
    </>
  );
}

/* =========================================================
   Dialog menu: opsi, catatan, jumlah, diskon item
   ========================================================= */
type ItemResult =
  | { kind: 'add'; line: Line }
  | { kind: 'update'; line: Line; approval: Approval | null }
  | { kind: 'remove'; id: string }
  | { kind: 'again' }
  | { kind: 'void'; id: string; reason: string; approval: Approval };

function ItemDialog({ p, line, order, close }: { p: MProduct; line: Line | null; order: Order; close: Close<ItemResult> }) {
  const m = master();
  const menu = menuOf(p);
  const cat = m.categoryOf(p.id);
  const [sel, setSel] = useState<Selection>(() => (line ? selectionOf(p, line.optionIds) : defaultSelection(menu)));
  const [qty, setQty] = useState(line?.qty ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const [dType, setDType] = useState<DiscountType | null>(line?.disc?.type ?? null);
  const [dVal, setDVal] = useState<number>(line?.disc ? (line.disc.type === 'PERCENT' ? line.disc.value / 100 : line.disc.value) : 0);
  const sent = !!line?.kAt;
  const up = unitPrice(menu, sel, order.markupBp);
  const gross = up * qty;
  const disc: LineDisc | null = dType && dVal > 0 ? { type: dType, value: dType === 'PERCENT' ? pctInput(dVal) : dVal } : null;
  const dAmt = disc ? lineDiscAmount({ unitPrice: up, qty, disc }) : 0;
  const miss = selectionErrors(menu, sel);

  const pick = (gid: string, oid: string) => {
    const g = p.modifierGroups.find((x) => x.id === gid)!;
    if (g.selection === 'MULTIPLE') {
      const cur = new Set(sel[gid] ?? []);
      if (cur.has(oid)) cur.delete(oid);
      else {
        if (g.maxSelect && cur.size >= g.maxSelect) {
          toast(`${g.name}: maksimal ${g.maxSelect}`, 'warn');
          return;
        }
        cur.add(oid);
      }
      setSel({ ...sel, [gid]: [...cur] });
    } else setSel({ ...sel, [gid]: [oid] });
  };

  const ok = async () => {
    let approval: Approval | null = null;
    let d = disc;
    if (d) {
      const bp = d.type === 'PERCENT' ? d.value : Math.round((Math.min(d.value, gross) * 10000) / Math.max(1, gross));
      const max = m.settings.maxCashierDiscountBp;
      if (bp > max && !can('approve.discount')) {
        approval = await requireApproval('discount', { title: 'Diskon melebihi batas kasir', text: `Batas diskon kasir ${bpLabel(max)}.` });
        if (!approval) return;
        d = { ...d, approvedById: approval.staff.id, approvedByName: approval.staff.name };
      } else if (line?.disc?.approvedById && line.disc.type === d.type && line.disc.value === d.value) {
        d = { ...d, approvedById: line.disc.approvedById, ...(line.disc.approvedByName ? { approvedByName: line.disc.approvedByName } : {}) };
      }
    }
    const nl = makeLine(p, sel, { qty, note }, order);
    if (line) close({ kind: 'update', line: { ...nl, id: line.id, disc: d }, approval });
    else close({ kind: 'add', line: nl });
  };

  const del = async () => {
    if (!line) return;
    if (!sent) return close({ kind: 'remove', id: line.id });
    const who = await requireApproval('void', { title: 'Batalkan item yang sudah dikirim', text: `${line.qty}x ${line.name} sudah dikirim ke ${line.station === 'BAR' ? 'bar' : 'dapur'}.` });
    if (!who) return;
    const reason = await promptBox({ title: 'Alasan pembatalan', presets: ['Pelanggan batal', 'Salah input', 'Menu habis'], ok: 'Batalkan item', danger: true });
    if (!reason) return;
    close({ kind: 'void', id: line.id, reason, approval: who });
  };

  return (
    <Modal
      title={line ? 'Ubah pesanan' : 'Tambah pesanan'}
      size="lg"
      foot={
        <div className="row grow" style={{ justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {line && (
            <button className="btn danger ghost" data-del onClick={() => void del()}>
              <Icon name="trash" size="sm" /> {sent ? 'Batalkan item' : 'Hapus'}
            </button>
          )}
          {sent ? (
            <button className="btn ghost" data-again onClick={() => close({ kind: 'again' })}>
              <Icon name="plus" size="sm" /> Pesan lagi
            </button>
          ) : (
            <button className="btn lg" data-ok disabled={miss.length > 0} title={miss.join(', ')} onClick={() => void ok()}>
              {line ? 'Simpan' : 'Tambah'} · {rp(gross - dAmt)}
            </button>
          )}
        </div>
      }
    >
      <div className="im-top">
        <div className="ph">{p.imageUrl ? <FadeImg src={p.imageUrl} /> : null}</div>
        <div className="grow">
          <b>{p.name}</b>
          <span className="pr">{rp(up)}</span>
          {sent && (
            <div className="note green" style={{ marginTop: 8, padding: '8px 10px' }}>
              <Icon name="check" size="xs" />
              <span>Sudah dikirim ke {line!.station === 'BAR' ? 'bar' : 'dapur'} — hanya bisa dibatalkan.</span>
            </div>
          )}
        </div>
      </div>
      {!sent && (
        <>
          {p.modifierGroups
            .filter((g) => groupVisible(g, sel))
            .map((g) => (
              <div className="opt-group" key={g.id}>
                <h4>
                  {g.name} {g.isRequired && <span className="tag">Wajib</span>}
                  {g.selection === 'MULTIPLE' && <span className="tag">{g.maxSelect ? `Maks. ${g.maxSelect}` : 'Boleh lebih dari satu'}</span>}
                </h4>
                <div className="opts">
                  {g.options.map((c) => {
                    const on = (sel[g.id] ?? []).includes(c.id);
                    return (
                      <button key={c.id} className={`opt ${on ? 'on' : ''}`} data-g={g.id} data-c={c.name} onClick={() => pick(g.id, c.id)}>
                        {c.name}
                        {c.priceDelta ? <small>+{rp(c.priceDelta)}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          <div className="opt-group">
            <h4>Catatan</h4>
            <input className="input" id="im-note" placeholder="mis. tidak pedas" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            {cat?.quickNotes?.length ? (
              <div className="quick-notes">
                {cat.quickNotes.map((n) => (
                  <button
                    key={n}
                    className="chip sm"
                    data-note={n}
                    onClick={() => setNote((cur) => (cur ? (cur.toLowerCase().includes(n.toLowerCase()) ? cur : `${cur}, ${n}`) : n))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="row wrap" style={{ marginTop: 16, gap: 16, alignItems: 'flex-end' }}>
            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>
                Jumlah
              </div>
              <div className="stepper">
                <button data-q="-1" aria-label="Kurangi" onClick={() => setQty((x) => Math.max(1, x - 1))}>
                  <Icon name="minus" />
                </button>
                <b>{qty}</b>
                <button data-q="1" aria-label="Tambah" onClick={() => setQty((x) => Math.min(999, x + 1))}>
                  <Icon name="plus" />
                </button>
              </div>
            </div>
            {line && (
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  Diskon item
                </div>
                <div className="row">
                  <div className="seg">
                    <button className={!dType ? 'on' : ''} data-dt="" onClick={() => setDType(null)}>
                      Tanpa
                    </button>
                    <button className={dType === 'PERCENT' ? 'on' : ''} data-dt="pct" onClick={() => (setDType('PERCENT'), setDVal(0))}>
                      %
                    </button>
                    <button className={dType === 'AMOUNT' ? 'on' : ''} data-dt="amt" onClick={() => (setDType('AMOUNT'), setDVal(0))}>
                      Rp
                    </button>
                  </div>
                  {dType && (
                    <input
                      className="input sm"
                      id="im-dv"
                      inputMode="numeric"
                      style={{ width: 110 }}
                      autoFocus
                      value={dVal || ''}
                      placeholder={dType === 'PERCENT' ? '10' : '5000'}
                      aria-label="Nilai diskon"
                      onChange={(e) => {
                        const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                        setDVal(dType === 'PERCENT' ? Math.min(100, v) : Math.min(gross, v));
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          {miss.length > 0 && (
            <p className="err-text" style={{ marginTop: 10 }}>
              {miss.join(' · ')}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

/* =========================================================
   Diskon pesanan: promo atau manual (di atas batas kasir → PIN manajer)
   ========================================================= */
function DiscountDialog({ o, close }: { o: Order; close: Close<{ discount: OrderDiscount | null; approval: Approval | null }> }) {
  const m = master();
  const promos = m.activePromos();
  const manual = o.discount && !o.discount.promotionId ? o.discount : null;
  const [type, setType] = useState<DiscountType>(manual?.type ?? 'PERCENT');
  const [val, setVal] = useState(manual ? (manual.type === 'PERCENT' ? manual.value / 100 : manual.value) : 0);
  const [name, setName] = useState(manual?.name ?? '');
  const [err, setErr] = useState(false);
  const max = m.settings.maxCashierDiscountBp;

  const promo = async (id: string) => {
    const pr = m.promo(id)!;
    let approval: Approval | null = null;
    if (pr.requiresApproval && !can('approve.discount')) {
      approval = await requireApproval('discount', { title: `Promo "${pr.name}"`, text: 'Promo ini perlu persetujuan manajer.' });
      if (!approval) return;
    } else if (pr.requiresApproval) approval = { staff: S.user!, at: Date.now() };
    if (approval) void S.be.audit('discount.approve', { promo: pr.name, number: o.number || '' }, approval.staff);
    close({
      discount: { type: pr.type, value: pr.value, name: pr.name, promotionId: pr.id, ...(approval ? { approvedById: approval.staff.id, approvedByName: approval.staff.name } : {}) },
      approval,
    });
  };

  const apply = async () => {
    if (!val) return setErr(true);
    const sub = o.totals.gross - o.totals.lineDiscount;
    const value = type === 'PERCENT' ? pctInput(val) : val;
    const bp = type === 'PERCENT' ? value : Math.round((Math.min(value, sub) * 10000) / Math.max(1, sub));
    let approval: Approval | null = null;
    if (bp > max && !can('approve.discount')) {
      approval = await requireApproval('discount', { title: 'Diskon melebihi batas kasir', text: `Diskon ${type === 'PERCENT' ? bpLabel(value) : rp(value)} melebihi ${bpLabel(max)}.` });
      if (!approval) return;
      void S.be.audit('discount.approve', { type, value, number: o.number || '' }, approval.staff);
    } else if (bp > max) approval = { staff: S.user!, at: Date.now() };
    close({
      discount: {
        type, value, name: name.trim() || `Diskon ${type === 'PERCENT' ? bpLabel(value) : rp(value)}`, byId: S.user!.id,
        ...(approval ? { approvedById: approval.staff.id, approvedByName: approval.staff.name } : {}),
      },
      approval,
    });
  };

  return (
    <Modal
      title="Diskon pesanan"
      sub={`Batas diskon manual kasir ${bpLabel(max)} — lebih dari itu perlu PIN manajer.`}
      size="sm"
      foot={
        <>
          {o.discount && (
            <button className="btn danger ghost" data-rm onClick={() => close({ discount: null, approval: null })}>
              Hapus diskon
            </button>
          )}
          <button className="btn" data-apply onClick={() => void apply()}>
            Terapkan manual
          </button>
        </>
      }
    >
      {promos.length > 0 && (
        <>
          <div className="field-label" style={{ marginBottom: 8 }}>
            Promo
          </div>
          <div className="list" style={{ marginBottom: 16 }}>
            {promos.map((p) => (
              <button key={p.id} className={`li ${o.discount?.promotionId === p.id ? 'on' : ''}`} data-promo={p.id} onClick={() => void promo(p.id)}>
                <span className="lq">
                  <Icon name={p.type === 'PERCENT' ? 'percent' : 'tag'} size="sm" />
                </span>
                <div>
                  <b>{p.name}</b>
                  <small>
                    {discLabel(p)}
                    {p.requiresApproval ? ' · perlu persetujuan manajer' : ''}
                  </small>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="field-label" style={{ marginBottom: 8 }}>
        Diskon manual
      </div>
      <div className="row">
        <div className="seg">
          <button data-t="pct" className={type === 'PERCENT' ? 'on' : ''} onClick={() => setType('PERCENT')}>
            %
          </button>
          <button data-t="amt" className={type === 'AMOUNT' ? 'on' : ''} onClick={() => setType('AMOUNT')}>
            Rp
          </button>
        </div>
        <input
          className={`input ${err ? 'err' : ''}`}
          id="dv"
          inputMode="numeric"
          placeholder={type === 'PERCENT' ? 'mis. 10' : 'mis. 5000'}
          aria-label="Nilai diskon"
          value={val || ''}
          onChange={(e) => {
            setErr(false);
            const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
            setVal(type === 'PERCENT' ? Math.min(100, v) : v);
          }}
        />
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span>
          Keterangan <em>(opsional)</em>
        </span>
        <input className="input" id="dn" placeholder="mis. komplain pelanggan" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
    </Modal>
  );
}

/* =========================================================
   Pembayaran: beberapa metode (split), saran uang tunai, kembalian, referensi
   ========================================================= */
const payIcon = (pm: PayMethod) =>
  pm.method === 'CASH' ? 'banknote' : pm.method === 'QRIS' ? 'qr' : pm.method === 'DEBIT_CARD' || pm.method === 'CREDIT_CARD' ? 'card' : pm.platform ? 'scooter' : 'wallet';

function PayDialog({ o, close }: { o: Order; close: Close<Order> }) {
  const total = o.totals.total;
  const methods = payMethodsFor(o);
  const [payments, setPayments] = useState<Pay[]>([]);
  const [cur, setCur] = useState<PayMethod>(methods[0]!);
  const [entry, setEntry] = useState('');
  const [ref, setRef] = useState(o.platformOrderRef || '');
  const [saving, setSaving] = useState(false);
  const rem = paySummary(total, payments.map((p) => ({ cash: p.method === 'CASH', amount: p.amount, tendered: p.tendered ?? null }))).remaining;
  const cash = cur.method === 'CASH';
  const val = entry ? parseInt(entry, 10) : 0;
  const showVal = cash ? val : entry ? val : rem;
  const change = cash ? Math.max(0, val - rem) : 0;
  const needRef = cur.ref && !cur.platform && !ref.trim();

  const take = (applied: number, tendered?: number): Pay => ({
    id: uuidv7(), code: cur.code, name: cur.name, method: cur.method, amount: applied, ...(cash ? { tendered: tendered ?? applied } : {}),
    ...(ref.trim() ? { ref: ref.trim() } : {}), at: Date.now(),
  });

  const split = () => {
    if (val <= 0 || val >= rem || needRef) return;
    setPayments([...payments, take(val)]);
    setEntry('');
    setRef('');
    setCur(methods.find((x) => x.method !== 'CASH' && !x.platform) ?? methods[0]!);
  };

  const finish = async () => {
    if (saving || (cash && val < rem) || needRef) return;
    const all = [...payments, take(rem, cash ? val : undefined)];
    setSaving(true);
    try {
      const paid = await payOrder(o, all);
      close(paid);
    } catch (err) {
      setSaving(false);
      toast((err as Error).message || 'Pembayaran gagal disimpan', 'err');
    }
  };

  useKeys(
    (e) => {
      const k = keyToNp(e);
      if (k && !cur.platform) setEntry((x) => npKey(x, k));
      else if (e.key === 'Enter') void finish();
    },
    [cur, entry, payments, ref, saving],
  );

  return (
    <Modal
      title="Pembayaran"
      sub={`${o.channelName}${o.table ? ` · Meja ${o.table}` : ''}${o.customerName ? ` · ${o.customerName}` : ''}`}
      size="lg"
      foot={
        <div className="row grow" style={{ justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {!cur.platform && (
            <button className="btn ghost" data-split disabled={!(val > 0 && val < rem) || !!needRef} onClick={split}>
              <Icon name="plus" size="sm" /> Bagi pembayaran
            </button>
          )}
          <button className="btn lg" data-finish disabled={(cash && val < rem) || !!needRef || saving} onClick={() => void finish()}>
            <Icon name="check" size="sm" /> Selesaikan · {rp(rem)}
          </button>
        </div>
      }
    >
      <div className="pay-wrap">
        <div>
          <div className="pay-due">
            <div>
              <small>{payments.length ? 'Sisa tagihan' : 'Total tagihan'}</small>
              <br />
              <b id="pay-due">{rp(rem)}</b>
            </div>
            {payments.length > 0 && <small>dari {rp(total)}</small>}
          </div>
          <div className="pay-methods" role="radiogroup">
            {methods.map((pm) => (
              <button
                key={pm.code}
                className={`pm ${cur.code === pm.code ? 'on' : ''}`}
                data-pm={pm.code}
                role="radio"
                aria-checked={cur.code === pm.code}
                onClick={() => {
                  setCur(pm);
                  setEntry('');
                }}
              >
                <Icon name={payIcon(pm)} size="sm" />
                {pm.name}
              </button>
            ))}
          </div>
          <div className="amount-box">
            <label>{cash ? 'Uang diterima' : 'Nominal'}</label>
            <div className="big num" id="pay-amount">
              {rp(showVal)}
            </div>
            {cash && (
              <div className="chg">
                <span>Kembalian</span>
                <span className={val >= rem ? 'pos' : 'muted'} id="pay-change">
                  {val >= rem ? rp(change) : `kurang ${rp(rem - val)}`}
                </span>
              </div>
            )}
            {cash && (
              <div className="quick-cash">
                {cashSuggestions(rem).map((s, i) => (
                  <button key={s} className="chip" data-quick={s} onClick={() => setEntry(String(s))}>
                    {i === 0 ? 'Uang pas' : rp(s)}
                  </button>
                ))}
              </div>
            )}
            {!cash && cur.ref && (
              <label className="field" style={{ marginTop: 10 }}>
                <span>
                  {cur.platform ? 'ID pesanan ojol' : 'No. referensi / approval'} <em>{cur.platform ? '(opsional)' : '(wajib)'}</em>
                </span>
                <input className={`input sm ${needRef ? 'err' : ''}`} id="pay-ref" autoComplete="off" maxLength={cur.platform ? 40 : 60} value={ref} onChange={(e) => setRef(e.target.value)} />
              </label>
            )}
          </div>
          {payments.length > 0 && (
            <div className="paid-list">
              {payments.map((p, i) => (
                <div className="paid-item" key={p.id}>
                  <Icon name="check" size="sm" />
                  <span className="grow">
                    {p.name}
                    {p.ref && <span className="muted"> · {p.ref}</span>}
                  </span>
                  <b>{rp(p.method === 'CASH' ? (p.tendered ?? p.amount) : p.amount)}</b>
                  <button className="icon-btn sm danger" aria-label="Hapus pembayaran" onClick={() => setPayments(payments.filter((_, j) => j !== i))}>
                    <Icon name="x" size="sm" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          {cur.platform ? (
            <div className="note blue">
              <Icon name="info" size="sm" />
              <span>Pesanan {o.channelName} dibayar lewat aplikasi ojol. Pastikan pesanan sudah diterima di tablet ojol.</span>
            </div>
          ) : (
            <Numpad onKey={(k) => setEntry((x) => npKey(x, k))} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function DoneDialog({ paid, close }: { paid: Order; close: Close<void> }) {
  const [wa, setWa] = useState(paid.customerPhone || '');
  const [err, setErr] = useState(false);
  const opts = { branch: branch(), settings: settings() };
  return (
    <Modal
      title="Pembayaran berhasil"
      size="sm"
      foot={
        <>
          <button className="btn ghost" data-print onClick={() => printReceipt(paid, opts)}>
            <Icon name="printer" size="sm" /> Cetak struk
          </button>
          <button className="btn" data-new autoFocus onClick={() => close()}>
            Pesanan baru
          </button>
        </>
      }
    >
      <div className="done-box">
        <div className="ok">
          <Icon name="check" size="lg" />
        </div>
        {paid.change ? (
          <>
            <span className="muted">Kembalian</span>
            <div className="chg-big" id="done-change">
              {rp(paid.change)}
            </div>
          </>
        ) : (
          <div className="chg-big">{rp(paid.totals.total)}</div>
        )}
        <span className="muted">
          {paid.number} · antrean <b>{paid.queueNo}</b>
        </span>
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <span>
          Kirim struk ke WhatsApp <em>(opsional)</em>
        </span>
        <div className="row">
          <input className={`input ${err ? 'err' : ''}`} id="wa" type="tel" inputMode="tel" placeholder="08xxxxxxxxxx" value={wa} onChange={(e) => setWa(e.target.value)} />
          <button
            className="btn ghost"
            aria-label="Kirim WhatsApp"
            onClick={() => {
              const ph = wa.replace(/\D/g, '').replace(/^0/, '62');
              if (ph.length < 9) return setErr(true);
              window.open(`https://wa.me/${ph}?text=${encodeURIComponent(receiptText(paid, opts))}`, '_blank', 'noopener');
            }}
          >
            <Icon name="chat" size="sm" />
          </button>
        </div>
      </label>
    </Modal>
  );
}

/* =========================================================
   Ketersediaan menu cabang (tandai habis / tersedia)
   ========================================================= */
function SoldOutDialog() {
  useBusTick(['soldout', 'master']);
  const m = master();
  const [s, setS] = useState('');
  const list = m.products.filter((p) => !s || p.name.toLowerCase().includes(s.toLowerCase()));
  const toggle = async (p: MProduct) => {
    const out = !m.isSoldOut(p.id);
    try {
      await S.be.setSoldOut(p.id, out, S.user!);
      toast(`${p.name} ${out ? 'ditandai habis' : 'tersedia lagi'}`);
    } catch (err) {
      toast((err as Error).message || 'Gagal menyimpan', 'err');
    }
  };
  return (
    <Modal title="Ketersediaan menu" sub={`Berlaku untuk ${branch().name} di perangkat ini.`} size="lg">
      <div className="input-wrap" style={{ marginBottom: 10 }}>
        <Icon name="search" size="sm" />
        <input className="input" id="so-q" placeholder="Cari menu" autoComplete="off" value={s} onChange={(e) => setS(e.target.value)} />
      </div>
      <table className="table">
        <tbody>
          {list.map((p) => {
            const on = m.available(p);
            return (
              <tr key={p.id}>
                <td>
                  {p.name}
                  <span className="sub">{m.categoryOf(p.id)?.name ?? ''}</span>
                  {p.available === false && <span className="sub neg">Dinonaktifkan kantor pusat</span>}
                </td>
                <td className="r">
                  <button
                    className={`switch ${on ? 'on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Tersedia: ${p.name}`}
                    disabled={p.available === false}
                    onClick={() => void toggle(p)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
