/* Promo & diskon yang bisa dipilih kasir (per cabang, periode, perlu persetujuan atau tidak). */
import { S, master } from '../../state.js';
import { $, $$, esc, icon, modal, toast, confirmBox } from '../../lib/ui.js';
import { rp, pctLabel, parse } from '../../core/money.js';
import { dateShort } from '../../core/dates.js';
import { uuid } from '../../core/ids.js';
import { pageHead } from './common.js';

export async function mount(el) {
  const render = () => {
    const list = master().discounts;
    el.innerHTML = `${pageHead('Promo & diskon', 'Promo muncul di tombol Diskon kasir pada cabang & tanggal yang berlaku', `<button class="btn sm" data-new>${icon('plus', 'sm')} Promo baru</button>`)}
      <div class="page"><div class="note blue" style="margin-bottom:14px">${icon('info', 'sm')}<span>Diskon manual kasir dibatasi ${master().settings.maxDiscPct || 0}% (ubah di Pengaturan). Di atas batas itu, dan untuk promo bertanda "Perlu persetujuan", kasir harus memasukkan PIN manajer.</span></div>
      <div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Nama</th><th>Nilai</th><th>Cabang</th><th>Periode</th><th>Persetujuan</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${d.type === 'pct' ? pctLabel(d.value) : rp(d.value)}</td>
        <td>${!d.branchIds || d.branchIds.includes('*') ? 'Semua cabang' : esc(d.branchIds.map((b) => (master().branch[b] || {}).name || b).join(', '))}</td>
        <td>${d.from || d.to ? `${d.from ? dateShort(d.from) : '…'} – ${d.to ? dateShort(d.to) : '…'}` : 'Selalu'}</td>
        <td>${d.approval ? '<span class="tag amber">PIN manajer</span>' : '<span class="muted">—</span>'}</td>
        <td>${d.active !== false ? '<span class="tag green">Aktif</span>' : '<span class="tag">Nonaktif</span>'}</td>
        <td class="r"><button class="btn ghost xs" data-edit="${d.id}">${icon('edit', 'xs')} Ubah</button></td></tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">Belum ada promo.</td></tr>'}
      </tbody></table></div></div></div>`;
  };

  function editor(d0 = null) {
    const d = d0 ? JSON.parse(JSON.stringify(d0)) : { id: '', name: '', type: 'pct', value: 10, branchIds: ['*'], approval: false, active: true, from: '', to: '' };
    const all = !d.branchIds || d.branchIds.includes('*');
    const m = modal({
      title: d0 ? `Ubah ${d0.name}` : 'Promo baru', size: 'sm',
      body: `<div class="col">
        <label class="field"><span>Nama promo</span><input class="input" id="p-name" value="${esc(d.name)}" placeholder="mis. Member 10%" autofocus></label>
        <div class="row"><div class="seg"><button data-t="pct" class="${d.type === 'pct' ? 'on' : ''}">Persen</button><button data-t="amt" class="${d.type === 'amt' ? 'on' : ''}">Nominal</button></div>
          <input class="input" id="p-val" inputmode="numeric" value="${d.type === 'amt' ? (d.value || 0).toLocaleString('id-ID') : d.value}" aria-label="Nilai"></div>
        <div class="field"><span class="field-label">Berlaku di cabang</span>
          <label class="row" style="gap:8px"><input type="checkbox" id="p-all" ${all ? 'checked' : ''}> Semua cabang (termasuk cabang baru)</label>
          <div id="p-br" class="col" style="gap:6px;${all ? 'display:none' : ''}">${master().branches.map((b) => `<label class="row" style="gap:8px"><input type="checkbox" data-b="${b.id}" ${!all && d.branchIds.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div></div>
        <div class="form-grid"><label class="field"><span>Mulai <em>(opsional)</em></span><input class="input" type="date" id="p-from" value="${esc(d.from || '')}"></label><label class="field"><span>Sampai <em>(opsional)</em></span><input class="input" type="date" id="p-to" value="${esc(d.to || '')}"></label></div>
        <div class="switch-row"><div class="grow"><b>Perlu persetujuan manajer</b><small>Kasir harus memasukkan PIN manajer</small></div><button class="switch ${d.approval ? 'on' : ''}" data-sw="approval" role="switch" aria-checked="${!!d.approval}" aria-label="Perlu persetujuan"></button></div>
        <div class="switch-row"><div class="grow"><b>Aktif</b></div><button class="switch ${d.active !== false ? 'on' : ''}" data-sw="active" role="switch" aria-checked="${d.active !== false}" aria-label="Aktif"></button></div>
        <p class="err-text" id="p-err" hidden></p></div>`,
      foot: `${d0 ? '<button class="btn danger ghost" data-del>Hapus</button>' : ''}<button class="btn ghost" data-close>Batal</button><button class="btn" data-ok>Simpan</button>`,
    });
    m.el.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-t]'); if (t) { d.type = t.dataset.t; $$('[data-t]', m.el).forEach((x) => x.classList.toggle('on', x === t)); return; }
      const sw = e.target.closest('[data-sw]'); if (sw) { sw.classList.toggle('on'); return; }
      if (e.target.closest('[data-del]')) {
        if (!(await confirmBox({ title: `Hapus promo ${d0.name}?`, text: 'Transaksi lama yang memakai promo ini tidak berubah.', ok: 'Hapus', danger: true }))) return;
        try { await S.be.deleteMaster('discounts', d0.id, S.user); m.close(); toast('Promo dihapus'); render(); } catch (er) { toast(er.message, 'err'); }
        return;
      }
      if (!e.target.closest('[data-ok]')) return;
      const err = $('#p-err', m.el);
      const name = $('#p-name', m.el).value.trim(); const value = d.type === 'pct' ? Math.min(100, parse($('#p-val', m.el).value)) : parse($('#p-val', m.el).value);
      if (!name || value <= 0) { err.textContent = 'Isi nama dan nilai promo.'; err.hidden = false; return; }
      const allOn = $('#p-all', m.el).checked;
      const bids = allOn ? ['*'] : $$('[data-b]', m.el).filter((x) => x.checked).map((x) => x.dataset.b);
      if (!bids.length) { err.textContent = 'Pilih minimal satu cabang.'; err.hidden = false; return; }
      const from = $('#p-from', m.el).value; const to = $('#p-to', m.el).value;
      if (from && to && from > to) { err.textContent = 'Tanggal mulai melewati tanggal selesai.'; err.hidden = false; return; }
      const out = { ...d, id: d.id || `disc-${uuid().slice(0, 8)}`, name, value, branchIds: bids, from, to, approval: $('[data-sw="approval"]', m.el).classList.contains('on'), active: $('[data-sw="active"]', m.el).classList.contains('on') };
      try { await S.be.saveMaster('discounts', out, S.user); m.close(); toast('Promo disimpan'); render(); } catch (er) { err.textContent = er.message; err.hidden = false; }
    });
    m.el.addEventListener('change', (e) => { if (e.target.id === 'p-all') $('#p-br', m.el).style.display = e.target.checked ? 'none' : ''; });
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) editor();
    const ed = e.target.closest('[data-edit]'); if (ed) editor(master().discount[ed.dataset.edit]);
  });
  render();
}
