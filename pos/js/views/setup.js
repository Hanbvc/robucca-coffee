/* Penyiapan perangkat: mode demo atau pasangkan ke server pusat. */
import { S } from '../state.js';
import { $, esc, icon, toast } from '../lib/ui.js';

export async function mount(el) {
  const C = window.MG_CONFIG || {};
  const st = { mode: 'demo', branch: 'br-ijn', url: '', detecting: true };
  const demoBranches = [
    { id: 'br-ijn', name: C.branch || 'Ijen Nirwana', sub: 'Cabang utama (data menu asli)' },
    { id: 'br-cb2', name: 'Cabang 2 (contoh)', sub: 'Cabang contoh' },
    { id: 'br-cb3', name: 'Cabang 3 (contoh)', sub: 'Cabang contoh' },
  ];

  el.innerHTML = `<div class="split">
    <section class="brand-side">
      <img class="logo" src="../assets/brand/wordmark-light.png" alt="Robucca">
      <h1>Kasir untuk<br>semua cabang</h1>
      <p>Penjualan, dapur, shift kas, stok, dan laporan kantor pusat dalam satu sistem. Tetap bisa berjualan saat internet putus — data dikirim ke pusat begitu online.</p>
      <div class="meta">
        <span class="pill">${icon('grid', 'xs')} Kasir · ${icon('chef', 'xs')} Dapur · ${icon('chart', 'xs')} Kantor</span>
        <span>${esc(C.tagline || 'Rbc Group')}</span>
      </div>
    </section>
    <section class="main-side">
      <h2>Siapkan perangkat ini</h2>
      <p class="lead">Pilih cara memakai POS di perangkat ini. Pengaturan ini hanya dilakukan sekali.</p>
      <div class="mode-cards" role="radiogroup">
        <button class="mode-card" data-mode="demo" role="radio">
          <span class="mc-ico">${icon('star')}</span>
          <b>Coba mode demo</b>
          <p>Tiga cabang contoh, staf contoh, dan riwayat transaksi 30 hari (simulasi). Data hanya di browser ini.</p>
        </button>
        <button class="mode-card" data-mode="server" role="radio">
          <span class="mc-ico">${icon('cloud')}</span>
          <b>Hubungkan ke server pusat</b>
          <p>Untuk operasional sungguhan: semua cabang memakai satu database. Butuh kode pasang dari Kantor › Perangkat.</p>
        </button>
      </div>
      <div class="setup-form" id="setup-form"></div>
    </section>
  </div>`;

  const form = $('#setup-form', el);
  function paint() {
    el.querySelectorAll('.mode-card').forEach((c) => { const on = c.dataset.mode === st.mode; c.classList.toggle('on', on); c.setAttribute('aria-checked', on); });
    if (st.mode === 'demo') {
      form.innerHTML = `<div class="field-label" style="margin-bottom:8px">Perangkat ini menjadi kasir cabang</div>
        <div class="branch-pick">${demoBranches.map((b) => `<button class="branch-opt ${st.branch === b.id ? 'on' : ''}" data-branch="${b.id}"><b>${esc(b.name)}</b><small>${esc(b.sub)}</small></button>`).join('')}</div>
        <p class="hint" style="margin:10px 0 16px">Cabang bisa diganti nanti dari menu pengguna. Nama & alamat cabang contoh bisa diubah di Kantor › Cabang.</p>
        <button class="btn lg" data-go="demo">${icon('arrow-right', 'sm')} Mulai demo</button>`;
    } else {
      form.innerHTML = `<div class="form-grid">
          <label class="field full"><span>Alamat server</span><input class="input" id="f-url" inputmode="url" autocomplete="url" placeholder="https://pos.robucca.id" value="${esc(st.url)}"></label>
          <label class="field"><span>Kode pasang <em>(6 digit, dari Kantor › Perangkat)</em></span><input class="input" id="f-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></label>
          <label class="field"><span>Nama perangkat</span><input class="input" id="f-name" placeholder="mis. Kasir depan" value="Kasir"></label>
        </div>
        <p class="err-text" id="f-err" hidden style="margin-top:10px"></p>
        <div class="row" style="margin-top:16px"><button class="btn lg" data-go="pair">${icon('link', 'sm')} Pasangkan perangkat</button></div>
        <div class="note blue" style="margin-top:16px">${icon('info', 'sm')}<span>Server pusat dijalankan dengan <b>npm start</b> (lihat pos/README.md). Saat server pertama kali jalan, kode pasang untuk perangkat kantor pusat ditampilkan di konsol server.</span></div>`;
    }
  }
  paint();

  // Server yang menyajikan halaman ini? → pilih mode server otomatis
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('../api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    const j = r.ok ? await r.json() : null;
    if (j && j.ok && j.app === 'robucca-pos') { st.mode = 'server'; st.url = location.origin; paint(); }
  } catch (e) { /* bukan server POS (mis. GitHub Pages) → mode demo */ }

  el.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { st.mode = m.dataset.mode; paint(); return; }
    const b = e.target.closest('[data-branch]');
    if (b) { st.branch = b.dataset.branch; paint(); return; }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    if (go.dataset.go === 'demo') return startDemo(go);
    return pair(go);
  });

  async function startDemo(btn) {
    btn.disabled = true;
    const msg = document.createElement('p'); msg.className = 'hint'; msg.style.marginTop = '12px';
    btn.after(msg);
    try {
      await S.be.setupDemo({ MENU: window.MG_MENU, CONFIG: C, branchId: st.branch, onProgress: (t) => { msg.textContent = t; } });
      location.hash = '#/masuk';
      location.reload();
    } catch (err) {
      console.error(err);
      msg.textContent = `Gagal menyiapkan demo: ${err.message || err}`;
      btn.disabled = false;
    }
  }

  async function pair(btn) {
    const url = $('#f-url', el).value.trim().replace(/\/+$/, '');
    const code = $('#f-code', el).value.replace(/\D/g, '');
    const name = $('#f-name', el).value.trim() || 'Kasir';
    const err = $('#f-err', el);
    err.hidden = true;
    if (!/^https?:\/\//.test(url)) { err.textContent = 'Alamat server harus diawali http:// atau https://'; err.hidden = false; return; }
    if (code.length !== 6) { err.textContent = 'Kode pasang terdiri dari 6 angka.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await S.be.pair({ url, code, name });
      toast('Perangkat terpasang');
      location.hash = '#/masuk';
      location.reload();
    } catch (x) {
      err.textContent = x.offline ? `Tidak bisa menghubungi ${url}. Periksa alamat & koneksi.` : x.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }
}
