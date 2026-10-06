/* Pengaturan pusat: aturan kasir, pembulatan, tipe pesanan & markup ojol, metode bayar, data perangkat. */
import { S, master } from '../../state.js';
import { $, $$, esc, icon, toast, download, busy } from '../../lib/ui.js';
import { rp } from '../../core/money.js';
import { pageHead } from './common.js';
import { TX_COLLS } from '../../data/local.js';

export async function mount(el) {
  const render = () => {
    const s = master().settings;
    el.innerHTML = `${pageHead('Pengaturan', 'Berlaku untuk semua cabang')}
      <div class="page" style="max-width:980px">
        <div class="card pad"><h3 class="card-title">${icon('store', 'sm')} Umum & struk</h3>
          <div class="form-grid">
            <label class="field"><span>Nama usaha (di struk)</span><input class="input" data-s="orgName" value="${esc(s.orgName)}"></label>
            <label class="field"><span>Instagram</span><input class="input" data-s="instagram" value="${esc(s.instagram || '')}" placeholder="@robucca.id"></label>
            <label class="field full"><span>Catatan kaki struk</span><input class="input" data-s="receiptFooter" value="${esc(s.receiptFooter || '')}"></label>
          </div></div>

        <div class="card pad" style="margin-top:14px"><h3 class="card-title">${icon('grid', 'sm')} Aturan kasir</h3>
          <div class="form-grid">
            <label class="field"><span>Pembulatan total</span><select class="select" data-s="roundUnit">${[[1, 'Tanpa pembulatan'], [100, 'Ke Rp100'], [500, 'Ke Rp500'], [1000, 'Ke Rp1.000']].map(([v, l]) => `<option value="${v}" ${+s.roundUnit === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Arah pembulatan</span><select class="select" data-s="roundMode">${[['down', 'Ke bawah (menguntungkan pelanggan)'], ['nearest', 'Terdekat'], ['up', 'Ke atas']].map(([v, l]) => `<option value="${v}" ${s.roundMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Batas diskon manual kasir (%)</span><input class="input" type="number" min="0" max="100" data-s="maxDiscPct" value="${s.maxDiscPct ?? 10}"><small>Di atas ini perlu PIN manajer</small></label>
            <label class="field"><span>Kunci layar otomatis</span><select class="select" data-s="autoLockMin">${[[0, 'Tidak'], [2, '2 menit'], [5, '5 menit'], [10, '10 menit'], [30, '30 menit']].map(([v, l]) => `<option value="${v}" ${+s.autoLockMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Tiket dapur kuning setelah (menit)</span><input class="input" type="number" min="1" data-s="kdsWarnMin" value="${s.kdsWarnMin || 8}"></label>
            <label class="field"><span>Tiket dapur merah setelah (menit)</span><input class="input" type="number" min="1" data-s="kdsLateMin" value="${s.kdsLateMin || 15}"></label>
            <div class="full row wrap" style="gap:22px">
              <div class="switch-row"><button class="switch ${s.autoPrint ? 'on' : ''}" data-sw="autoPrint" role="switch" aria-checked="${!!s.autoPrint}" aria-label="Cetak struk otomatis"></button><div><b>Cetak struk otomatis</b><small>Setelah pembayaran</small></div></div>
              <div class="switch-row"><button class="switch ${s.blockNoStock !== false ? 'on' : ''}" data-sw="blockNoStock" role="switch" aria-checked="${s.blockNoStock !== false}" aria-label="Tolak jual saat stok habis"></button><div><b>Tolak jual saat stok 0</b><small>Untuk menu yang stoknya dilacak</small></div></div>
            </div>
          </div></div>

        <div class="card pad" style="margin-top:14px"><h3 class="card-title">${icon('scooter', 'sm')} Tipe pesanan & harga ojol</h3>
          <p class="hint" style="margin:-4px 0 10px">Markup menaikkan harga semua menu di kanal itu (dibulatkan ke atas ke Rp500), mis. untuk menutup komisi aplikasi. Contoh Rp35.000 dengan markup 20% → ${rp(42000)}.</p>
          <table class="table"><thead><tr><th>Tipe</th><th>Jenis</th><th style="width:150px">Markup harga (%)</th><th>Aktif</th></tr></thead><tbody>
          ${master().channels.map((c) => `<tr><td><input class="input sm" data-ch="${c.id}" data-ck="name" value="${esc(c.name)}" aria-label="Nama tipe"></td><td>${c.type === 'platform' ? 'Ojol / aplikasi' : c.type === 'dinein' ? 'Makan di tempat' : 'Dibawa pulang'}</td>
            <td><input class="input sm" type="number" min="0" max="100" step="1" data-ch="${c.id}" data-ck="markupPct" value="${c.markupPct || 0}" ${c.type === 'platform' ? '' : 'disabled'} aria-label="Markup"></td>
            <td><button class="switch ${c.active !== false ? 'on' : ''}" data-chsw="${c.id}" role="switch" aria-checked="${c.active !== false}" aria-label="Aktif"></button></td></tr>`).join('')}
          </tbody></table></div>

        <div class="card pad" style="margin-top:14px"><h3 class="card-title">${icon('wallet', 'sm')} Metode pembayaran</h3>
          <table class="table"><thead><tr><th>Metode</th><th>Jenis</th><th>Minta no. referensi</th><th>Aktif</th></tr></thead><tbody>
          ${master().payMethods.map((p) => `<tr><td><input class="input sm" data-pm="${p.id}" value="${esc(p.name)}" aria-label="Nama metode"></td><td>${p.type === 'cash' ? 'Tunai (masuk laci)' : 'Non-tunai'}</td>
            <td><button class="switch ${p.ref ? 'on' : ''}" data-pmref="${p.id}" role="switch" aria-checked="${!!p.ref}" aria-label="Minta referensi" ${p.type === 'cash' ? 'disabled' : ''}></button></td>
            <td><button class="switch ${p.active !== false ? 'on' : ''}" data-pmsw="${p.id}" role="switch" aria-checked="${p.active !== false}" aria-label="Aktif" ${p.type === 'cash' ? 'disabled' : ''}></button></td></tr>`).join('')}
          </tbody></table></div>

        <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn lg" data-save>${icon('check', 'sm')} Simpan pengaturan</button></div>

        <div class="card pad" style="margin-top:22px"><h3 class="card-title">${icon('tablet', 'sm')} Data perangkat ini</h3>
          ${S.be.isDemo ? `<p class="hint" style="margin:0 0 12px">Mode demo: semua data hanya tersimpan di browser ini. Ekspor untuk cadangan, atau mulai ulang demo.</p>
            <div class="row wrap"><button class="btn ghost" data-x="export">${icon('download', 'sm')} Ekspor semua data (JSON)</button><button class="btn danger ghost" data-x="reset">${icon('rotate', 'sm')} Hapus & mulai dari awal</button></div>`
            : `<dl class="kv" style="max-width:520px"><dt>Server</dt><dd style="word-break:break-all">${esc(S.be.device.serverUrl)}</dd><dt>Perangkat</dt><dd>${esc(S.be.device.name)}</dd></dl>
            <p class="hint" style="margin:10px 0 12px">Cadangan database dibuat di server (lihat pos/README.md › Cadangan).</p>
            <button class="btn danger ghost" data-x="reset">${icon('logout', 'sm')} Lepas perangkat ini dari server</button>`}
        </div>
      </div>`;
  };

  el.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-sw], [data-chsw], [data-pmsw], [data-pmref]');
    if (sw && !sw.disabled) { sw.classList.toggle('on'); sw.setAttribute('aria-checked', sw.classList.contains('on')); return; }
    if (e.target.closest('[data-save]')) return save();
    const x = e.target.closest('[data-x]'); if (!x) return;
    if (x.dataset.x === 'export') {
      const db = S.be.db; const out = { exportedAt: new Date().toISOString(), master: S.be.master.raw };
      for (const c of TX_COLLS) out[c] = await db.all(c);
      download(`robucca-pos-demo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json');
    }
    if (x.dataset.x === 'reset') window.__posReset();
  });

  async function save() {
    const s = { ...master().settings };
    $$('[data-s]', el).forEach((i) => { const k = i.dataset.s; s[k] = ['roundUnit', 'maxDiscPct', 'autoLockMin', 'kdsWarnMin', 'kdsLateMin'].includes(k) ? Number(i.value) : i.value.trim(); });
    $$('[data-sw]', el).forEach((b) => { s[b.dataset.sw] = b.classList.contains('on'); });
    if (!(s.maxDiscPct >= 0 && s.maxDiscPct <= 100)) { toast('Batas diskon harus 0–100%', 'warn'); return; }
    const bz = busy('Menyimpan…');
    try {
      await S.be.saveMaster('settings', s, S.user);
      for (const c of master().channels) {
        const name = $(`[data-ch="${c.id}"][data-ck="name"]`, el).value.trim() || c.name;
        const markupPct = Math.max(0, Math.min(100, Number($(`[data-ch="${c.id}"][data-ck="markupPct"]`, el).value) || 0));
        const active = $(`[data-chsw="${c.id}"]`, el).classList.contains('on');
        if (name !== c.name || markupPct !== (c.markupPct || 0) || active !== (c.active !== false)) await S.be.saveMaster('channels', { ...c, name, markupPct, active }, S.user);
      }
      for (const p of master().payMethods) {
        const name = $(`[data-pm="${p.id}"]`, el).value.trim() || p.name;
        const active = p.type === 'cash' ? true : $(`[data-pmsw="${p.id}"]`, el).classList.contains('on');
        const ref = $(`[data-pmref="${p.id}"]`, el).classList.contains('on');
        if (name !== p.name || active !== (p.active !== false) || ref !== !!p.ref) await S.be.saveMaster('payMethods', { ...p, name, active, ref }, S.user);
      }
      if (!master().activeChannels().length) toast('Minimal satu tipe pesanan harus aktif', 'warn');
      toast('Pengaturan disimpan');
      render();
    } catch (err) { toast(err.message || 'Gagal menyimpan', 'err'); } finally { bz.done(); }
  }
  render();
}
