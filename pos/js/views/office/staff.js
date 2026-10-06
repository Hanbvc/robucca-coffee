/* Karyawan: peran, cabang, PIN. Manajer hanya mengelola kasir & dapur di cabangnya. */
import { S, master, can } from '../../state.js';
import { $, $$, esc, icon, avatar, drawer, toast } from '../../lib/ui.js';
import { ROLES, assignableRoles, staffBranches, canBranch } from '../../core/perms.js';
import { hashPin, validPin } from '../../core/pin.js';
import { uuid } from '../../core/ids.js';
import { staffColor } from '../../core/seed.js';
import { pageHead, myBranches } from './common.js';

export async function mount(el) {
  const mine = myBranches();
  const visible = (s) => can('staff.owner') || (s.role !== 'owner' && (s.branchIds || []).some((b) => mine.some((x) => x.id === b)));
  const editable = (s) => can('staff.owner') || (['cashier', 'kitchen'].includes(s.role) && (s.branchIds || []).every((b) => mine.some((x) => x.id === b)));

  const render = () => {
    const list = master().staff.filter(visible);
    el.innerHTML = `${pageHead('Karyawan', 'PIN dipakai untuk masuk & menyetujui void/diskon · setiap aksi tercatat atas nama karyawan', `<button class="btn sm" data-new>${icon('user-plus', 'sm')} Karyawan baru</button>`)}
      <div class="page"><div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Nama</th><th>Peran</th><th>Cabang</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr><td><div class="cell-row">${avatar(s, 'sm')}<b>${esc(s.name)}</b></div></td><td>${ROLES[s.role].name}</td>
        <td>${staffBranches(s).includes('*') ? 'Semua cabang' : esc((s.branchIds || []).map((b) => (master().branch[b] || {}).name || b).join(', ') || '—')}</td>
        <td>${s.active !== false ? '<span class="tag green">Aktif</span>' : '<span class="tag">Nonaktif</span>'}</td>
        <td class="r">${editable(s) ? `<button class="btn ghost xs" data-edit="${s.id}">${icon('edit', 'xs')} Ubah</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="note blue" style="margin-top:14px">${icon('info', 'sm')}<span><b>Pemilik</b>: semua cabang & pengaturan. <b>Manajer</b>: kantor cabangnya, menyetujui void/refund/diskon, kelola kasir & dapur. <b>Kasir</b>: penjualan & shift. <b>Dapur/Bar</b>: layar dapur.</span></div></div>`;
  };

  function editor(s0 = null) {
    const roles = assignableRoles(S.user);
    const s = s0 ? JSON.parse(JSON.stringify(s0)) : { id: '', name: '', role: roles.includes('cashier') ? 'cashier' : roles[0], branchIds: mine.length === 1 ? [mine[0].id] : [], active: true, color: staffColor(master().staff.length) };
    const d = drawer({ title: s0 ? `Ubah ${s0.name}` : 'Karyawan baru', body: '<div id="se"></div>', foot: '<button class="btn ghost" data-close>Batal</button><button class="btn" data-save>Simpan</button>' });
    const box = $('#se', d.el);
    const paint = () => {
      const branchesAllowed = can('staff.owner') ? master().branches : mine;
      box.innerHTML = `<div class="col">
        <label class="field"><span>Nama</span><input class="input" id="s-name" value="${esc(s.name)}" autocomplete="off"></label>
        <label class="field"><span>Peran</span><select class="select" id="s-role">${roles.map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${ROLES[r].name}</option>`).join('')}</select></label>
        ${s.role === 'owner' ? '<p class="hint">Pemilik otomatis punya akses ke semua cabang.</p>' : `<div class="field"><span class="field-label">Cabang</span>${branchesAllowed.map((b) => `<label class="row" style="gap:8px"><input type="checkbox" data-b="${b.id}" ${(s.branchIds || []).includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}<small>Manajer area bisa diberi beberapa cabang.</small></div>`}
        <label class="field"><span>${s0 ? 'PIN baru <em>(kosongkan bila tidak diganti)</em>' : 'PIN (4–6 angka)'}</span><input class="input" id="s-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••"></label>
        <div class="switch-row"><button class="switch ${s.active !== false ? 'on' : ''}" id="s-act" role="switch" aria-checked="${s.active !== false}" aria-label="Aktif"></button><div><b>Aktif</b><small>Karyawan nonaktif tidak bisa masuk</small></div></div>
        <p class="err-text" id="s-err" hidden></p></div>`;
    };
    paint();
    box.addEventListener('change', (e) => {
      if (e.target.id === 's-role') { s.name = $('#s-name', box).value; s.role = e.target.value; paint(); }
    });
    box.addEventListener('click', (e) => { if (e.target.closest('#s-act')) { s.active = !(s.active !== false); e.target.closest('#s-act').classList.toggle('on', s.active); } });
    d.el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-save]')) return;
      const err = $('#s-err', box);
      s.name = $('#s-name', box).value.trim();
      const pin = $('#s-pin', box).value.trim();
      if (s.role !== 'owner') s.branchIds = $$('[data-b]', box).filter((x) => x.checked).map((x) => x.dataset.b);
      else s.branchIds = ['*'];
      if (!s.name) { err.textContent = 'Isi nama.'; err.hidden = false; return; }
      if (s.role !== 'owner' && !s.branchIds.length) { err.textContent = 'Pilih minimal satu cabang.'; err.hidden = false; return; }
      if ((!s0 || pin) && !validPin(pin)) { err.textContent = 'PIN harus 4–6 angka.'; err.hidden = false; return; }
      if (s0 && s0.id === S.user.id && s.active === false) { err.textContent = 'Tidak bisa menonaktifkan akun sendiri.'; err.hidden = false; return; }
      if (s0 && s0.role === 'owner' && s.role !== 'owner' && master().staff.filter((x) => x.role === 'owner' && x.active !== false).length <= 1) { err.textContent = 'Harus ada minimal satu pemilik aktif.'; err.hidden = false; return; }
      if (!can('staff.owner') && !s.branchIds.every((b) => canBranch(S.user, b))) { err.textContent = 'Cabang di luar akses Anda.'; err.hidden = false; return; }
      const out = { ...s, id: s.id || `st-${uuid().slice(0, 8)}` };
      if (pin) out.pin = await hashPin(pin);
      try { await S.be.saveMaster('staff', out, S.user); d.close(); toast('Karyawan disimpan'); render(); } catch (er) { err.textContent = er.message; err.hidden = false; }
    });
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) editor();
    const ed = e.target.closest('[data-edit]'); if (ed) editor(master().person[ed.dataset.edit]);
  });
  render();
}
