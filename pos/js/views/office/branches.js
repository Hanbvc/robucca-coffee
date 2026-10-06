/* Cabang: identitas, zona waktu, pajak & biaya layanan, struk. */
import { S, master } from '../../state.js';
import { $, esc, icon, drawer, toast } from '../../lib/ui.js';
import { pctLabel } from '../../core/money.js';
import { TZS, tzLabel } from '../../core/dates.js';
import { validBranchCode, uuid } from '../../core/ids.js';
import { calcOrder } from '../../core/calc.js';
import { rp } from '../../core/money.js';
import { pageHead } from './common.js';

export async function mount(el) {
  const render = () => {
    const list = master().branches;
    el.innerHTML = `${pageHead('Cabang', `${list.filter((b) => b.active !== false).length} cabang aktif · menu, promo, & laporan berlaku lintas cabang`, `<button class="btn sm" data-new>${icon('plus', 'sm')} Cabang baru</button>`)}
      <div class="page"><div class="table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Kode</th><th>Cabang</th><th>Zona</th><th>Pajak</th><th>Biaya layanan</th><th>Jam buka</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((b) => `<tr><td><span class="tag dark">${esc(b.code)}</span></td><td><b>${esc(b.name)}</b><span class="sub">${esc(b.address || '')}</span></td><td>${tzLabel(b.tz)}</td>
        <td>${esc(b.taxLabel || 'PB1')} ${pctLabel(b.taxPct || 0)}<span class="sub">${b.taxIncl !== false ? 'termasuk harga' : 'ditambahkan'}</span></td><td>${b.servicePct ? pctLabel(b.servicePct) : '—'}</td>
        <td>${esc(b.open || '')}–${esc(b.close || '')}</td><td>${b.active !== false ? '<span class="tag green">Aktif</span>' : '<span class="tag">Nonaktif</span>'}</td>
        <td class="r"><button class="btn ghost xs" data-edit="${b.id}">${icon('edit', 'xs')} Ubah</button></td></tr>`).join('')}
      </tbody></table></div></div>
      <p class="hint" style="margin-top:12px">Setiap struk memakai kode cabang + nomor terminal, mis. IJN1-261006-0042, sehingga nomor tidak pernah bentrok antarcabang maupun antarperangkat — bahkan saat offline.</p></div>`;
  };

  function editor(b0 = null) {
    const b = b0 ? { ...b0 } : { id: '', code: '', name: '', address: '', phone: '', tz: 'Asia/Jakarta', dayStart: 0, taxPct: 10, taxIncl: true, taxService: true, servicePct: 0, taxLabel: 'PB1', open: '08:00', close: '21:00', paper: 80, receiptFooter: '', active: true };
    const d = drawer({ title: b0 ? `Ubah ${b0.name}` : 'Cabang baru', body: '<div id="be"></div>', foot: '<button class="btn ghost" data-close>Batal</button><button class="btn" data-save>Simpan cabang</button>' });
    const box = $('#be', d.el);
    const example = () => {
      const { totals: t } = calcOrder({ lines: [{ id: 'x', price: 35000, qty: 1 }] }, { taxPct: +b.taxPct || 0, taxIncl: b.taxIncl !== false, servicePct: +b.servicePct || 0, taxService: b.taxService !== false, roundUnit: master().settings.roundUnit, roundMode: master().settings.roundMode });
      return `Contoh menu Rp35.000 → pelanggan bayar <b>${rp(t.total)}</b> (pajak ${rp(t.tax)}${t.service ? `, layanan ${rp(t.service)}` : ''}${t.rounding ? `, pembulatan ${rp(t.rounding)}` : ''}).`;
    };
    const paint = () => {
      box.innerHTML = `<div class="form-grid">
        <label class="field"><span>Kode <em>(2–4 huruf, untuk nomor struk)</em></span><input class="input" data-k="code" value="${esc(b.code)}" maxlength="4" placeholder="IJN" style="text-transform:uppercase" ${b0 ? 'readonly' : ''}></label>
        <label class="field"><span>Nama cabang</span><input class="input" data-k="name" value="${esc(b.name)}" placeholder="Ijen Nirwana"></label>
        <label class="field full"><span>Alamat (tampil di struk)</span><input class="input" data-k="address" value="${esc(b.address)}"></label>
        <label class="field"><span>Telepon</span><input class="input" data-k="phone" value="${esc(b.phone)}"></label>
        <label class="field"><span>Zona waktu</span><select class="select" data-k="tz">${TZS.map((t) => `<option value="${t.id}" ${b.tz === t.id ? 'selected' : ''}>${t.label} (${t.id})</option>`).join('')}</select></label>
        <label class="field"><span>Jam buka</span><input class="input" type="time" data-k="open" value="${esc(b.open)}"></label>
        <label class="field"><span>Jam tutup</span><input class="input" type="time" data-k="close" value="${esc(b.close)}"></label>
        <label class="field"><span>Pergantian hari bisnis</span><select class="select" data-k="dayStart">${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${+b.dayStart === h ? 'selected' : ''}>${String(h).padStart(2, '0')}.00${h ? '' : ' (tengah malam)'}</option>`).join('')}</select><small>Untuk cabang yang buka lewat tengah malam</small></label>
        <label class="field"><span>Lebar kertas struk</span><select class="select" data-k="paper"><option value="80" ${+b.paper === 80 ? 'selected' : ''}>80 mm</option><option value="58" ${+b.paper === 58 ? 'selected' : ''}>58 mm</option></select></label>
      </div>
      <div class="section-title"><h3>Pajak & biaya layanan</h3></div>
      <div class="form-grid">
        <label class="field"><span>Nama pajak</span><input class="input" data-k="taxLabel" value="${esc(b.taxLabel || 'PB1')}" placeholder="PB1 / PBJT"></label>
        <label class="field"><span>Tarif pajak (%)</span><input class="input" data-k="taxPct" type="number" min="0" max="100" step="0.5" value="${b.taxPct}"></label>
        <label class="field"><span>Biaya layanan (%)</span><input class="input" data-k="servicePct" type="number" min="0" max="100" step="0.5" value="${b.servicePct}"></label>
        <div class="field"><span>&nbsp;</span><div class="switch-row" style="padding:0"><button class="switch ${b.taxIncl !== false ? 'on' : ''}" data-sw="taxIncl" role="switch" aria-checked="${b.taxIncl !== false}" aria-label="Harga termasuk pajak"></button><div><b>Harga menu sudah termasuk pajak</b></div></div></div>
        <div class="field full"><div class="switch-row" style="padding:0"><button class="switch ${b.taxService !== false ? 'on' : ''}" data-sw="taxService" role="switch" aria-checked="${b.taxService !== false}" aria-label="Biaya layanan dikenai pajak"></button><div><b>Biaya layanan ikut dikenai pajak</b></div></div></div>
        <div class="note full" id="be-ex">${icon('info', 'sm')}<span>${example()}</span></div>
        <p class="hint full">Tarif & aturan pajak restoran (PBJT/PB1) ditetapkan pemerintah daerah. Pastikan tarif tiap cabang sesuai perda setempat.</p>
      </div>
      <div class="section-title"><h3>Struk</h3></div>
      <label class="field"><span>Catatan kaki struk <em>(kosong = pakai pengaturan pusat)</em></span><input class="input" data-k="receiptFooter" value="${esc(b.receiptFooter || '')}" placeholder="${esc(master().settings.receiptFooter || '')}"></label>
      <div class="switch-row" style="margin-top:8px"><button class="switch ${b.active !== false ? 'on' : ''}" data-sw="active" role="switch" aria-checked="${b.active !== false}" aria-label="Cabang aktif"></button><div><b>Cabang aktif</b><small>Cabang nonaktif tidak bisa dipakai berjualan</small></div></div>
      <p class="err-text" id="be-err" hidden></p>`;
    };
    paint();
    box.addEventListener('input', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      b[k] = ['taxPct', 'servicePct', 'dayStart', 'paper'].includes(k) ? Number(e.target.value) : k === 'code' ? e.target.value.toUpperCase() : e.target.value;
      if (['taxPct', 'servicePct'].includes(k)) $('#be-ex span', box).innerHTML = example();
    });
    box.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k && e.target.tagName === 'SELECT') b[k] = ['dayStart', 'paper'].includes(k) ? Number(e.target.value) : e.target.value; });
    box.addEventListener('click', (e) => { const sw = e.target.closest('[data-sw]'); if (sw) { b[sw.dataset.sw] = !(b[sw.dataset.sw] !== false); paint(); } });
    d.el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-save]')) return;
      const err = $('#be-err', box);
      b.code = String(b.code || '').trim().toUpperCase(); b.name = String(b.name || '').trim();
      if (!validBranchCode(b.code)) { err.textContent = 'Kode cabang 2–4 karakter, diawali huruf (mis. IJN, CB2).'; err.hidden = false; return; }
      if (master().branches.some((x) => x.code === b.code && x.id !== b.id)) { err.textContent = `Kode ${b.code} sudah dipakai cabang lain.`; err.hidden = false; return; }
      if (!b.name) { err.textContent = 'Isi nama cabang.'; err.hidden = false; return; }
      if (!(b.taxPct >= 0 && b.taxPct <= 100 && b.servicePct >= 0 && b.servicePct <= 100)) { err.textContent = 'Tarif pajak/layanan harus 0–100%.'; err.hidden = false; return; }
      if (!b.id) b.id = `br-${b.code.toLowerCase()}-${uuid().slice(0, 4)}`;
      try { await S.be.saveMaster('branches', b, S.user); d.close(); toast('Cabang disimpan'); render(); } catch (er) { err.textContent = er.message; err.hidden = false; }
    });
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) editor();
    const ed = e.target.closest('[data-edit]'); if (ed) editor(master().branch[ed.dataset.edit]);
  });
  render();
}
