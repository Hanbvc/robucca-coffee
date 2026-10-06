/* Login staf dengan PIN. */
import { S, branch, master } from '../state.js';
import { $, esc, icon, avatar } from '../lib/ui.js';
import { ROLES, staffForBranch } from '../core/perms.js';
import { DEMO_PINS } from '../core/seed.js';
import { clock, dateLabel, tzLabel, bizDate } from '../core/dates.js';
import { setUser, homeFor } from '../app.js';
import { nav } from '../state.js';

export async function mount(el) {
  const be = S.be; const b = branch(); const m = master();
  const tz = (b && b.tz) || 'Asia/Jakarta';
  const people = staffForBranch(m.staff, b ? b.id : null);
  let who = null; let pin = ''; let busy = false;

  el.innerHTML = `<div class="split">
    <section class="brand-side">
      <img class="logo" src="../assets/brand/wordmark-light.png" alt="Robucca">
      <div>
        <h1>${esc(b ? b.name : 'Kantor pusat')}</h1>
        <p style="margin-top:8px">${b ? `${esc(m.settings.orgName)} · Terminal ${be.device.terminalNo} · ${esc(be.device.name)}` : 'Laporan & pengaturan semua cabang'}</p>
      </div>
      <div class="meta">
        <div class="clock" id="lg-clock"></div>
        <div id="lg-date"></div>
        <span class="pill">${be.isDemo ? `${icon('star', 'xs')} Mode demo — data contoh` : `${icon('cloud', 'xs')} Server pusat`}</span>
      </div>
    </section>
    <section class="main-side" id="lg-main"></section>
  </div>`;

  const tick = () => {
    const c = $('#lg-clock', el); if (!c) return;
    c.textContent = clock(Date.now(), tz);
    $('#lg-date', el).textContent = `${dateLabel(bizDate(Date.now(), tz), true)} · ${tzLabel(tz)}`;
  };
  tick();
  const timer = setInterval(tick, 10000);
  const main = $('#lg-main', el);

  function paintList() {
    who = null; pin = '';
    main.innerHTML = `<h2>Siapa yang bertugas?</h2>
      <p class="lead">Pilih nama Anda, lalu masukkan PIN.</p>
      ${people.length ? `<div class="staff-grid">${people.map((s) => `<button class="staff" data-staff="${s.id}">${avatar(s)}<b>${esc(s.name)}</b><span class="tag">${ROLES[s.role].name}</span></button>`).join('')}</div>`
        : `<div class="note red">${icon('alert', 'sm')}<span>Belum ada staf aktif untuk ${b ? 'cabang ini' : 'kantor pusat'}. Tambahkan staf dari perangkat kantor pusat (Kantor › Karyawan).</span></div>`}
      ${be.isDemo ? `<div class="demo-pins">${icon('key', 'xs')} PIN demo — Pemilik <b>${DEMO_PINS.owner}</b> · Manajer <b>${DEMO_PINS.manager}</b> · Kasir <b>${DEMO_PINS.cashier}</b> · Dapur <b>${DEMO_PINS.kitchen}</b></div>` : ''}`;
  }

  function paintPin(msg = '') {
    const len = Math.max(4, pin.length);
    main.innerHTML = `<div class="pin-box">
      <button class="btn ghost sm" data-back style="justify-self:start">${icon('chevron-left', 'sm')} Ganti nama</button>
      <div class="pin-who">${avatar(who)}<div><b>${esc(who.name)}</b><small>${ROLES[who.role].name}</small></div></div>
      <div class="pin-dots" id="pin-dots" aria-label="PIN ${pin.length} digit">${Array.from({ length: Math.min(6, len) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pin-msg" id="pin-msg" role="alert">${esc(msg)}</div>
      <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button data-k="${d}">${d}</button>`).join('')}
        <button class="fn" data-k="del" aria-label="Hapus">${icon('chevron-left')}</button><button data-k="0">0</button><button class="fn" data-k="ok" aria-label="Masuk">${icon('check')}</button></div>
    </div>`;
  }

  async function submit() {
    if (busy || pin.length < 4) return;
    busy = true;
    const res = await be.login(who, pin);
    busy = false;
    if (!res.ok) {
      pin = '';
      paintPin(res.locked ? `Terlalu banyak percobaan. Coba lagi dalam ${res.locked} detik.` : 'PIN salah.');
      const d = $('#pin-dots', el); d.classList.add('shake'); setTimeout(() => d.classList.remove('shake'), 450);
      return;
    }
    setUser(who);
    S.shift = b ? await be.currentShift() : null;
    nav(homeFor(who));
  }

  function key(k) {
    if (!who) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') { submit(); return; }
    else if (/^\d$/.test(k) && pin.length < 6) pin += k;
    paintPin();
    if (pin.length === 6) submit();
  }

  main.addEventListener('click', (e) => {
    const s = e.target.closest('[data-staff]');
    if (s) { who = m.person[s.dataset.staff]; pin = ''; paintPin(); return; }
    if (e.target.closest('[data-back]')) { paintList(); return; }
    const k = e.target.closest('[data-k]');
    if (k) key(k.dataset.k);
  });
  const onKey = (e) => {
    if (!who) return;
    if (/^\d$/.test(e.key)) key(e.key);
    else if (e.key === 'Backspace') key('del');
    else if (e.key === 'Enter') key('ok');
    else if (e.key === 'Escape') paintList();
  };
  document.addEventListener('keydown', onKey);
  paintList();
  if (people.length === 1) { who = people[0]; paintPin(); }

  return () => { clearInterval(timer); document.removeEventListener('keydown', onKey); };
}
