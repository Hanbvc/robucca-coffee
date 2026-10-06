/* Kantor: laporan & pengaturan (per cabang untuk manajer, semua cabang untuk pemilik). */
import { S, can } from '../../state.js';
import { $, esc, icon, toast } from '../../lib/ui.js';
import { verifyPin } from '../../core/pin.js';
import { nav } from '../../state.js';

const PAGES = [
  ['dasbor', 'chart', 'Dasbor', 'report', () => import('./dashboard.js')],
  ['transaksi', 'receipt', 'Transaksi', 'report', () => import('./transactions.js')],
  ['laporan', 'trend', 'Laporan', 'report', () => import('./reports.js')],
  ['shift', 'wallet', 'Shift kasir', 'report', () => import('./shifts.js')],
  ['menu', 'coffee', 'Menu & harga', 'menu.branch', () => import('./menu.js')],
  ['stok', 'box', 'Stok', 'stock', () => import('./stock.js')],
  ['promo', 'tag', 'Promo', 'promo', () => import('./promos.js')],
  ['cabang', 'store', 'Cabang', 'branch', () => import('./branches.js')],
  ['karyawan', 'users', 'Karyawan', 'staff', () => import('./staff.js')],
  ['perangkat', 'tablet', 'Perangkat', 'device', () => import('./devices.js')],
  ['pengaturan', 'settings', 'Pengaturan', 'settings', () => import('./settings.js')],
  ['log', 'activity', 'Log aktivitas', 'audit', () => import('./audit.js')],
];

export async function mount(el, params) {
  const pages = PAGES.filter((p) => can(p[3]));
  const id = params[0] && pages.some((p) => p[0] === params[0]) ? params[0] : pages[0][0];
  if (params[0] !== id) { history.replaceState(null, '', `#/kantor/${id}`); }
  el.innerHTML = `<div class="office">
    <nav class="subnav" aria-label="Menu kantor"><h3>Kantor</h3>
      ${pages.map(([pid, ic, label]) => `<a href="#/kantor/${pid}" class="${pid === id ? 'on' : ''}">${icon(ic, 'sm')}<span>${label}</span></a>`).join('')}
    </nav>
    <div class="office-main" id="om"></div>
  </div>`;
  const om = $('#om', el);

  // mode server: data kantor perlu sesi yang diverifikasi server
  if (S.be.isServer && !S.be.officeReady) {
    om.innerHTML = `<div class="topbar"><h1>Kantor</h1></div><div class="page"><div class="card pad" style="max-width:420px">
      <h3 class="card-title">${icon('lock', 'sm')} Verifikasi ke server</h3>
      <p class="hint" style="margin-bottom:12px">Masukkan PIN Anda sekali lagi untuk membuka data kantor dari server pusat.</p>
      <div class="row"><input class="input" id="op-pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" autocomplete="off"><button class="btn" id="op-go">Buka</button></div>
      <p class="err-text" id="op-err" hidden></p></div></div>`;
    const go = async () => {
      const pin = $('#op-pin', om).value.trim(); const err = $('#op-err', om);
      if (!(await verifyPin(pin, S.user.pin))) { err.textContent = 'PIN salah.'; err.hidden = false; return; }
      try { await S.be.officeLogin(S.user, pin); nav(`kantor/${id}`); } catch (e) { err.textContent = e.offline ? 'Server tidak bisa dihubungi. Periksa koneksi internet.' : e.message; err.hidden = false; }
    };
    $('#op-go', om).addEventListener('click', go);
    $('#op-pin', om).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return undefined;
  }

  const page = PAGES.find((p) => p[0] === id);
  const mod = await page[4]();
  try {
    return await mod.mount(om);
  } catch (e) {
    console.error(e);
    if (e.status === 401) { S.be.remote.session = null; toast('Sesi kantor berakhir, verifikasi ulang', 'warn'); nav(`kantor/${id}`); return undefined; }
    om.innerHTML = `<div class="topbar"><h1>${esc(page[2])}</h1></div><div class="page"><div class="note red">${icon('alert', 'sm')}<span>${esc(e.offline ? 'Tidak terhubung ke server pusat. Data kantor perlu koneksi internet.' : (e.message || String(e)))}</span></div></div>`;
    return undefined;
  }
}
