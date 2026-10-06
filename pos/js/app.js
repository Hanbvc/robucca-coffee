/* =========================================================
   Robucca POS — titik awal aplikasi: penyiapan perangkat, login, router, kerangka.
   ========================================================= */
import { Backend } from './data/backend.js';
import { bus } from './data/bus.js';
import { S, can, nav, branch } from './state.js';
import { $, esc, icon, avatar, toast, modal, closeAllModals, confirmBox, busy } from './lib/ui.js';
import { ROLES } from './core/perms.js';
import { tzLabel } from './core/dates.js';

const VIEWS = {
  setup: () => import('./views/setup.js'),
  masuk: () => import('./views/login.js'),
  kasir: () => import('./views/sell.js'),
  tagihan: () => import('./views/bills.js'),
  riwayat: () => import('./views/history.js'),
  shift: () => import('./views/shift.js'),
  dapur: () => import('./views/kds.js'),
  antrean: () => import('./views/queue.js'),
  kantor: () => import('./views/office/index.js'),
};

const root = $('#app');
let cleanup = null;
let renderSeq = 0;

/* ---------- sesi staf (bertahan saat halaman dimuat ulang di tab yang sama) ---------- */
const SESSION_KEY = 'pos:user';
export function setUser(staff) {
  S.user = staff;
  try {
    if (staff) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: staff.id, exp: Date.now() + 12 * 3600e3 }));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* noop */ }
}
function restoreUser() {
  try {
    const x = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    const s = x && x.exp > Date.now() && S.be.master.person[x.id];
    if (s && s.active !== false) { S.user = s; S.be.restoreOfficeSession(s.id); }
  } catch (e) { /* noop */ }
}
export function homeFor(user) {
  if (!S.be.device.branchId) return 'kantor/dasbor';
  if (can('sell')) return 'kasir';
  if (can('kds')) return 'dapur';
  return 'kantor/dasbor';
}
export async function logout(lockOnly = false) {
  if (!lockOnly) S.be.logout();
  setUser(null);
  S.shift = null;
  closeAllModals();
  nav('masuk');
}

/* ---------- router ---------- */
function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  S.query = Object.fromEntries(new URLSearchParams(qs || ''));
  return parts;
}

async function render() {
  const seq = ++renderSeq;
  closeAllModals();
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  if (!S.be.device) return mount('setup', [], 'full', seq);
  let parts = parse();
  if (!S.user) {
    if (parts[0] !== 'masuk') { history.replaceState(null, '', '#/masuk'); parts = ['masuk']; }
    return mount('masuk', [], 'full', seq);
  }
  if (!parts.length || parts[0] === 'masuk' || parts[0] === 'setup') { nav(homeFor(S.user)); return; }
  const name = parts[0];
  if (!VIEWS[name]) { nav(homeFor(S.user)); return; }
  const needBranch = ['kasir', 'tagihan', 'riwayat', 'shift', 'dapur', 'antrean'].includes(name);
  if (needBranch && !branch()) { nav('kantor/dasbor'); return; }
  const perm = { kasir: 'sell', tagihan: 'sell', riwayat: 'sell', shift: 'sell', dapur: 'kds', antrean: 'kds', kantor: 'office' }[name];
  if (perm && !can(perm)) { toast('Anda tidak punya akses ke halaman itu', 'warn'); nav(homeFor(S.user)); return; }
  S.route = parts.join('/');
  return mount(name, parts.slice(1), name === 'antrean' ? 'full' : 'shell', seq);
}

async function mount(name, params, layout, seq) {
  let mod;
  try { mod = await VIEWS[name](); } catch (e) {
    console.error(e);
    if (!window.__posReady && window.__posBootFail) { window.__posBootFail(`Halaman tidak bisa dimuat: ${e.message || e}`); return; }
    root.innerHTML = `<div class="empty"><div class="em-ico">${icon('wifi-off', 'lg')}</div><h3>Halaman tidak bisa dimuat</h3><p>${esc(e.message || e)}</p><button class="btn" data-reload>Muat ulang</button></div>`;
    root.querySelector('[data-reload]').addEventListener('click', () => location.reload());
    return;
  }
  if (seq !== renderSeq) return;
  let host;
  if (layout === 'full') {
    root.innerHTML = '<div class="fullview" id="view"></div>';
    host = $('#view');
  } else {
    if (!$('.shell', root)) root.innerHTML = `<div class="shell"><nav class="rail" id="rail" aria-label="Navigasi utama"></nav><main class="main" id="view" tabindex="-1"></main></div>`;
    renderRail(name);
    // elemen baru agar event listener halaman sebelumnya tidak ikut terbawa
    const prev = $('#view');
    host = prev.cloneNode(false);
    host.className = 'main';
    prev.replaceWith(host);
  }
  try {
    const c = await mod.mount(host, params);
    if (seq === renderSeq) cleanup = typeof c === 'function' ? c : null;
    else if (typeof c === 'function') c();
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="empty"><div class="em-ico">${icon('alert', 'lg')}</div><h3>Halaman gagal dimuat</h3><p>${esc(e.message || e)}</p><button class="btn" data-reload>Muat ulang</button></div>`;
    host.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  }
}

/* ---------- rail navigasi ---------- */
let railName = '';
function renderRail(active = railName) {
  railName = active;
  const rail = $('#rail'); if (!rail) return;
  const b = branch();
  const items = [];
  if (b && can('sell')) {
    items.push(['kasir', 'grid', 'Kasir'], ['tagihan', 'note', 'Tagihan'], ['riwayat', 'receipt', 'Riwayat'], ['shift', 'wallet', 'Shift']);
  }
  if (b && can('kds')) items.push(['dapur', 'chef', 'Dapur']);
  if (can('office')) items.push(['kantor', 'chart', 'Kantor']);
  const be = S.be;
  const netCls = be.isDemo ? 'demo' : be.online === false ? 'off' : '';
  const netText = be.isDemo ? 'Demo' : be.online === false ? 'Offline' : 'Online';
  rail.innerHTML = `
    <div class="r-logo"><img src="../assets/brand/wordmark-light.png" alt="Robucca"></div>
    ${items.map(([r, ic, label]) => `<a href="#/${r === 'kantor' ? 'kantor/dasbor' : r}" class="${active === r ? 'on' : ''}" data-r="${r}">${icon(ic)}<span>${label}</span>${r === 'tagihan' ? '<i class="badge" data-badge="bills" hidden></i>' : ''}</a>`).join('')}
    <div class="r-space"></div>
    <button class="r-net ${netCls}" data-act="net" title="Status sinkronisasi"><i></i><span>${netText}</span><span data-pending></span></button>
    <button class="r-user" data-act="user" aria-label="Menu pengguna">${avatar(S.user, 'sm')}<span class="clamp1" style="max-width:70px">${esc((S.user.name || '').split(' ')[0])}</span></button>`;
  refreshBadges();
}
export { renderRail };

async function refreshBadges() {
  const b = branch(); const el = $('[data-badge="bills"]');
  if (b && el) {
    const n = (await S.be.openOrders(b.id)).length;
    el.textContent = n; el.hidden = !n;
  }
  if (S.be.isServer) {
    const st = await S.be.syncState();
    const p = $('[data-pending]');
    if (p) p.textContent = st.pending ? `${st.pending} antre` : '';
  }
}

root.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || !a.closest('#rail')) return;
  if (a.dataset.act === 'user') userMenu();
  if (a.dataset.act === 'net') netInfo();
});

function userMenu() {
  const be = S.be; const b = branch(); const u = S.user;
  const m = modal({
    title: u.name, sub: `${ROLES[u.role].name}${b ? ` · ${esc(b.name)}` : ' · Kantor pusat'}`, size: 'sm',
    body: `<div class="col">
      <dl class="kv"><dt>Perangkat</dt><dd>${esc(be.device.name)}${b ? ` · Terminal ${be.device.terminalNo}` : ''}</dd>
      <dt>Mode</dt><dd>${be.isDemo ? 'Demo (data di perangkat ini)' : 'Terhubung ke server'}</dd>
      ${b ? `<dt>Zona waktu</dt><dd>${tzLabel(b.tz)}</dd>` : ''}</dl>
      <hr class="divider">
      <button class="btn ghost block" data-u="lock">${icon('lock', 'sm')} Kunci layar / ganti kasir</button>
      ${b && can('kds') ? `<button class="btn ghost block" data-u="queue">${icon('tv', 'sm')} Layar antrean pelanggan</button>` : ''}
      ${be.isDemo && can('office') ? `<button class="btn ghost block" data-u="branch">${icon('store', 'sm')} Ganti cabang perangkat ini (demo)</button>` : ''}
      <button class="btn ghost block" data-u="logout">${icon('logout', 'sm')} Keluar</button>
    </div>`,
  });
  m.el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-u]'); if (!x) return;
    m.close();
    if (x.dataset.u === 'lock') logout(true);
    if (x.dataset.u === 'logout') logout(false);
    if (x.dataset.u === 'queue') nav('antrean');
    if (x.dataset.u === 'branch') switchBranchDemo();
  });
}

async function switchBranchDemo() {
  const be = S.be;
  const sh = await be.currentShift();
  if (sh) { toast('Tutup shift kasir dulu sebelum ganti cabang', 'warn'); return; }
  const m = modal({
    title: 'Ganti cabang perangkat', sub: 'Mode demo: perangkat ini berperan sebagai kasir cabang yang dipilih.', size: 'sm',
    body: `<div class="branch-pick">${be.master.activeBranches().map((x) => `<button class="branch-opt ${x.id === be.device.branchId ? 'on' : ''}" data-b="${x.id}"><b>${esc(x.name)}</b><small>${esc(x.code)}</small></button>`).join('')}</div>`,
  });
  m.el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-b]'); if (!x) return;
    m.close();
    await be.switchBranch(x.dataset.b);
    S.shift = null;
    toast(`Perangkat kini kasir ${be.branch.name}`);
    logout(true);
  });
}

async function netInfo() {
  const be = S.be;
  if (be.isDemo) {
    modal({ title: 'Mode demo', size: 'sm', body: `<p style="margin:0;color:var(--ink-2)">Semua data tersimpan di browser perangkat ini saja. Untuk dipakai bersama oleh semua cabang, jalankan server pusat lalu pasangkan tiap perangkat (lihat <b>pos/README.md</b>).</p>` });
    return;
  }
  const st = await be.syncState();
  const m = modal({
    title: 'Sinkronisasi', size: 'sm',
    body: `<dl class="kv">
      <dt>Status</dt><dd>${st.online === false ? '<span class="neg">Offline</span>' : '<span class="pos">Online</span>'}</dd>
      <dt>Menunggu dikirim</dt><dd>${st.pending} data</dd>
      <dt>Terakhir sinkron</dt><dd>${st.lastSync ? new Date(st.lastSync).toLocaleString('id-ID') : '—'}</dd>
      <dt>Server</dt><dd style="word-break:break-all">${esc(be.device.serverUrl)}</dd>
      <dt>Ditolak server</dt><dd>${st.errors}</dd></dl>
      ${be.syncErrors.length ? `<div class="note red" style="margin-top:12px">${icon('alert', 'sm')}<div>${be.syncErrors.slice(0, 5).map((x) => `${esc(x.coll)} ${esc(String(x.id).slice(0, 8))}: ${esc((x.errors || []).join(', '))}`).join('<br>')}</div></div>` : ''}
      <p class="hint" style="margin-top:12px">Saat offline, transaksi tetap tersimpan di perangkat ini dan dikirim otomatis begitu koneksi kembali.</p>`,
    foot: '<button class="btn" data-sync>Sinkronkan sekarang</button>',
  });
  $('[data-sync]', m.el).addEventListener('click', async () => {
    const bz = busy('Menyinkronkan…');
    await be.syncOnce();
    bz.done(); m.close();
    const s2 = await be.syncState();
    toast(s2.online === false ? 'Server belum bisa dihubungi' : 'Sinkron selesai', s2.online === false ? 'warn' : 'ok');
  });
}

/* ---------- kunci otomatis saat tidak dipakai ---------- */
let idleT = null;
function armIdle() {
  clearTimeout(idleT);
  const min = Number(S.be && S.be.master && S.be.master.settings.autoLockMin) || 0;
  if (!min || !S.user) return;
  idleT = setTimeout(() => { if (S.user && !location.hash.includes('antrean') && !location.hash.includes('dapur')) { toast('Layar dikunci otomatis', 'warn'); logout(true); } }, min * 60e3);
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, armIdle, { passive: true }));

/* ---------- mulai ---------- */
async function start() {
  try {
    S.be = await Backend.create();
  } catch (e) {
    console.error(e);
    if (window.__posBootFail) window.__posBootFail(`Penyimpanan perangkat tidak bisa dibuka: ${e.message || e}`);
    else $('#boot-msg').textContent = `Penyimpanan perangkat tidak bisa dibuka: ${e.message || e}`;
    return;
  }
  if (S.be.device) {
    restoreUser();
    if (S.be.isServer) S.be.startSync();
  }
  bus.on('orders', () => refreshBadges());
  bus.on('sync', () => refreshBadges());
  bus.on('net', () => renderRail());
  bus.on('master', () => {
    // staf dihapus/dinonaktifkan dari pusat → keluar
    const p = S.user && S.be.master && S.be.master.person[S.user.id];
    if (S.user && (!p || p.active === false)) logout(true);
    else if (S.user) S.user = p;
  });
  bus.on('revoked', () => {
    if (S.revokedShown) return;
    S.revokedShown = true;
    const m = modal({
      title: 'Akses perangkat dicabut', dismissable: false, size: 'sm',
      body: '<p style="margin:0;color:var(--ink-2)">Perangkat ini tidak lagi diizinkan oleh server pusat. Data yang belum terkirim tetap tersimpan di perangkat. Hubungi pemilik/manajer untuk memasangkan ulang.</p>',
      foot: '<button class="btn danger" data-reset>Hapus data & pasang ulang</button>',
    });
    $('[data-reset]', m.el).addEventListener('click', () => window.__posReset());
  });
  window.addEventListener('hashchange', render);
  const boot = $('#boot');
  try {
    await render();
  } catch (e) {
    console.error(e);
    if (window.__posBootFail) window.__posBootFail(`Aplikasi gagal dimulai: ${e.message || e}`);
    return;
  }
  window.__posReady = true;
  if (boot) { boot.style.transition = 'opacity .3s'; boot.style.opacity = '0'; setTimeout(() => boot.remove(), 320); }
  armIdle();
}

window.__posReset = async () => {
  if (!(await confirmBox({ title: 'Hapus semua data perangkat?', text: 'Semua data lokal (termasuk transaksi yang belum terkirim) di perangkat ini akan dihapus.', ok: 'Hapus', danger: true }))) return;
  await S.be.destroy();
  try { sessionStorage.clear(); } catch (e) { /* noop */ }
  location.hash = '';
  location.reload();
};

/* service worker: aplikasi tetap terbuka saat offline */
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw/.test(location.search)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
