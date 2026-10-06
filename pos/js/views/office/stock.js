/* =========================================================
   Stok per cabang untuk menu yang dilacak (pastry, dessert, produk jadi):
   terima barang, stok opname, barang rusak, dan transfer antarcabang.
   Stok = jumlah semua pergerakan, jadi aman walau kasir sempat offline.
   ========================================================= */
import { S, master, can } from '../../state.js';
import { $, esc, icon, modal, toast, confirmBox } from '../../lib/ui.js';
import { num } from '../../core/money.js';
import { dateTime } from '../../core/dates.js';
import { uuid } from '../../core/ids.js';
import { pageHead, myBranches, branchName, demoNote } from './common.js';
import { bus } from '../../data/bus.js';

const TYPES = { sale: 'Terjual', void: 'Batal jual', receive: 'Stok masuk', adjust: 'Opname', waste: 'Rusak/buang', transfer_in: 'Transfer masuk', transfer_out: 'Transfer keluar' };

export async function mount(el) {
  const branches = myBranches();
  let bid = sessionStorage.getItem('pos:stock:branch') || S.be.device.branchId || (branches[0] || {}).id;
  if (!branches.some((b) => b.id === bid)) bid = (branches[0] || {}).id;
  let levels = {}; let moves = [];

  el.innerHTML = `${pageHead('Stok', 'Menu dengan "Lacak stok" aktif · berkurang otomatis saat terjual')}
    <div class="page">
      <div class="filters"><select class="select sm" data-branch aria-label="Cabang">${branches.map((b) => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <span class="hint">Aktifkan pelacakan stok per menu di Kantor › Menu & harga.</span></div>
      ${demoNote()}
      <div id="st-body"></div>
    </div>`;
  const body = $('#st-body', el);
  const tz = () => (master().branch[bid] || {}).tz;

  async function load() {
    [levels, moves] = await Promise.all([S.be.stockLevels(bid), S.be.stockMovesQuery({ branchId: bid, limit: 150 })]);
    render();
  }
  function render() {
    const items = master().items.filter((i) => i.track && i.active !== false);
    const low = items.filter((i) => (levels[i.id] || 0) <= (i.low ?? 5));
    body.innerHTML = `<div class="kpis"><div class="kpi"><div class="k-label">Menu dilacak</div><div class="k-value">${items.length}</div></div>
        <div class="kpi"><div class="k-label">Stok menipis / habis</div><div class="k-value ${low.length ? 'neg' : ''}">${low.length}</div><div class="k-sub">${low.slice(0, 3).map((i) => esc(i.name)).join(', ')}${low.length > 3 ? '…' : ''}</div></div></div>
      <div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Menu</th><th class="r">Stok</th><th class="r">Batas menipis</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
        ${items.length ? items.map((i) => {
          const lv = levels[i.id] || 0; const lw = i.low ?? 5;
          return `<tr><td><b>${esc(i.name)}</b><span class="sub">${esc((master().cat[i.catId] || {}).name || '')}</span></td><td class="r"><b>${num(lv)}</b></td><td class="r">${num(lw)}</td>
            <td>${lv <= 0 ? '<span class="tag red">Habis</span>' : lv <= lw ? '<span class="tag amber">Menipis</span>' : '<span class="tag green">Aman</span>'}</td>
            <td class="r nowrap"><button class="btn soft xs" data-op="receive" data-id="${i.id}">${icon('plus', 'xs')} Masuk</button> <button class="btn ghost xs" data-op="adjust" data-id="${i.id}">Opname</button> <button class="btn ghost xs" data-op="waste" data-id="${i.id}">Rusak</button>${branches.length > 1 || can('office.all') ? ` <button class="btn ghost xs" data-op="transfer" data-id="${i.id}">${icon('swap', 'xs')}</button>` : ''}</td></tr>`;
        }).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:28px">Belum ada menu yang dilacak stoknya.</td></tr>'}
      </tbody></table></div></div>
      <div class="section-title"><h3>Riwayat pergerakan stok</h3><span class="hint">150 terakhir</span></div>
      <div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Waktu</th><th>Menu</th><th>Jenis</th><th class="r">Jumlah</th><th>Keterangan</th><th>Oleh</th></tr></thead><tbody>
        ${moves.length ? moves.map((mv) => `<tr><td class="n">${dateTime(mv.at, tz())}</td><td>${esc((master().item[mv.itemId] || {}).name || mv.itemId)}</td><td>${TYPES[mv.type] || esc(mv.type)}</td>
          <td class="r ${mv.qty < 0 ? 'neg' : 'pos'}">${mv.qty > 0 ? '+' : ''}${num(mv.qty)}</td><td>${esc(mv.note || mv.refNumber || '')}</td><td>${esc(mv.byName || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">Belum ada pergerakan.</td></tr>'}
      </tbody></table></div></div>`;
  }

  async function op(type, itemId) {
    const it = master().item[itemId]; const cur = levels[itemId] || 0;
    const others = master().activeBranches().filter((b) => b.id !== bid);
    const titles = { receive: 'Stok masuk', adjust: 'Stok opname', waste: 'Barang rusak / dibuang', transfer: 'Transfer ke cabang lain' };
    const m = modal({
      title: `${titles[type]} · ${it.name}`, sub: `${esc(branchName(bid))} · stok sekarang ${num(cur)}`, size: 'sm',
      body: `<div class="col">
        <label class="field"><span>${type === 'adjust' ? 'Jumlah hasil hitung fisik' : 'Jumlah'}</span><input class="input" id="op-q" type="number" min="${type === 'adjust' ? 0 : 1}" inputmode="numeric" value="${type === 'adjust' ? cur : ''}" autofocus></label>
        ${type === 'transfer' ? `<label class="field"><span>Ke cabang</span><select class="select" id="op-to">${others.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Keterangan <em>(opsional)</em></span><input class="input" id="op-n" placeholder="${type === 'receive' ? 'mis. kiriman dapur pusat' : type === 'waste' ? 'mis. kedaluwarsa' : ''}"></label>
        <p class="err-text" id="op-e" hidden></p></div>`,
      foot: '<button class="btn ghost" data-close>Batal</button><button class="btn" data-ok>Simpan</button>',
    });
    $('[data-ok]', m.el).addEventListener('click', async () => {
      const qv = parseInt($('#op-q', m.el).value, 10); const note = $('#op-n', m.el).value.trim(); const err = $('#op-e', m.el);
      if (!(qv >= (type === 'adjust' ? 0 : 1))) { err.textContent = 'Jumlah tidak valid.'; err.hidden = false; return; }
      const base = { itemId, by: S.user.id, byName: S.user.name, at: Date.now(), note };
      let docs = [];
      if (type === 'receive') docs = [{ ...base, id: uuid(), branchId: bid, qty: qv, type: 'receive' }];
      if (type === 'waste') docs = [{ ...base, id: uuid(), branchId: bid, qty: -qv, type: 'waste' }];
      if (type === 'adjust') { if (qv === cur) { m.close(); return; } docs = [{ ...base, id: uuid(), branchId: bid, qty: qv - cur, type: 'adjust', note: note || `Opname: ${cur} → ${qv}` }]; }
      if (type === 'transfer') {
        const to = $('#op-to', m.el).value; const ref = uuid();
        if (qv > cur && !(await confirmBox({ title: 'Stok tidak cukup', text: `Stok ${esc(branchName(bid))} hanya ${cur}. Tetap transfer ${qv}?`, ok: 'Tetap transfer' }))) return;
        docs = [{ ...base, id: uuid(), branchId: bid, qty: -qv, type: 'transfer_out', ref, note: note || `Ke ${branchName(to)}` }, { ...base, id: uuid(), branchId: to, qty: qv, type: 'transfer_in', ref, note: note || `Dari ${branchName(bid)}` }];
      }
      try {
        // transfer menyentuh dua cabang → disimpan per cabang
        for (const b of [...new Set(docs.map((d) => d.branchId))]) await S.be.officeWrite('stockMoves', docs.filter((d) => d.branchId === b));
        await S.be.audit(`stock.${type}`, { item: it.name, qty: qv, note }, S.user, bid);
        m.close(); toast('Stok diperbarui'); load();
      } catch (e) { err.textContent = e.message || 'Gagal menyimpan'; err.hidden = false; }
    });
  }

  el.addEventListener('change', (e) => { if (e.target.matches('[data-branch]')) { bid = e.target.value; sessionStorage.setItem('pos:stock:branch', bid); load(); } });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) op(b.dataset.op, b.dataset.id); });
  await load();
  const offs = [bus.on('stockMoves', load), bus.on('stock', load)];
  return () => offs.forEach((f) => f());
}
