/* =========================================================
   Layar kasir: pilih menu, atur pesanan, diskon, simpan tagihan, bayar.
   ========================================================= */
import { S, branch, master, settings, can, nav, today } from '../state.js';
import { $, $$, esc, icon, IMG, initials, modal, toast, confirmBox, promptBox, hydrateImgs, debounce } from '../lib/ui.js';
import { rp, pctLabel } from '../core/money.js';
import { defaultSel, groupVisible, chosenMods, missingRequired, channelPrice, paySummary, cashSuggestions, lineKey } from '../core/calc.js';
import { loadDraft, storeDraft, newDraft, priced, makeLine, changeChannel, saveOpen, payOrder, voidOrder, channelOf, payMethodsFor } from '../ops.js';
import { requireApproval } from '../components/approve.js';
import { numpadHTML, npKey, keyToNp } from '../components/numpad.js';
import { printReceipt, receiptText } from '../components/receipt.js';
import { openShiftDialog } from './shift.js';
import { bus } from '../data/bus.js';
import { renderRail } from '../app.js';

export async function mount(el) {
  const be = S.be; const b = branch();
  let o = loadDraft();
  if (o.branchId && o.branchId !== b.id) o = newDraft();
  let cat = 'all'; let q = ''; let levels = {};
  let cartOpen = false;

  el.classList.add('fixed');
  el.innerHTML = `<div class="sell">
      <section class="sell-menu">
        <div class="sm-head">
          <div class="sm-top">
            <div class="input-wrap">${icon('search', 'sm')}<input class="input" id="s-q" type="search" placeholder="Cari menu…  ( / )" autocomplete="off" aria-label="Cari menu"></div>
            <span class="shift-pill" id="s-shift"></span>
          </div>
          <div class="cats" id="s-cats" role="tablist"></div>
        </div>
        <div class="grid-wrap" id="s-grid"></div>
      </section>
      <aside class="cart" id="s-cart" aria-label="Pesanan"></aside>
    </div>
    <button class="cart-fab" id="s-fab" hidden></button>`;
  const $grid = $('#s-grid', el); const $cart = $('#s-cart', el); const $fab = $('#s-fab', el);

  /* ---------- muat tagihan terbuka dari halaman Tagihan ---------- */
  if (S.query.bill) {
    const bill = await be.get('orders', S.query.bill);
    history.replaceState(null, '', '#/kasir');
    if (bill && bill.status === 'open') {
      if (o.lines.length && o.id !== bill.id && o.status === 'draft' && !(await confirmBox({ title: 'Ganti pesanan?', text: 'Pesanan yang sedang dibuat belum disimpan dan akan dibuang.', ok: 'Buang & buka tagihan', danger: true }))) { /* tetap */ } else {
        o = { ...bill }; storeDraft(o);
      }
    }
  }

  /* ---------- data ---------- */
  const refreshLevels = async () => { levels = await be.stockLevels(b.id); };
  await refreshLevels();
  if (!S.shift) S.shift = await be.currentShift();

  const qtyOf = (id) => o.lines.filter((l) => l.itemId === id && !l.voided).reduce((a, l) => a + l.qty, 0);
  const stockLeft = (it) => (it.track ? (levels[it.id] || 0) - qtyOf(it.id) : Infinity);
  const blocked = (it) => !master().available(b.id, it) || (it.track && settings().blockNoStock !== false && stockLeft(it) <= 0);
  const priceOf = (it) => channelPrice(master().price(b.id, it), channelOf(o).markupPct);

  /* ---------- menu ---------- */
  function renderCats() {
    const cats = master().categories.filter((c) => c.active !== false && master().items.some((i) => i.catId === c.id && i.active !== false));
    $('#s-cats', el).innerHTML = [`<button class="chip ${cat === 'all' ? 'on' : ''}" data-cat="all" role="tab">Semua</button>`,
      ...cats.map((c) => `<button class="chip ${cat === c.id ? 'on' : ''}" data-cat="${c.id}" role="tab">${esc(c.name)}</button>`)].join('');
  }
  function card(it) {
    const out = blocked(it); const n = qtyOf(it.id); const left = stockLeft(it);
    const low = it.track && left !== Infinity && left <= (it.low || 5);
    return `<button class="prod ${out ? 'out' : ''}" data-item="${it.id}" ${out ? 'aria-disabled="true"' : ''}>
      <div class="ph">${it.img ? `<img data-fade src="${IMG(it.img)}" alt="" loading="lazy" decoding="async">` : ''}<span class="ini" ${it.img ? 'hidden' : ''}>${esc(initials(it.name))}</span></div>
      <div class="pb"><div class="pn">${esc(it.name)}${it.sig ? ' <span class="sig" aria-label="Signature">★</span>' : ''}</div><div class="pp">${rp(priceOf(it))}</div></div>
      <span class="qbadge" ${n ? '' : 'hidden'}>${n}</span>
      ${low && !out ? `<span class="sbadge tag ${left <= 0 ? 'red' : 'amber'}">Sisa ${Math.max(0, left)}</span>` : ''}
    </button>`;
  }
  function renderGrid() {
    const m = master();
    const s = q.trim().toLowerCase();
    let items = m.items.filter((i) => i.active !== false && (!m.cat[i.catId] || m.cat[i.catId].active !== false));
    if (s) items = items.filter((i) => i.name.toLowerCase().includes(s));
    else if (cat !== 'all') items = items.filter((i) => i.catId === cat);
    if (!items.length) { $grid.innerHTML = `<div class="empty"><div class="em-ico">${icon('search', 'lg')}</div><h3>Menu tidak ditemukan</h3><p>Coba kata lain.</p></div>`; return; }
    if (cat === 'all' && !s) {
      $grid.innerHTML = m.categories.map((c) => {
        const list = items.filter((i) => i.catId === c.id);
        return list.length ? `<h2 class="grid-sec">${esc(c.name)}</h2><div class="pgrid">${list.map(card).join('')}</div>` : '';
      }).join('');
    } else $grid.innerHTML = `<div class="pgrid">${items.map(card).join('')}</div>`;
    hydrateImgs($grid);
  }
  function updateBadges() {
    $$('.prod', $grid).forEach((p) => {
      const n = qtyOf(p.dataset.item); const bd = $('.qbadge', p);
      bd.textContent = n; bd.hidden = !n;
    });
  }

  /* ---------- keranjang ---------- */
  function commit(next, { grid = false } = {}) {
    o = priced(next);
    storeDraft(o);
    renderCart();
    if (grid) renderGrid(); else updateBadges();
  }
  function shiftPill() {
    const p = $('#s-shift', el);
    p.innerHTML = S.shift ? `<i></i><span>Shift ${esc(S.shift.openedByName.split(' ')[0])} · T${S.shift.terminalNo}</span>` : `${icon('lock', 'xs')}<span>Shift belum dibuka</span>`;
  }
  function renderCart() {
    const ch = channelOf(o); const t = o.totals || {}; const cfg = o.cfg || {};
    const chans = master().activeChannels();
    const base = chans.filter((c) => c.type !== 'platform');
    const plats = chans.filter((c) => c.type === 'platform');
    const lines = o.lines;
    const isOpen = o.status === 'open';
    $cart.innerHTML = `
      <div class="cart-head">
        <div class="ch-top">
          <button class="icon-btn cart-close" data-a="close-cart" aria-label="Tutup pesanan">${icon('chevron-right')}</button>
          <div class="grow"><b>${isOpen ? `Tagihan ${esc(o.queueNo || '')}` : 'Pesanan baru'}</b>${isOpen ? `<div class="muted" style="font-size:12px">${esc(o.number)} · tersimpan</div>` : ''}</div>
          ${isOpen ? `<button class="btn ghost sm" data-a="unload">${icon('x', 'sm')} Tutup</button>` : ''}
          <button class="icon-btn" data-a="more" aria-label="Lainnya">${icon('more')}</button>
        </div>
        <div class="seg block" role="radiogroup" aria-label="Tipe pesanan">
          ${base.map((c) => `<button class="${o.channel === c.id ? 'on' : ''}" data-ch="${c.id}" role="radio" aria-checked="${o.channel === c.id}">${esc(c.name)}</button>`).join('')}
          ${plats.length ? `<button class="${ch.type === 'platform' ? 'on' : ''}" data-a="plat">${ch.type === 'platform' ? esc(ch.name) : 'Ojol'} ${icon('chevron-down', 'xs')}</button>` : ''}
        </div>
        <div class="ch-meta">
          ${ch.type === 'dinein' ? `<input class="input sm" data-f="table" placeholder="No. meja" value="${esc(o.table)}" inputmode="numeric" aria-label="Nomor meja">` : ''}
          <input class="input sm" data-f="name" placeholder="${ch.type === 'platform' ? 'Nama / ID order ojol' : 'Nama pelanggan'}" value="${esc(o.customer.name)}" aria-label="Nama pelanggan" ${ch.type === 'dinein' ? '' : 'style="grid-column:span 2"'}>
        </div>
      </div>
      <div class="cart-lines" id="s-lines">
        ${lines.length ? lines.map((l) => {
          const lineDisc = l.disc ? Math.min(l.price * l.qty, l.disc.type === 'pct' ? Math.round((l.price * l.qty * l.disc.value) / 100) : l.disc.value) : 0;
          return `<button class="cl ${l.kAt ? 'sent' : ''} ${l.voided ? 'voided' : ''}" data-line="${l.id}">
            <span class="q">${l.qty}</span>
            <span class="n"><b>${esc(l.name)}</b>${l.sum ? `<small>${esc(l.sum)}</small>` : ''}${l.note ? `<small class="note-l">“${esc(l.note)}”</small>` : ''}${l.disc ? `<small class="disc-l">Diskon ${l.disc.type === 'pct' ? pctLabel(l.disc.value) : rp(l.disc.value)}</small>` : ''}${l.voided ? '<small class="neg">Dibatalkan</small>' : l.kAt ? `<small>${icon('check', 'xs')} Terkirim ke ${l.station === 'bar' ? 'bar' : 'dapur'}</small>` : ''}</span>
            <span class="p">${rp(l.voided ? 0 : l.price * l.qty - lineDisc)}${lineDisc ? `<s>${rp(l.price * l.qty)}</s>` : ''}</span>
          </button>`;
        }).join('') : `<div class="cart-empty"><div><div class="em-ico">${icon('bag', 'lg')}</div><b>Belum ada pesanan</b><p class="muted" style="margin:4px 0 0;font-size:13px">Ketuk menu di kiri untuk menambahkan.</p></div></div>`}
      </div>
      ${lines.length ? `<div class="cart-sum">
        <div class="sum-row"><span>Subtotal · ${t.items} item</span><span>${rp(t.gross)}</span></div>
        ${t.discount ? `<div class="sum-row disc"><span>Diskon${o.discount ? ` · ${esc(o.discount.name || '')}` : ''}</span><span>−${rp(t.discount)}</span></div>` : ''}
        ${t.service ? `<div class="sum-row"><span>Biaya layanan ${pctLabel(cfg.servicePct)}</span><span>${rp(t.service)}</span></div>` : ''}
        ${t.tax && !cfg.taxIncl ? `<div class="sum-row"><span>${esc(b.taxLabel || 'PB1')} ${pctLabel(cfg.taxPct)}</span><span>${rp(t.tax)}</span></div>` : ''}
        ${t.rounding ? `<div class="sum-row"><span>Pembulatan</span><span>${rp(t.rounding)}</span></div>` : ''}
        <div class="sum-row total"><span>Total</span><span>${rp(t.total)}</span></div>
        ${t.tax && cfg.taxIncl ? `<div class="sum-row info"><span>Termasuk ${esc(b.taxLabel || 'PB1')} ${pctLabel(cfg.taxPct)}</span><span>${rp(t.tax)}</span></div>` : ''}
      </div>` : ''}
      <div class="cart-actions">
        <button class="btn soft lg" data-a="disc" ${lines.length ? '' : 'disabled'} aria-label="Diskon">${icon('percent', 'sm')}</button>
        <button class="btn ghost lg" data-a="hold" ${lines.length ? '' : 'disabled'}>${icon('pause', 'sm')} ${isOpen ? 'Perbarui' : 'Simpan'}</button>
        <button class="btn lg pay-btn" data-a="pay" ${lines.some((l) => !l.voided) ? '' : 'disabled'}><span>Bayar</span><span>${rp(t.total || 0)}</span></button>
      </div>`;
    const n = lines.filter((l) => !l.voided).reduce((a, l) => a + l.qty, 0);
    $fab.hidden = !n && !isOpen;
    $fab.innerHTML = `<span class="n">${n}</span><span>${isOpen ? `Tagihan ${esc(o.queueNo || '')}` : 'Lihat pesanan'}</span><span class="t">${rp(t.total || 0)}</span>`;
    $cart.classList.toggle('open', cartOpen);
  }

  /* ---------- menu → baris ---------- */
  function addLine(line) {
    const key = lineKey(line);
    const ex = o.lines.find((l) => !l.kAt && !l.voided && !l.disc && lineKey(l) === key);
    const lines = ex ? o.lines.map((l) => (l === ex ? { ...l, qty: l.qty + line.qty } : l)) : [...o.lines, line];
    const it = master().item[line.itemId];
    commit({ ...o, lines }, { grid: !!(it && it.track) });
  }
  function tapItem(id) {
    const it = master().item[id]; if (!it) return;
    if (blocked(it)) { toast(master().available(b.id, it) ? `Stok ${it.name} habis` : `${it.name} sedang tidak tersedia`, 'warn'); return; }
    if (!it.opts || !it.opts.length) { addLine(makeLine(it, {}, { qty: 1 }, o)); return; }
    itemDialog(it);
  }

  function itemDialog(it, line = null) {
    const cats = master().cat[it.catId] || {};
    let sel = line ? { ...line.sel } : defaultSel(it);
    let qty = line ? line.qty : 1;
    let note = line ? line.note : '';
    let disc = line && line.disc ? { ...line.disc } : null;
    const sent = !!(line && line.kAt);
    const m = modal({ title: line ? 'Ubah pesanan' : 'Tambah pesanan', size: 'lg', body: '<div id="im"></div>', foot: '<div id="im-foot" class="row grow" style="justify-content:flex-end;gap:10px;flex-wrap:wrap"></div>' });
    const box = $('#im', m.el); const foot = $('#im-foot', m.el);
    const unitPrice = () => channelPrice(master().price(b.id, it) + chosenMods(it, sel).reduce((a, x) => a + x.p, 0), channelOf(o).markupPct);
    const paint = () => {
      const up = unitPrice();
      const gross = up * qty;
      const dAmt = disc ? Math.min(gross, disc.type === 'pct' ? Math.round((gross * disc.value) / 100) : disc.value) : 0;
      box.innerHTML = `<div class="im-top"><div class="ph">${it.img ? `<img src="${IMG(it.img)}" alt="">` : ''}</div><div class="grow"><b>${esc(it.name)}</b><span class="pr">${rp(up)}</span>${sent ? `<div class="note green" style="margin-top:8px;padding:8px 10px">${icon('check', 'xs')}<span>Sudah dikirim ke ${line.station === 'bar' ? 'bar' : 'dapur'} — hanya bisa dibatalkan.</span></div>` : ''}</div></div>
        ${sent ? '' : (it.opts || []).filter((g) => groupVisible(g, sel)).map((g) => `<div class="opt-group"><h4>${esc(g.name)} ${g.required ? '<span class="tag">Wajib</span>' : ''}${g.type === 'multi' ? '<span class="tag">Boleh lebih dari satu</span>' : ''}</h4>
          <div class="opts">${g.choices.map((c) => {
            const on = g.type === 'multi' ? (sel[g.id] || []).includes(c.n) : sel[g.id] === c.n;
            return `<button class="opt ${on ? 'on' : ''}" data-g="${g.id}" data-c="${esc(c.n)}">${esc(c.n)}${c.p ? `<small>+${rp(c.p)}</small>` : ''}</button>`;
          }).join('')}</div></div>`).join('')}
        ${sent ? '' : `<div class="opt-group"><h4>Catatan</h4><input class="input" id="im-note" placeholder="mis. tidak pedas" value="${esc(note)}" autocomplete="off">
          ${(cats.notes || []).length ? `<div class="quick-notes">${cats.notes.map((n) => `<button class="chip sm" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}</div>
        <div class="row wrap" style="margin-top:16px;gap:16px;align-items:flex-end">
          <div><div class="field-label" style="margin-bottom:6px">Jumlah</div><div class="stepper"><button data-q="-1" aria-label="Kurangi">${icon('minus')}</button><b>${qty}</b><button data-q="1" aria-label="Tambah">${icon('plus')}</button></div></div>
          ${line ? `<div><div class="field-label" style="margin-bottom:6px">Diskon item</div><div class="row"><div class="seg"><button class="${!disc ? 'on' : ''}" data-dt="">Tanpa</button><button class="${disc && disc.type === 'pct' ? 'on' : ''}" data-dt="pct">%</button><button class="${disc && disc.type === 'amt' ? 'on' : ''}" data-dt="amt">Rp</button></div>
            ${disc ? `<input class="input sm" id="im-dv" inputmode="numeric" style="width:110px" value="${disc.value || ''}" placeholder="${disc.type === 'pct' ? '10' : '5000'}" aria-label="Nilai diskon">` : ''}</div></div>` : ''}
        </div>`}`;
      const miss = missingRequired(it, sel);
      foot.innerHTML = `${line ? `<button class="btn danger ghost" data-del>${icon('trash', 'sm')} ${sent ? 'Batalkan item' : 'Hapus'}</button>` : ''}
        ${sent ? `<button class="btn ghost" data-again>${icon('plus', 'sm')} Pesan lagi</button>` : `<button class="btn lg" data-ok ${miss.length ? 'disabled' : ''}>${line ? 'Simpan' : 'Tambah'} · ${rp(gross - dAmt)}</button>`}`;
      hydrateImgs(box);
    };
    paint();
    m.el.addEventListener('input', (e) => {
      if (e.target.id === 'im-note') note = e.target.value;
      if (e.target.id === 'im-dv') {
        const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
        disc = { ...disc, value: disc.type === 'pct' ? Math.min(100, v) : v };
        const okBtn = $('[data-ok]', m.el);
        if (okBtn) { const up = unitPrice() * qty; const d = Math.min(up, disc.type === 'pct' ? Math.round((up * disc.value) / 100) : disc.value); okBtn.textContent = `Simpan · ${rp(up - d)}`; }
      }
    });
    m.el.addEventListener('click', async (e) => {
      const opt = e.target.closest('[data-g]');
      if (opt) {
        const g = it.opts.find((x) => x.id === opt.dataset.g); const c = opt.dataset.c;
        if (g.type === 'multi') { const cur = new Set(sel[g.id] || []); cur.has(c) ? cur.delete(c) : cur.add(c); sel = { ...sel, [g.id]: [...cur] }; } else sel = { ...sel, [g.id]: c };
        paint(); return;
      }
      const nb = e.target.closest('[data-note]');
      if (nb) { const n = nb.dataset.note; note = note ? (note.toLowerCase().includes(n.toLowerCase()) ? note : `${note}, ${n}`) : n; paint(); return; }
      const qb = e.target.closest('[data-q]');
      if (qb) { qty = Math.max(1, Math.min(999, qty + +qb.dataset.q)); paint(); return; }
      const dt = e.target.closest('[data-dt]');
      if (dt) { disc = dt.dataset.dt ? { type: dt.dataset.dt, value: disc && disc.type === dt.dataset.dt ? disc.value : 0 } : null; paint(); const i = $('#im-dv', m.el); if (i) i.focus(); return; }
      if (e.target.closest('[data-again]')) { m.close(); addLine(makeLine(it, line.sel, { qty: 1, note: line.note }, o)); return; }
      if (e.target.closest('[data-del]')) {
        if (!sent) { m.close(); commit({ ...o, lines: o.lines.filter((l) => l.id !== line.id) }); return; }
        const who = await requireApproval({ title: 'Batalkan item yang sudah dikirim', text: `${esc(line.qty)}x ${esc(line.name)} sudah dikirim ke ${line.station === 'bar' ? 'bar' : 'dapur'}.` });
        if (!who) return;
        const reason = await promptBox({ title: 'Alasan pembatalan', presets: ['Pelanggan batal', 'Salah input', 'Menu habis'], ok: 'Batalkan item', danger: true });
        if (!reason) return;
        m.close();
        const mark = (l) => (l.id === line.id ? { ...l, voided: true, voidReason: reason, voidBy: who.id, voidByName: who.name, voidAt: Date.now() } : l);
        let next = { ...o, lines: o.lines.map(mark) };
        if (o.status === 'open') {
          // simpan pembatalan saja; baris baru yang belum disimpan tetap di keranjang
          const saved = await be.get('orders', o.id);
          if (saved) { const upd = await be.save('orders', priced({ ...saved, lines: saved.lines.map(mark) })); next = { ...next, rev: upd.rev, updatedAt: upd.updatedAt }; }
        }
        commit(next, { grid: true });
        await be.audit('line.void', { number: o.number, item: line.name, qty: line.qty, reason }, who);
        return;
      }
      if (e.target.closest('[data-ok]')) {
        if (disc && disc.value > 0) {
          const gross = unitPrice() * qty;
          const pct = disc.type === 'pct' ? disc.value : (disc.value / Math.max(1, gross)) * 100;
          if (pct > (settings().maxDiscPct || 0) && !can('approve')) {
            const who = await requireApproval({ title: 'Diskon melebihi batas kasir', text: `Batas diskon kasir ${settings().maxDiscPct || 0}%.` });
            if (!who) return;
            disc = { ...disc, approvedBy: who.id, approvedByName: who.name };
          }
        } else disc = null;
        const nl = makeLine(it, sel, { qty, note }, o);
        m.close();
        if (line) commit({ ...o, lines: o.lines.map((l) => (l.id === line.id ? { ...nl, id: line.id, disc } : l)) });
        else addLine(nl);
      }
    });
  }

  /* ---------- diskon pesanan ---------- */
  async function discountDialog() {
    const promos = master().discountsFor(b.id, today());
    let type = o.discount && !o.discount.id ? o.discount.type : 'pct';
    let val = o.discount && !o.discount.id ? String(o.discount.value) : '';
    const m = modal({
      title: 'Diskon pesanan', sub: `Batas diskon manual kasir ${settings().maxDiscPct || 0}% — lebih dari itu perlu PIN manajer.`, size: 'sm',
      body: `${promos.length ? `<div class="field-label" style="margin-bottom:8px">Promo</div><div class="list" style="margin-bottom:16px">${promos.map((p) => `<button class="li ${o.discount && o.discount.id === p.id ? 'on' : ''}" data-promo="${p.id}"><span class="lq">${icon(p.type === 'pct' ? 'percent' : 'tag', 'sm')}</span><div><b>${esc(p.name)}</b><small>${p.type === 'pct' ? pctLabel(p.value) : rp(p.value)}${p.approval ? ' · perlu persetujuan manajer' : ''}</small></div></button>`).join('')}</div>` : ''}
        <div class="field-label" style="margin-bottom:8px">Diskon manual</div>
        <div class="row"><div class="seg"><button data-t="pct" class="${type === 'pct' ? 'on' : ''}">%</button><button data-t="amt" class="${type === 'amt' ? 'on' : ''}">Rp</button></div><input class="input" id="dv" inputmode="numeric" placeholder="${type === 'pct' ? 'mis. 10' : 'mis. 5000'}" value="${esc(val)}" aria-label="Nilai diskon"></div>
        <label class="field" style="margin-top:10px"><span>Keterangan <em>(opsional)</em></span><input class="input" id="dn" placeholder="mis. komplain pelanggan" value="${esc(o.discount && !o.discount.id ? o.discount.name || '' : '')}"></label>`,
      foot: `${o.discount ? '<button class="btn danger ghost" data-rm>Hapus diskon</button>' : ''}<button class="btn" data-apply>Terapkan manual</button>`,
    });
    m.el.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-t]');
      if (t) { type = t.dataset.t; $$('[data-t]', m.el).forEach((x) => x.classList.toggle('on', x === t)); $('#dv', m.el).placeholder = type === 'pct' ? 'mis. 10' : 'mis. 5000'; return; }
      if (e.target.closest('[data-rm]')) { m.close(); commit({ ...o, discount: null }); return; }
      const p = e.target.closest('[data-promo]');
      if (p) {
        const promo = master().discount[p.dataset.promo];
        let approved = null;
        if (promo.approval && !can('approve')) { approved = await requireApproval({ title: `Promo "${promo.name}"`, text: 'Promo ini perlu persetujuan manajer.' }); if (!approved) return; }
        m.close();
        commit({ ...o, discount: { id: promo.id, name: promo.name, type: promo.type, value: promo.value, ...(approved ? { approvedBy: approved.id, approvedByName: approved.name } : {}) } });
        if (approved) be.audit('discount.approve', { promo: promo.name, number: o.number || '' }, approved);
        return;
      }
      if (e.target.closest('[data-apply]')) {
        const v = parseInt($('#dv', m.el).value.replace(/\D/g, ''), 10) || 0;
        if (!v) { $('#dv', m.el).classList.add('err'); return; }
        const sub = (o.totals.gross || 0) - (o.totals.lineDisc || 0);
        const pct = type === 'pct' ? v : (v / Math.max(1, sub)) * 100;
        let approved = null;
        if (pct > (settings().maxDiscPct || 0) && !can('approve')) {
          approved = await requireApproval({ title: 'Diskon melebihi batas kasir', text: `Diskon ${type === 'pct' ? pctLabel(v) : rp(v)} melebihi ${settings().maxDiscPct || 0}%.` });
          if (!approved) return;
          be.audit('discount.approve', { type, value: v, number: o.number || '' }, approved);
        }
        const name = $('#dn', m.el).value.trim() || `Diskon ${type === 'pct' ? pctLabel(Math.min(100, v)) : rp(v)}`;
        m.close();
        commit({ ...o, discount: { type, value: type === 'pct' ? Math.min(100, v) : v, name, by: S.user.id, ...(approved ? { approvedBy: approved.id, approvedByName: approved.name } : {}) } });
      }
    });
  }

  /* ---------- simpan tagihan ---------- */
  async function ensureShift() {
    if (S.shift) return true;
    S.shift = await be.currentShift();
    if (S.shift) return true;
    const sh = await openShiftDialog();
    shiftPill();
    return !!sh;
  }
  async function hold() {
    if (!(await ensureShift())) return;
    const ch = channelOf(o);
    if (!o.table.trim() && !o.customer.name.trim()) {
      toast(ch.type === 'dinein' ? 'Isi nomor meja atau nama pelanggan dulu' : 'Isi nama pelanggan dulu', 'warn');
      const f = $(`[data-f="${ch.type === 'dinein' ? 'table' : 'name'}"]`, $cart); if (f) { f.classList.add('err'); f.focus(); }
      openCart(true);
      return;
    }
    const wasOpen = o.status === 'open';
    const saved = await saveOpen(o);
    toast(`${wasOpen ? 'Tagihan diperbarui' : 'Tagihan disimpan'} · antrean ${saved.queueNo} dikirim ke dapur`);
    o = newDraft(o.channel); storeDraft(o); commit(o, { grid: true });
    openCart(false);
    renderRail();
  }

  /* ---------- pembayaran ---------- */
  async function payDialog() {
    if (!(await ensureShift())) return;
    o = priced(o);
    const total = o.totals.total;
    const methods = payMethodsFor(o);
    const payments = [];
    let cur = methods[0]; let entry = ''; let ref = '';
    const m = modal({ title: 'Pembayaran', sub: `${esc(channelOf(o).name)}${o.table ? ` · Meja ${esc(o.table)}` : ''}${o.customer.name ? ` · ${esc(o.customer.name)}` : ''}`, size: 'lg', body: '<div id="pay"></div>', foot: '<div id="pay-foot" class="row grow" style="justify-content:flex-end;gap:10px;flex-wrap:wrap"></div>' });
    const box = $('#pay', m.el); const foot = $('#pay-foot', m.el);
    const remaining = () => paySummary(total, payments).remaining;
    const paint = () => {
      const rem = remaining();
      const cash = cur.type === 'cash';
      const val = entry ? parseInt(entry, 10) : 0;
      const showVal = cash ? val : (entry ? val : rem);
      const change = cash ? Math.max(0, val - rem) : 0;
      box.innerHTML = `<div class="pay-wrap">
        <div>
          <div class="pay-due"><div><small>${payments.length ? 'Sisa tagihan' : 'Total tagihan'}</small><br><b>${rp(rem)}</b></div>${payments.length ? `<small>dari ${rp(total)}</small>` : ''}</div>
          <div class="pay-methods" role="radiogroup">${methods.map((pm) => `<button class="pm ${cur.id === pm.id ? 'on' : ''}" data-pm="${pm.id}" role="radio" aria-checked="${cur.id === pm.id}">${icon(pm.type === 'cash' ? 'banknote' : pm.id === 'qris' ? 'qr' : pm.id === 'debit' || pm.id === 'credit' ? 'card' : pm.type === 'platform' ? 'scooter' : 'wallet', 'sm')}${esc(pm.name)}</button>`).join('')}</div>
          <div class="amount-box">
            <label>${cash ? 'Uang diterima' : 'Nominal'}</label>
            <div class="big num">${rp(showVal)}</div>
            ${cash ? `<div class="chg"><span>Kembalian</span><span class="${val >= rem ? 'pos' : 'muted'}">${val >= rem ? rp(change) : `kurang ${rp(rem - val)}`}</span></div>` : ''}
            ${cash ? `<div class="quick-cash">${cashSuggestions(rem).map((s, i) => `<button class="chip" data-quick="${s}">${i === 0 ? 'Uang pas' : rp(s)}</button>`).join('')}</div>` : ''}
            ${!cash && cur.ref ? `<label class="field" style="margin-top:10px"><span>${cur.type === 'platform' ? 'ID pesanan ojol' : 'No. referensi / approval'} <em>(opsional)</em></span><input class="input sm" id="pay-ref" value="${esc(ref)}" autocomplete="off"></label>` : ''}
          </div>
          ${payments.length ? `<div class="paid-list">${payments.map((p, i) => `<div class="paid-item">${icon('check', 'sm')}<span class="grow">${esc(p.name)}${p.ref ? ` <span class="muted">· ${esc(p.ref)}</span>` : ''}</span><b>${rp(p.type === 'cash' ? p.tendered : p.amount)}</b><button class="icon-btn sm danger" data-rmpay="${i}" aria-label="Hapus pembayaran">${icon('x', 'sm')}</button></div>`).join('')}</div>` : ''}
        </div>
        <div>${cur.type === 'platform' ? `<div class="note blue">${icon('info', 'sm')}<span>Pesanan ${esc(channelOf(o).name)} dibayar lewat aplikasi ojol. Pastikan pesanan sudah diterima di tablet ojol.</span></div>` : numpadHTML()}</div>
      </div>`;
      const okDisabled = cash ? val < rem : false;
      foot.innerHTML = `${cur.type !== 'platform' ? `<button class="btn ghost" data-split ${(!cash && entry && val > 0 && val < rem) || (cash && val > 0 && val < rem) ? '' : 'disabled'}>${icon('plus', 'sm')} Bagi pembayaran</button>` : ''}
        <button class="btn lg" data-finish ${okDisabled ? 'disabled' : ''}>${icon('check', 'sm')} Selesaikan · ${rp(rem)}</button>`;
    };
    paint();
    const take = (amountApplied) => {
      const p = { method: cur.id, name: cur.name, type: cur.type, amount: amountApplied };
      if (cur.type === 'cash') p.tendered = parseInt(entry, 10) || amountApplied;
      if (ref.trim()) p.ref = ref.trim();
      payments.push(p);
      entry = ''; ref = '';
    };
    m.el.addEventListener('input', (e) => { if (e.target.id === 'pay-ref') ref = e.target.value; });
    m.el.addEventListener('click', async (e) => {
      const pm = e.target.closest('[data-pm]'); if (pm) { cur = methods.find((x) => x.id === pm.dataset.pm); entry = ''; paint(); return; }
      const k = e.target.closest('[data-np]'); if (k) { entry = npKey(entry, k.dataset.np); paint(); return; }
      const qk = e.target.closest('[data-quick]'); if (qk) { entry = qk.dataset.quick; paint(); return; }
      const rmp = e.target.closest('[data-rmpay]'); if (rmp) { payments.splice(+rmp.dataset.rmpay, 1); paint(); return; }
      if (e.target.closest('[data-split]')) {
        const val = parseInt(entry, 10) || 0; const rem = remaining();
        if (val <= 0 || val >= rem) return;
        take(val); cur = methods.find((x) => x.id !== 'cash' && x.type !== 'platform') || methods[0]; paint(); return;
      }
      if (e.target.closest('[data-finish]')) {
        const rem = remaining();
        if (cur.type === 'cash') { const val = parseInt(entry, 10) || 0; if (val < rem) return; take(rem); } else take(rem);
        const btn = e.target.closest('[data-finish]'); btn.disabled = true;
        try {
          const paid = await payOrder(o, payments);
          m.close();
          done(paid);
        } catch (err) {
          payments.pop(); btn.disabled = false;
          toast(err.message || 'Pembayaran gagal disimpan', 'err');
        }
      }
    });
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = keyToNp(e);
      if (k && cur.type !== 'platform') { entry = npKey(entry, k); paint(); }
      else if (e.key === 'Enter') { const f = $('[data-finish]', m.el); if (f && !f.disabled) f.click(); }
    };
    document.addEventListener('keydown', onKey);
    m.result.then(() => document.removeEventListener('keydown', onKey));
  }

  function done(paid) {
    o = newDraft(o.channel); storeDraft(o);
    refreshLevels().then(() => { commit(o, { grid: true }); });
    openCart(false);
    renderRail();
    const opts = { branch: b, settings: settings() };
    if (settings().autoPrint) printReceipt(paid, opts);
    const m = modal({
      title: 'Pembayaran berhasil', size: 'sm',
      body: `<div class="done-box"><div class="ok">${icon('check', 'lg')}</div>
        ${paid.change ? `<span class="muted">Kembalian</span><div class="chg-big">${rp(paid.change)}</div>` : `<div class="chg-big">${rp(paid.totals.total)}</div>`}
        <span class="muted">${esc(paid.number)} · antrean <b>${esc(paid.queueNo)}</b></span></div>
        <label class="field" style="margin-top:8px"><span>Kirim struk ke WhatsApp <em>(opsional)</em></span><div class="row"><input class="input" id="wa" type="tel" inputmode="tel" placeholder="08xxxxxxxxxx" value="${esc(paid.customer && paid.customer.phone)}"><button class="btn ghost" data-wa>${icon('chat', 'sm')}</button></div></label>`,
      foot: `<button class="btn ghost" data-print>${icon('printer', 'sm')} Cetak struk</button><button class="btn" data-close autofocus>Pesanan baru</button>`,
    });
    m.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-print]')) printReceipt(paid, opts);
      if (e.target.closest('[data-wa]')) {
        const ph = $('#wa', m.el).value.replace(/\D/g, '').replace(/^0/, '62');
        if (ph.length < 9) { $('#wa', m.el).classList.add('err'); return; }
        window.open(`https://wa.me/${ph}?text=${encodeURIComponent(receiptText(paid, opts))}`, '_blank', 'noopener');
      }
    });
  }

  /* ---------- lain-lain ---------- */
  function openCart(on) { cartOpen = on; $cart.classList.toggle('open', on); }
  async function more() {
    const isOpen = o.status === 'open';
    const m = modal({
      title: isOpen ? `Tagihan ${o.queueNo}` : 'Pesanan', size: 'sm',
      body: `<div class="col">
        ${isOpen ? `<button class="btn danger ghost block" data-x="void">${icon('x-circle', 'sm')} Batalkan tagihan (void)</button>` : `<button class="btn ghost block" data-x="clear" ${o.lines.length ? '' : 'disabled'}>${icon('trash', 'sm')} Kosongkan pesanan</button>`}
        <button class="btn ghost block" data-x="soldout">${icon('box', 'sm')} Tandai menu habis / tersedia</button>
        <button class="btn ghost block" data-x="bills">${icon('pause', 'sm')} Lihat tagihan terbuka</button>
      </div>`,
    });
    m.el.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      m.close();
      if (x.dataset.x === 'clear') { if (await confirmBox({ title: 'Kosongkan pesanan?', ok: 'Kosongkan', danger: true })) { o = newDraft(o.channel); commit(o, { grid: true }); } }
      if (x.dataset.x === 'bills') nav('tagihan');
      if (x.dataset.x === 'soldout') soldOutDialog();
      if (x.dataset.x === 'void') {
        const who = await requireApproval({ title: 'Batalkan tagihan', text: `Tagihan ${esc(o.number)} (${rp(o.totals.total)}) akan dibatalkan.` });
        if (!who) return;
        const reason = await promptBox({ title: 'Alasan pembatalan', presets: ['Pelanggan batal', 'Salah input', 'Tagihan ganda'], ok: 'Batalkan tagihan', danger: true });
        if (!reason) return;
        const saved = await be.get('orders', o.id);
        await voidOrder(saved || o, { reason, approver: who });
        toast('Tagihan dibatalkan', 'warn');
        o = newDraft(o.channel); commit(o, { grid: true }); renderRail();
      }
    });
  }

  function soldOutDialog() {
    const items = master().items.filter((i) => i.active !== false);
    let s = '';
    const m = modal({ title: 'Ketersediaan menu', sub: `Berlaku untuk ${esc(b.name)} saja.`, size: 'lg', body: `<div class="input-wrap" style="margin-bottom:10px">${icon('search', 'sm')}<input class="input" id="so-q" placeholder="Cari menu" autocomplete="off"></div><div id="so-list"></div>` });
    const paint = () => {
      const list = items.filter((i) => !s || i.name.toLowerCase().includes(s));
      $('#so-list', m.el).innerHTML = `<table class="table"><tbody>${list.map((i) => { const on = master().available(b.id, i); return `<tr><td>${esc(i.name)}<span class="sub">${esc((master().cat[i.catId] || {}).name || '')}</span></td><td class="r"><button class="switch ${on ? 'on' : ''}" data-av="${i.id}" role="switch" aria-checked="${on}" aria-label="Tersedia: ${esc(i.name)}"></button></td></tr>`; }).join('')}</tbody></table>`;
    };
    paint();
    $('#so-q', m.el).addEventListener('input', debounce((e) => { s = e.target.value.trim().toLowerCase(); paint(); }, 120));
    m.el.addEventListener('click', async (e) => {
      const sw = e.target.closest('[data-av]'); if (!sw) return;
      const id = sw.dataset.av; const key = `${b.id}:${id}`;
      const cur = master().ov[key] || { id: key, branchId: b.id, itemId: id };
      const avail = !master().available(b.id, master().item[id]);
      try {
        await be.saveMaster('itemBranch', { ...cur, available: avail }, S.user);
        paint(); renderGrid();
        toast(`${master().item[id].name} ${avail ? 'tersedia lagi' : 'ditandai habis'}`);
      } catch (err) { toast(err.message || 'Gagal menyimpan (perlu online)', 'err'); }
    });
  }

  /* ---------- event ---------- */
  el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; q = ''; $('#s-q', el).value = ''; renderCats(); renderGrid(); $grid.scrollTop = 0; return; }
    const p = e.target.closest('[data-item]'); if (p) { tapItem(p.dataset.item); return; }
    const ln = e.target.closest('[data-line]'); if (ln) { const l = o.lines.find((x) => x.id === ln.dataset.line); if (l && !l.voided) { const it = master().item[l.itemId]; if (it) itemDialog(it, l); } return; }
    const ch = e.target.closest('[data-ch]'); if (ch) { commit(changeChannel(o, ch.dataset.ch), { grid: true }); return; }
    if (e.target.closest('#s-fab')) { openCart(true); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'close-cart': openCart(false); break;
      case 'disc': discountDialog(); break;
      case 'hold': hold(); break;
      case 'pay': payDialog(); break;
      case 'more': more(); break;
      case 'unload': o = newDraft(o.channel); commit(o, { grid: true }); toast('Tagihan tetap tersimpan di Tagihan'); break;
      case 'plat': {
        const plats = master().activeChannels().filter((x) => x.type === 'platform');
        const m = modal({ title: 'Pesanan ojol', size: 'sm', body: `<div class="list">${plats.map((x) => `<button class="li" data-pl="${x.id}"><span class="lq">${icon('scooter', 'sm')}</span><div><b>${esc(x.name)}</b><small>${x.markupPct ? `Harga +${pctLabel(x.markupPct)}` : 'Harga sama dengan menu'}</small></div></button>`).join('')}</div>` });
        m.el.addEventListener('click', (ev) => { const pl = ev.target.closest('[data-pl]'); if (pl) { m.close(); commit(changeChannel(o, pl.dataset.pl), { grid: true }); } });
        break;
      }
      default:
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 's-q') { q = e.target.value; renderGrid(); return; }
    const f = e.target.dataset.f;
    if (f === 'table') { o = { ...o, table: e.target.value }; storeDraft(o); e.target.classList.remove('err'); }
    if (f === 'name') { o = { ...o, customer: { ...o.customer, name: e.target.value } }; storeDraft(o); e.target.classList.remove('err'); }
  });
  const onKey = (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && !document.querySelector('.modal-bd')) { e.preventDefault(); $('#s-q', el).focus(); }
  };
  document.addEventListener('keydown', onKey);

  /* ---------- mulai ---------- */
  o = priced(o);
  renderCats(); renderGrid(); renderCart(); shiftPill();
  if (!S.shift) setTimeout(() => { if (document.contains(el) && !S.shift) ensureShift().then(() => shiftPill()); }, 250);

  const offs = [
    bus.on('master', () => { renderCats(); renderGrid(); o = priced(o); renderCart(); }),
    bus.on('stockMoves', () => refreshLevels().then(renderGrid)),
    bus.on('stock', () => refreshLevels().then(renderGrid)),
    bus.on('orders', async (d) => {
      // tagihan yang sedang dibuka diubah/dibayar di terminal lain
      if (o.status !== 'open') return;
      const cur = await be.get('orders', o.id);
      if (cur && cur.status !== 'open') { toast(`Tagihan ${o.queueNo} sudah ${cur.status === 'paid' ? 'dibayar' : 'dibatalkan'} di terminal lain`, 'warn'); o = newDraft(o.channel); commit(o, { grid: true }); }
      else if (cur && d && d.remote && (cur.rev || 0) > (o.rev || 0)) { o = priced(cur); storeDraft(o); renderCart(); }
    }),
  ];
  return () => { offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); el.classList.remove('fixed'); };
}
