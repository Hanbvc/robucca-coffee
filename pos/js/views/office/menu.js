/* =========================================================
   Menu & harga: satu daftar menu pusat untuk semua cabang, dengan
   ketersediaan & harga khusus per cabang. Manajer hanya mengatur
   ketersediaan di cabangnya; pemilik mengatur semuanya.
   ========================================================= */
import { S, master, can } from '../../state.js';
import { $, esc, icon, IMG, modal, drawer, toast, confirmBox, debounce, hydrateImgs } from '../../lib/ui.js';
import { rp, parse } from '../../core/money.js';
import { uuid } from '../../core/ids.js';
import { pageHead, myBranches } from './common.js';

const STATIONS = [['', 'Ikuti kategori'], ['bar', 'Bar'], ['kitchen', 'Dapur'], ['none', 'Tanpa dapur (langsung saji)']];
const CAT_STATIONS = [['bar', 'Bar'], ['kitchen', 'Dapur'], ['none', 'Tanpa dapur']];

export async function mount(el) {
  const owner = can('menu.edit');
  const branches = myBranches();
  let bid = sessionStorage.getItem('pos:menu:branch') || (S.be.device.branchId && branches.some((b) => b.id === S.be.device.branchId) ? S.be.device.branchId : (branches[0] || {}).id);
  if (!branches.some((b) => b.id === bid)) bid = (branches[0] || {}).id;
  let cat = 'all'; let q = '';

  el.innerHTML = `${pageHead('Menu & harga', owner ? 'Menu berlaku di semua cabang · atur ketersediaan & harga khusus per cabang' : 'Atur ketersediaan menu di cabang Anda',
    `${owner ? `<button class="btn ghost sm" data-a="new-cat">${icon('plus', 'sm')} Kategori</button><button class="btn sm" data-a="new-item">${icon('plus', 'sm')} Menu baru</button>` : ''}`)}
    <div class="page">
      <div class="filters">
        <select class="select sm" data-branch aria-label="Cabang">${branches.map((b) => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <span class="sep"></span><div id="m-cats" class="row wrap" style="gap:6px"></div>
        <div class="input-wrap right" style="width:220px">${icon('search', 'sm')}<input class="input sm" data-q type="search" placeholder="Cari menu" autocomplete="off"></div>
      </div>
      <div class="table-card" id="m-table"></div>
    </div>`;

  function renderCats() {
    const m = master();
    $('#m-cats', el).innerHTML = [`<button class="chip sm ${cat === 'all' ? 'on' : ''}" data-cat="all">Semua <span class="n">${m.items.length}</span></button>`,
      ...m.categories.map((c) => `<button class="chip sm ${cat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)} <span class="n">${m.items.filter((i) => i.catId === c.id).length}</span>${c.active === false ? ' · nonaktif' : ''}</button>`),
      owner && cat !== 'all' ? `<button class="btn ghost xs" data-a="edit-cat">${icon('edit', 'xs')} Ubah kategori</button>` : ''].join('');
  }
  function render() {
    const m = master();
    let items = m.items;
    if (cat !== 'all') items = items.filter((i) => i.catId === cat);
    const s = q.trim().toLowerCase();
    if (s) items = items.filter((i) => i.name.toLowerCase().includes(s));
    $('#m-table', el).innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Menu</th><th>Kategori</th><th class="r">Harga pusat</th><th class="r">Harga di cabang</th><th>Stasiun</th><th>Stok</th><th>Tersedia di cabang</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>
      ${items.map((it) => {
        const ov = m.override(bid, it.id); const avail = m.available(bid, it);
        const special = ov && ov.price != null && ov.price !== '';
        const st = it.station || (m.cat[it.catId] || {}).station;
        return `<tr><td><div class="cell-row"><span class="thumb">${it.img ? `<img src="${IMG(it.img)}" alt="" loading="lazy">` : ''}</span><div><b>${esc(it.name)}</b>${it.sig ? ' <span class="tag amber">Signature</span>' : ''}${it.active === false ? ' <span class="tag red">Nonaktif</span>' : ''}<span class="sub">${(it.opts || []).length ? `${it.opts.length} grup opsi` : 'tanpa opsi'}</span></div></div></td>
          <td>${esc((m.cat[it.catId] || {}).name || '-')}</td>
          <td class="r">${rp(it.price)}</td>
          <td class="r">${special ? `<b>${rp(ov.price)}</b><span class="sub">harga khusus</span>` : '<span class="muted">sama</span>'}</td>
          <td>${st === 'bar' ? 'Bar' : st === 'none' ? 'Langsung' : 'Dapur'}</td>
          <td>${it.track ? `<span class="tag blue">Dilacak</span>` : '<span class="muted">—</span>'}</td>
          <td><button class="switch ${avail ? 'on' : ''}" data-avail="${it.id}" role="switch" aria-checked="${avail}" aria-label="Tersedia di cabang: ${esc(it.name)}" ${it.active === false ? 'disabled' : ''}></button></td>
          ${owner ? `<td class="r"><button class="btn ghost xs" data-edit="${it.id}">${icon('edit', 'xs')} Ubah</button></td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">Tidak ada menu.</td></tr>`}
    </tbody></table></div>`;
    hydrateImgs($('#m-table', el));
  }

  async function toggleAvail(itemId) {
    const m = master(); const key = `${bid}:${itemId}`;
    const cur = m.ov[key] || { id: key, branchId: bid, itemId };
    const next = !m.available(bid, m.item[itemId]);
    try {
      await S.be.saveMaster('itemBranch', { ...cur, available: next }, S.user);
      toast(`${m.item[itemId].name} ${next ? 'tersedia' : 'tidak tersedia'} di ${(m.branch[bid] || {}).name}`);
      render();
    } catch (e) { toast(e.message || 'Gagal menyimpan', 'err'); }
  }

  /* ---------- editor kategori ---------- */
  function catDialog(c = null) {
    const isNew = !c;
    const doc = c ? { ...c } : { id: '', name: '', group: 'food', station: 'kitchen', notes: [], sort: master().categories.length + 1, active: true };
    const m = modal({
      title: isNew ? 'Kategori baru' : `Ubah kategori ${c.name}`, size: 'sm',
      body: `<div class="col">
        <label class="field"><span>Nama kategori</span><input class="input" id="c-name" value="${esc(doc.name)}" autofocus></label>
        <label class="field"><span>Dikirim ke</span><select class="select" id="c-st">${CAT_STATIONS.map(([v, l]) => `<option value="${v}" ${doc.station === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Kelompok</span><select class="select" id="c-gr">${[['food', 'Makanan'], ['snack', 'Snack, Pastry & Dessert'], ['drinks', 'Minuman']].map(([v, l]) => `<option value="${v}" ${doc.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Catatan cepat <em>(pisahkan dengan koma)</em></span><input class="input" id="c-notes" value="${esc((doc.notes || []).join(', '))}" placeholder="Tidak pedas, Saus dipisah"></label>
        <label class="field"><span>Urutan</span><input class="input" id="c-sort" type="number" min="1" value="${doc.sort || 1}"></label>
        <div class="switch-row"><div class="grow"><b>Aktif</b><small>Kategori nonaktif disembunyikan dari kasir</small></div><button class="switch ${doc.active !== false ? 'on' : ''}" id="c-act" role="switch" aria-checked="${doc.active !== false}" aria-label="Aktif"></button></div>
      </div>`,
      foot: '<button class="btn ghost" data-close>Batal</button><button class="btn" data-ok>Simpan</button>',
    });
    $('#c-act', m.el).addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
    $('[data-ok]', m.el).addEventListener('click', async () => {
      const name = $('#c-name', m.el).value.trim();
      if (!name) { $('#c-name', m.el).classList.add('err'); return; }
      const out = {
        ...doc, id: doc.id || `cat-${uuid().slice(0, 8)}`, name, station: $('#c-st', m.el).value, group: $('#c-gr', m.el).value,
        notes: $('#c-notes', m.el).value.split(',').map((x) => x.trim()).filter(Boolean), sort: +$('#c-sort', m.el).value || 1, active: $('#c-act', m.el).classList.contains('on'),
      };
      try { await S.be.saveMaster('categories', out, S.user); m.close(); toast('Kategori disimpan'); cat = out.id; renderCats(); render(); } catch (e) { toast(e.message, 'err'); }
    });
  }

  /* ---------- editor menu ---------- */
  function itemDrawer(item = null) {
    const m0 = master();
    const isNew = !item;
    const it = item ? JSON.parse(JSON.stringify(item)) : { id: '', catId: cat !== 'all' ? cat : (m0.categories[0] || {}).id, name: '', price: 0, img: '', opts: [], sig: false, active: true, track: false, low: 5, station: '', sort: 999 };
    const gallery = [...new Set([...(window.MG_MENU || []).flatMap((c) => c.items.map((x) => (x.img === undefined ? x.id : x.img))), ...m0.items.map((x) => x.img)].filter(Boolean))].sort();
    const ovs = {}; m0.branches.forEach((b) => { const o = m0.override(b.id, it.id); ovs[b.id] = { price: o && o.price != null ? String(o.price) : '', available: !(o && o.available === false) }; });
    const d = drawer({ title: isNew ? 'Menu baru' : `Ubah ${it.name}`, wide: true, body: '<div id="ie"></div>', foot: `${isNew ? '' : `<button class="btn danger ghost" data-del>${it.active === false ? 'Aktifkan lagi' : 'Nonaktifkan'}</button>`}<button class="btn ghost" data-close>Batal</button><button class="btn" data-save>Simpan menu</button>` });
    const box = $('#ie', d.el);
    const paint = () => {
      box.innerHTML = `<div class="form-grid">
        <label class="field full"><span>Nama menu</span><input class="input" data-k="name" value="${esc(it.name)}"></label>
        <label class="field"><span>Kategori</span><select class="select" data-k="catId">${m0.categories.map((c) => `<option value="${c.id}" ${it.catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Harga pusat (Rp)</span><input class="input money" data-k="price" inputmode="numeric" value="${it.price ? it.price.toLocaleString('id-ID') : ''}"></label>
        <label class="field"><span>Dikirim ke</span><select class="select" data-k="station">${STATIONS.map(([v, l]) => `<option value="${v}" ${(it.station || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field"><span>Foto</span><button class="btn ghost" data-pickimg style="justify-content:flex-start">${it.img ? `<img src="${IMG(it.img)}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : icon('grid', 'sm')} ${it.img ? esc(it.img) : 'Pilih foto'}</button></div>
        <div class="full row wrap" style="gap:18px">
          <div class="switch-row"><button class="switch ${it.sig ? 'on' : ''}" data-sw="sig" role="switch" aria-checked="${!!it.sig}" aria-label="Signature"></button><div><b>Signature</b><small>Tanda ★ di kasir</small></div></div>
          <div class="switch-row"><button class="switch ${it.track ? 'on' : ''}" data-sw="track" role="switch" aria-checked="${!!it.track}" aria-label="Lacak stok"></button><div><b>Lacak stok</b><small>Untuk pastry/produk jadi</small></div></div>
          ${it.track ? `<label class="field" style="width:150px"><span>Batas stok menipis</span><input class="input sm" data-k="low" type="number" min="0" value="${it.low ?? 5}"></label>` : ''}
        </div>
      </div>
      <div class="section-title"><h3>Opsi menu</h3><span class="hint">mis. ukuran, level gula, level es</span><button class="btn ghost xs right" data-addgrp>${icon('plus', 'xs')} Grup opsi</button></div>
      <div class="col">${(it.opts || []).map((g, gi) => `<div class="opt-editor">
          <div class="oe-head"><input class="input sm" data-g="${gi}" data-gk="name" value="${esc(g.name)}" placeholder="Nama grup (mis. Ukuran)" style="flex:1">
            <select class="select sm" data-g="${gi}" data-gk="type" style="width:150px"><option value="single" ${g.type !== 'multi' ? 'selected' : ''}>Pilih satu</option><option value="multi" ${g.type === 'multi' ? 'selected' : ''}>Boleh banyak</option></select>
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" data-g="${gi}" data-gk="required" ${g.required ? 'checked' : ''}> Wajib</label>
            <button class="icon-btn sm danger" data-rmgrp="${gi}" aria-label="Hapus grup">${icon('trash', 'sm')}</button></div>
          ${g.showIf ? `<p class="hint">Muncul hanya bila ${esc(Object.entries(g.showIf).map(([k, v]) => `${k} = ${[].concat(v).join(' / ')}`).join(', '))}</p>` : ''}
          ${g.choices.map((c, ci) => `<div class="choice-row"><input class="input sm" data-g="${gi}" data-c="${ci}" data-ck="n" value="${esc(c.n)}" placeholder="Pilihan"><input class="input sm money" data-g="${gi}" data-c="${ci}" data-ck="p" inputmode="numeric" value="${c.p ? c.p.toLocaleString('id-ID') : ''}" placeholder="+Rp"><button class="icon-btn sm danger" data-rmch="${gi}:${ci}" aria-label="Hapus pilihan">${icon('x', 'sm')}</button></div>`).join('')}
          <button class="btn ghost xs" data-addch="${gi}" style="justify-self:start">${icon('plus', 'xs')} Pilihan</button>
        </div>`).join('') || '<p class="muted" style="margin:0">Tanpa opsi — langsung masuk keranjang saat diketuk.</p>'}</div>
      <div class="section-title"><h3>Per cabang</h3><span class="hint">Kosongkan harga khusus untuk memakai harga pusat</span></div>
      <table class="table ov-table"><thead><tr><th>Cabang</th><th>Tersedia</th><th>Harga khusus</th></tr></thead><tbody>
        ${m0.branches.map((b) => `<tr><td>${esc(b.name)}${b.active === false ? ' <span class="tag">nonaktif</span>' : ''}</td><td><button class="switch ${ovs[b.id].available ? 'on' : ''}" data-ovav="${b.id}" role="switch" aria-checked="${ovs[b.id].available}" aria-label="Tersedia di ${esc(b.name)}"></button></td>
          <td><input class="input sm money" data-ovp="${b.id}" inputmode="numeric" value="${ovs[b.id].price ? (+ovs[b.id].price).toLocaleString('id-ID') : ''}" placeholder="${rp(it.price || 0)}"></td></tr>`).join('')}
      </tbody></table>`;
      hydrateImgs(box);
    };
    paint();
    box.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.k) it[t.dataset.k] = t.dataset.k === 'price' ? parse(t.value) : t.dataset.k === 'low' ? +t.value : t.value;
      if (t.dataset.gk === 'name') it.opts[+t.dataset.g].name = t.value;
      if (t.dataset.ck) { const c = it.opts[+t.dataset.g].choices[+t.dataset.c]; if (t.dataset.ck === 'p') { const v = parse(t.value); if (v) c.p = v; else delete c.p; } else c.n = t.value; }
      if (t.dataset.ovp) ovs[t.dataset.ovp].price = String(parse(t.value) || '');
      if (t.classList.contains('money')) { const v = parse(t.value); const pos = t.value.length; t.value = v ? v.toLocaleString('id-ID') : ''; if (pos) t.setSelectionRange(t.value.length, t.value.length); }
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.k === 'catId' || t.dataset.k === 'station') it[t.dataset.k] = t.value;
      if (t.dataset.gk === 'type') it.opts[+t.dataset.g].type = t.value;
      if (t.dataset.gk === 'required') it.opts[+t.dataset.g].required = t.checked;
    });
    box.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-sw]'); if (sw) { it[sw.dataset.sw] = !it[sw.dataset.sw]; paint(); return; }
      const av = e.target.closest('[data-ovav]'); if (av) { ovs[av.dataset.ovav].available = !ovs[av.dataset.ovav].available; paint(); return; }
      if (e.target.closest('[data-addgrp]')) { it.opts = [...(it.opts || []), { id: `g${uuid().slice(0, 6)}`, name: '', type: 'single', choices: [{ n: '' }] }]; paint(); return; }
      const rg = e.target.closest('[data-rmgrp]'); if (rg) { it.opts.splice(+rg.dataset.rmgrp, 1); paint(); return; }
      const ac = e.target.closest('[data-addch]'); if (ac) { it.opts[+ac.dataset.addch].choices.push({ n: '' }); paint(); return; }
      const rc = e.target.closest('[data-rmch]'); if (rc) { const [g, c] = rc.dataset.rmch.split(':').map(Number); it.opts[g].choices.splice(c, 1); paint(); return; }
      if (e.target.closest('[data-pickimg]')) {
        const pm = modal({ title: 'Pilih foto', size: 'lg', body: `<div class="img-pick">${['', ...gallery].map((g) => `<button class="${it.img === g ? 'on' : ''}" data-img="${esc(g)}" title="${esc(g || 'Tanpa foto')}">${g ? `<img src="${IMG(g)}" alt="${esc(g)}" loading="lazy">` : `<span style="display:grid;place-items:center;height:100%;font-size:12px">Tanpa foto</span>`}</button>`).join('')}</div><p class="hint" style="margin-top:10px">Foto baru: simpan berkas JPG ke folder assets/img dengan nama yang sama seperti ID menu.</p>` });
        pm.el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-img]'); if (b) { it.img = b.dataset.img; pm.close(); paint(); } });
      }
    });
    d.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-del]')) {
        const turnOn = it.active === false;
        if (!turnOn && !(await confirmBox({ title: `Nonaktifkan ${it.name}?`, text: 'Menu disembunyikan dari kasir di semua cabang. Riwayat penjualan tetap tersimpan.', ok: 'Nonaktifkan', danger: true }))) return;
        try { await S.be.saveMaster('items', { ...item, active: turnOn }, S.user); d.close(); toast(turnOn ? 'Menu aktif lagi' : 'Menu dinonaktifkan'); render(); } catch (er) { toast(er.message, 'err'); }
        return;
      }
      if (!e.target.closest('[data-save]')) return;
      it.name = it.name.trim();
      if (!it.name || !it.catId || !(it.price >= 0)) { toast('Lengkapi nama, kategori, dan harga', 'warn'); return; }
      it.opts = (it.opts || []).map((g) => ({ ...g, name: g.name.trim() || 'Opsi', choices: g.choices.filter((c) => c.n.trim()).map((c) => ({ ...c, n: c.n.trim() })) })).filter((g) => g.choices.length);
      if (!it.id) it.id = `${it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${uuid().slice(0, 4)}`;
      if (!it.station) delete it.station;
      try {
        await S.be.saveMaster('items', it, S.user);
        // simpan pengaturan per cabang yang berubah
        for (const b of master().branches) {
          const cur = master().override(b.id, it.id);
          const want = ovs[b.id];
          const price = want.price ? +want.price : null;
          const changed = (cur ? (cur.price ?? null) : null) !== price || (cur ? cur.available !== false : true) !== want.available;
          if (!changed) continue;
          await S.be.saveMaster('itemBranch', { ...(cur || {}), id: `${b.id}:${it.id}`, branchId: b.id, itemId: it.id, price, available: want.available }, S.user);
        }
        d.close(); toast('Menu disimpan'); renderCats(); render();
      } catch (er) { toast(er.message || 'Gagal menyimpan', 'err'); }
    });
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; renderCats(); render(); return; }
    const av = e.target.closest('[data-avail]'); if (av) { toggleAvail(av.dataset.avail); return; }
    const ed = e.target.closest('[data-edit]'); if (ed) { itemDrawer(master().item[ed.dataset.edit]); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'new-item') itemDrawer();
    if (a.dataset.a === 'new-cat') catDialog();
    if (a.dataset.a === 'edit-cat') catDialog(master().cat[cat]);
  });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-branch]')) { bid = e.target.value; sessionStorage.setItem('pos:menu:branch', bid); render(); } });
  el.addEventListener('input', debounce((e) => { if (e.target.matches('[data-q]')) { q = e.target.value; render(); } }, 150));
  renderCats(); render();
  return undefined;
}
