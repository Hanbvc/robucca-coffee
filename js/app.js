/* =========================================================
   Prototipe app pemesanan & reservasi (vanilla JS, tanpa build step)
   ========================================================= */
(() => {
  'use strict';

  const C = window.MG_CONFIG;
  const MENU = window.MG_MENU;
  const GROUPS = window.MG_GROUPS;
  const BANNERS = window.MG_BANNERS;

  /* Simulasi status pesanan (detik setelah dibayar): [mulai disiapkan, siap].
     Ganti dengan status dari backend/POS saat sudah terhubung. */
  const DEMO_STATUS_SECONDS = [8, 30];

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const IMG = (id) => `assets/img/${id}.jpg`;
  const rp = (n) => 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const rand4 = () => String(Math.floor(1000 + Math.random() * 9000));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  /* ---------- platform (iPhone) ---------- */
  const IS_IOS = /iP(hone|od|ad)/.test(navigator.platform) || /iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const root = document.documentElement;
  root.classList.toggle('ios', IS_IOS);
  root.classList.toggle('standalone', IS_STANDALONE);

  // Haptic: Android via Vibration API; iPhone (iOS 18+) via toggle <input switch> tersembunyi.
  function haptic() {
    try {
      if (navigator.vibrate) { navigator.vibrate(8); return; }
      if (!IS_IOS) return;
      const l = document.createElement('label'); l.setAttribute('aria-hidden', 'true'); l.style.display = 'none';
      const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', '');
      l.appendChild(i); document.head.appendChild(l); l.click(); l.remove();
    } catch (e) { /* noop */ }
  }
  const vibrate = haptic;

  // iOS hanya membuka keyboard bila fokus terjadi di dalam gestur sentuh.
  // Fokuskan input sementara sekarang, lalu pindahkan fokus ke input asli setelah sheet tampil.
  function primeKeyboard() {
    if (!IS_IOS) return null;
    const t = document.createElement('input');
    t.setAttribute('aria-hidden', 'true'); t.tabIndex = -1;
    t.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;';
    document.body.appendChild(t);
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
    return t;
  }
  function focusLater(inp, prime, ms = 360) {
    setTimeout(() => {
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
      if (prime) prime.remove();
    }, ms);
  }

  /* ---------- icons ---------- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v3M10 2v3M14 2v3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    receipt: '<path d="M5 2.5v19l2.3-1.5 2.4 1.5 2.3-1.5 2.3 1.5 2.4-1.5 2.3 1.5v-19l-2.3 1.5-2.4-1.5-2.3 1.5-2.3-1.5-2.4 1.5Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
    instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><path d="M17.5 6.5h.01"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.4 4.6 5 5"/>',
    bag: '<path d="M6 7h12l1.2 13a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    utensils: '<path d="M4 2v7a3 3 0 0 0 3 3v10M10 2v7a3 3 0 0 1-3 3M7 2v6"/><path d="M20 15V2a5 5 0 0 0-4 5v6a2 2 0 0 0 2 2h2Zm0 0v7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    star: '<path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a5.5 5.5 0 0 1 3.5 5.1v.9"/>',
    trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m2.5 0-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6"/>',
    edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    nav: '<path d="M3 11 21 3l-8 18-2-8Z"/>',
    wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M3 7h16a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    'calendar-plus': '<path d="M8 2v4M16 2v4M21 12V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M3 10h18M18 15v6M15 18h6"/>',
    chat: '<path d="M3 21l1.6-4.4A8.5 8.5 0 1 1 8 20Z"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>',
    'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    rotate: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>',
    phone2: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    sparkle: '<path d="M12 3 10.1 8.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    scooter: '<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.6 18h6.6l2.4-6"/><path d="M14.5 5.5h2.3l2.6 10"/><path d="M3.5 14.5h6.3l1.6 3.5"/><rect x="3.5" y="8" width="6" height="6.5" rx="1"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
    share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  };
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  /* ---------- time (WIB / Asia/Jakarta) ---------- */
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const DAYS_S = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const JKT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function jkt(ts = Date.now()) {
    const p = {};
    JKT.formatToParts(new Date(ts)).forEach((x) => { p[x.type] = x.value; });
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  }
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const dot = (s) => s.replace(':', '.');
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const minOf = (d) => d.getHours() * 60 + d.getMinutes();
  const isOpen = (d = jkt()) => minOf(d) >= toMin(C.open) && minOf(d) < toMin(C.close);
  const dateShort = (s) => { const d = parseYmd(s); return `${DAYS_S[d.getDay()]}, ${d.getDate()} ${MONTHS_S[d.getMonth()]}`; };
  const dateLong = (s) => { const d = parseYmd(s); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const clock = (ts) => { const d = jkt(ts); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; };
  const stampLabel = (ts) => { const d = jkt(ts); const t = ymd(jkt()); const ds = ymd(d); const day = ds === t ? 'Hari ini' : ds === ymd(addDays(jkt(), -1)) ? 'Kemarin' : dateShort(ds); return `${day}, ${clock(ts)}`; };
  function greeting(d = jkt()) {
    const h = d.getHours();
    return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  }

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mg_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mg_' + k, JSON.stringify(v)); } catch (e) { /* storage penuh / diblokir */ } },
  };

  /* ---------- menu index & pricing ---------- */
  const ITEMS = {};
  const CAT_OF = {};
  MENU.forEach((c) => c.items.forEach((it) => {
    ITEMS[it.id] = it; CAT_OF[it.id] = c;
    if (it.img === undefined) it.img = it.id;
  }));
  // Harga tampil = harga buku menu (+ pajak bila C.taxRate > 0), dibulatkan
  const incl = (p, cat) => (cat && cat.taxIncluded ? p : Math.round((p * (1 + C.taxRate)) / C.roundTo) * C.roundTo);
  const itemPrice = (it) => incl(it.price, CAT_OF[it.id]);
  const hasOpts = (it) => !!(it.opts && it.opts.length);
  const visible = (g, sel) => !g.showIf || Object.entries(g.showIf).every(([k, v]) => (Array.isArray(v) ? v.includes(sel[k]) : sel[k] === v));
  // Foto mengikuti pilihan (mis. versi Hot punya foto sendiri)
  const lineImg = (id, sel) => { const it = ITEMS[id]; const c = chosen(it, sel || {}).find((x) => x.c.img); return c ? c.c.img : it.img; };

  function defaults(it) {
    const sel = {};
    (it.opts || []).forEach((g) => {
      if (g.type === 'multi') sel[g.id] = [];
      else if (g.def) sel[g.id] = g.def;
      else if (!g.required) sel[g.id] = g.choices[0].n;
    });
    return sel;
  }
  function cleanSel(it, sel) {
    const out = {};
    (it.opts || []).forEach((g) => {
      if (!visible(g, sel)) return;
      const v = sel[g.id];
      if (g.type === 'multi') { if (v && v.length) out[g.id] = [...v].sort(); } else if (v != null) out[g.id] = v;
    });
    return out;
  }
  function chosen(it, sel) {
    const out = [];
    (it.opts || []).forEach((g) => {
      if (!visible(g, sel)) return;
      const v = sel[g.id];
      if (v == null) return;
      (Array.isArray(v) ? v : [v]).forEach((n) => { const c = g.choices.find((x) => x.n === n); if (c) out.push({ g, c }); });
    });
    return out;
  }
  function unit(line) {
    const it = ITEMS[line.id]; const cat = CAT_OF[line.id];
    let p = incl(it.price, cat); let base = it.price;
    chosen(it, line.sel).forEach(({ c }) => { if (c.p) { p += incl(c.p, cat); base += c.p; } });
    return { p, base };
  }
  function summary(line) {
    const it = ITEMS[line.id]; const parts = []; const adds = [];
    (it.opts || []).forEach((g) => {
      if (!visible(g, line.sel)) return;
      const v = line.sel[g.id];
      if (v == null || (Array.isArray(v) && !v.length)) return;
      if (g.type === 'multi') adds.push(...v);
      else if (g.required || v !== g.choices[0].n) parts.push(v);
    });
    if (adds.length) parts.push('+ ' + adds.join(', '));
    return parts.join(' · ');
  }
  function totals(lines) {
    let total = 0; let tax = 0; let count = 0;
    lines.forEach((l) => {
      const u = unit(l);
      total += u.p * l.qty; count += l.qty;
      if (!CAT_OF[l.id].taxIncluded) tax += (u.p - u.base) * l.qty;
    });
    return { total, tax: Math.round(tax), count };
  }

  /* ---------- state ---------- */
  // Tipe pesanan: 'pickup' (pesan & ambil tanpa antre) atau 'delivery' (diantar GoSend / GrabExpress)
  const normMode = (m) => (m === 'delivery' ? 'delivery' : 'pickup');
  const S = {
    cart: store.get('cart', []).filter((l) => ITEMS[l.id]),
    mode: normMode(store.get('mode', 'pickup')),
    preRsv: store.get('preRsv', null),
    addr: store.get('addr', { text: '', note: '', km: null }),
    courier: store.get('courier', 'gosend'),
    pickup: 'asap',
    cutlery: false,
    pay: store.get('pay', 'qris'),
    profile: store.get('profile', { name: '', phone: '' }),
    orders: store.get('orders', []),
    rsvs: store.get('rsvs', []),
    rd: store.get('rd', null),
  };
  const save = (...keys) => keys.forEach((k) => store.set(k, S[k]));
  const sortSel = (sel) => Object.keys(sel).sort().map((k) => [k, sel[k]]);
  const lineKey = (id, sel, note) => `${id}|${JSON.stringify(sortSel(sel))}|${(note || '').trim().toLowerCase()}`;
  const qtyOf = (id) => S.cart.filter((l) => l.id === id).reduce((a, l) => a + l.qty, 0);
  function addLine(id, sel, note, qty) {
    const key = lineKey(id, sel, note);
    const ex = S.cart.find((l) => l.key === key);
    if (ex) ex.qty += qty; else S.cart.push({ key, id, sel, note: (note || '').trim(), qty });
    save('cart');
  }
  const getRsv = (id) => S.rsvs.find((r) => r.id === id);
  const activePreRsv = () => { const r = S.preRsv && getRsv(S.preRsv); return r && r.status !== 'cancelled' ? r : null; };

  /* ---------- pick up & delivery ---------- */
  const DLV = C.delivery;
  const courierOf = (id) => DLV.couriers.find((c) => c.id === id) || DLV.couriers[0];
  // label & ikon per tipe pesanan (dinein/takeaway = data lama di perangkat)
  const KIND = { pickup: 'Pick Up', takeaway: 'Pick Up', delivery: 'Delivery', preorder: 'Pre-order', dinein: 'Dine In' };
  const KIND_ICON = { pickup: 'bag', takeaway: 'bag', delivery: 'scooter', preorder: 'calendar', dinein: 'utensils' };
  const isPickup = (o) => o.mode === 'pickup' || o.mode === 'takeaway';
  const kmLabel = (km) => `${km.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`;
  const dlvKm = () => (S.addr.km != null ? S.addr.km : DLV.defaultKm);
  const dlvFee = (c, km) => Math.ceil(Math.max(c.min, c.base + c.perKm * km) / 500) * 500;
  const dlvEta = (km) => C.prepMinutes + 10 + Math.ceil(km * 3);
  const shortAddr = (a) => { const t = String(a || '').split(',')[0].trim(); return t.length > 30 ? t.slice(0, 29) + '…' : t; };
  function distKm(lat, lng) { // jarak garis lurus × faktor jalan
    const R = 6371; const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(lat - C.lat); const dLng = rad(lng - C.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(C.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)) * DLV.roadFactor * 10) / 10;
  }
  // Data driver simulasi — di versi final datang dari API GoSend / GrabExpress
  const DRIVERS = [['Agus Setiawan', 'N 4821 ABK', 'Honda Vario'], ['Dimas Pratama', 'N 3317 AAF', 'Yamaha NMAX'], ['Rizky Ramadhan', 'N 5609 BCD', 'Honda Beat'], ['Fajar Nugroho', 'N 2148 AJ', 'Yamaha Mio'], ['Bagus Wicaksono', 'N 6732 BX', 'Honda Scoopy']];
  const pickDriver = () => { const [name, plate, bike] = DRIVERS[Math.floor(Math.random() * DRIVERS.length)]; return { name, plate, bike }; };

  /* ---------- UI atoms ---------- */
  function pic(id, name = '', cls = '', big = false) {
    if (!id) return `<div class="im loaded ${cls}"><div class="ph ${big ? 'big' : ''}"><span>${esc(name)}</span></div></div>`;
    return `<div class="im ${cls}"><img src="${IMG(id)}" alt="" loading="lazy" decoding="async"></div>`;
  }
  function hydrate(root) {
    $$('.im img', root).forEach((img) => {
      const done = () => { img.classList.add('ok'); img.parentElement.classList.add('loaded'); };
      if (img.complete && img.naturalWidth) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => { img.parentElement.classList.add('loaded'); img.remove(); }, { once: true });
      }
    });
    $$('[data-icon]', root).forEach((s) => { s.innerHTML = icon(s.dataset.icon); s.removeAttribute('data-icon'); });
  }
  function addCtl(it) {
    const n = qtyOf(it.id);
    if (!hasOpts(it) && n > 0) {
      return `<span class="qty" data-ctl="${it.id}"><button data-act="dec" data-id="${it.id}" aria-label="Kurangi">${icon('minus', 'sm')}</button><b>${n}</b><button data-act="inc" data-id="${it.id}" aria-label="Tambah">${icon('plus', 'sm')}</button></span>`;
    }
    return `<button class="add" data-ctl="${it.id}" data-act="quick" data-id="${it.id}" aria-label="Tambah ${esc(it.name)}">${n ? `<span class="n">${n}</span>` : icon('plus', 'sm')}</button>`;
  }
  function refreshCtl(id) {
    const it = ITEMS[id];
    $$(`[data-ctl="${id}"]`).forEach((x) => {
      const light = x.classList.contains('light');
      const t = el('div'); t.innerHTML = addCtl(it);
      const n = t.firstElementChild; if (light && n.classList.contains('add')) n.classList.add('light');
      x.replaceWith(n);
    });
  }
  function itemRow(it) {
    const sig = it.sig ? ` <span class="star" aria-label="Signature">★</span>` : '';
    return `<div class="item" data-act="item" data-id="${it.id}" role="button" tabindex="0">
      ${pic(it.img, it.name)}
      <div class="it-b">
        <h3>${esc(it.name)}${sig}</h3>
        ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
        <div class="it-f"><span class="pr">${rp(itemPrice(it))}</span>${addCtl(it)}</div>
      </div>
    </div>`;
  }
  let toastT;
  function toast(msg, ic = 'check') {
    const t = $('#toast');
    t.innerHTML = `${icon(ic, 'sm')}<span>${esc(msg)}</span>`;
    t.classList.add('in');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('in'), 2300);
  }
  function processing(text, ms = 1100) {
    return new Promise((res) => {
      const o = el('div', 'processing');
      o.innerHTML = `<div class="pc"><div class="spinner"></div><p>${esc(text)}</p></div>`;
      document.body.append(o);
      setTimeout(() => { o.remove(); res(); }, ms);
    });
  }
  function fly(fromEl, imgId) {
    const bar = $('#cartbar');
    if (!fromEl || bar.hidden) return;
    const a = fromEl.getBoundingClientRect();
    const b = $('.cb-ico', bar).getBoundingClientRect();
    const f = el('div', 'fly');
    f.innerHTML = imgId ? `<img src="${IMG(imgId)}" alt="">` : '';
    if (!imgId) f.style.background = 'var(--ink)';
    document.body.append(f);
    const x0 = a.left + a.width / 2 - 27; const y0 = a.top + a.height / 2 - 27;
    const x1 = b.left + b.width / 2 - 27; const y1 = b.top + b.height / 2 - 27;
    const anim = f.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.9)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 60}px) scale(.75)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x1}px, ${y1}px) scale(.25)`, opacity: 0.4 },
    ], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
    anim.onfinish = () => { f.remove(); bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump'); };
  }

  /* ---------- sheets (terhubung dengan tombol back) ---------- */
  const sheetStack = [];
  let afterClose = null;
  function openSheet(html, opts = {}) {
    const bd = el('div', 'backdrop');
    const sh = el('div', 'sheet' + (opts.full ? ' full' : ''));
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = `<div class="sheet-handle ${opts.handleOnImg ? 'on-img' : ''}"></div>${html}`;
    $('#sheets').append(bd, sh);
    hydrate(sh);
    requestAnimationFrame(() => requestAnimationFrame(() => { bd.classList.add('in'); sh.classList.add('in'); }));
    const entry = { bd, sh, opts };
    sheetStack.push(entry);
    history.pushState({ mgSheet: sheetStack.length }, '');
    root.classList.add('lock'); document.body.classList.add('lock');
    bd.addEventListener('click', () => closeSheet());
    // iOS: cegah halaman di belakang ikut tergulir
    bd.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    sh.addEventListener('touchmove', (e) => {
      if (e.target.closest('.sheet-body, .hscroll, textarea')) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    enableDrag(sh);
    return sh;
  }
  function closeSheet(after) {
    if (!sheetStack.length) { if (after) after(); return; }
    afterClose = after || null;
    history.back();
  }
  function dropSheet() {
    const top = sheetStack.pop();
    if (!top) return;
    const { bd, sh, opts } = top;
    bd.classList.remove('in'); sh.classList.remove('in'); sh.style.transform = '';
    setTimeout(() => { bd.remove(); sh.remove(); }, 400);
    if (opts.onClose) opts.onClose();
    if (!sheetStack.length) { root.classList.remove('lock'); document.body.classList.remove('lock'); }
  }
  window.addEventListener('popstate', () => {
    if (!sheetStack.length) return;
    dropSheet();
    const fn = afterClose; afterClose = null;
    if (fn) setTimeout(fn, 30);
  });
  function enableDrag(sh) {
    let y0 = null; let dy = 0; let t0 = 0; let active = false;
    sh.addEventListener('touchstart', (e) => {
      const body = $('.sheet-body', sh);
      const onHandle = !!e.target.closest('.sheet-handle');
      if (!onHandle && (e.target.closest('input, textarea, .hscroll') || (body && body.scrollTop > 2))) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); active = false;
    }, { passive: true });
    sh.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (!active && dy > 8) { active = true; sh.classList.add('drag'); }
      if (active) {
        if (e.cancelable) e.preventDefault();
        sh.style.transform = `translate(-50%, ${Math.max(0, dy)}px)`;
      }
    }, { passive: false });
    sh.addEventListener('touchend', () => {
      if (!active) { y0 = null; return; }
      sh.classList.remove('drag');
      const v = dy / Math.max(1, Date.now() - t0);
      if (dy > 120 || v > 0.6) closeSheet(); else sh.style.transform = '';
      y0 = null; active = false;
    });
  }
  function confirmSheet({ title, text, ok, danger, onOk }) {
    const sh = openSheet(`<div class="sheet-body"><div class="sheet-head"><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>
      <div class="sheet-foot"><button class="btn soft grow" data-act="close">Batal</button><button class="btn grow ${danger ? '' : ''}" data-s="ok" ${danger ? 'style="background:var(--danger)"' : ''}>${esc(ok)}</button></div>`);
    $('[data-s="ok"]', sh).addEventListener('click', () => closeSheet(onOk));
  }

  /* ---------- router ---------- */
  const view = $('#view');
  let cleanup = [];
  let curPath = null;
  const scrollMem = {};
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    return { path: path || '/', q: new URLSearchParams(qs || '') };
  }
  const go = (path) => {
    if (sheetStack.length) { closeSheet(() => go(path)); return; }
    if (location.hash === '#' + path) render(); else location.hash = path;
  };
  const replace = (path) => {
    if (sheetStack.length) { closeSheet(() => replace(path)); return; }
    location.replace('#' + path);
  };

  function render(keep = false) {
    const { path, q } = parseHash();
    const r = ROUTES.find((x) => x.re.test(path)) || ROUTES[0];
    const m = path.match(r.re) || [];
    cleanup.forEach((f) => f()); cleanup = [];
    document.body.classList.toggle('sub', !r.tab);
    $$('.tabbar a').forEach((a) => {
      const on = a.dataset.tab === r.tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const y = scrollY;
    view.innerHTML = `<div class="screen ${keep ? 'still' : ''}">${r.view.html(m, q)}</div>`;
    hydrate(view);
    window.scrollTo(0, keep ? y : (r.tab && path === curPath ? y : (r.tab ? scrollMem[path] || 0 : 0)));
    curPath = path;
    if (r.view.mount) r.view.mount(view, m, q);
    updateCartBar();
    updateTabDot();
  }
  const rerender = () => render(true);
  window.addEventListener('hashchange', () => {
    if (curPath) scrollMem[curPath] = scrollY;
    render();
  });

  /* ---------- cart bar & tab dot ---------- */
  function ctxText() {
    const r = activePreRsv();
    if (r) return `Pre-order · ${r.code}`;
    return S.mode === 'delivery' ? 'Delivery' : 'Pick Up';
  }
  function updateCartBar() {
    const bar = $('#cartbar');
    const { path } = parseHash();
    const show = S.cart.length > 0 && (path === '/' || path === '/menu');
    document.body.classList.toggle('has-cart', show);
    if (!show) { bar.hidden = true; return; }
    const t = totals(S.cart);
    bar.innerHTML = `<span class="cb-ico">${icon('bag')}<span class="cb-count">${t.count}</span></span>
      <span class="cb-text"><b>${rp(t.total)}</b><span>${esc(ctxText())} · ${t.count} item</span></span>
      <span class="cb-go">Keranjang ${icon('chevron-right', 'xs')}</span>`;
    bar.dataset.act = 'checkout';
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', `Buka keranjang, ${t.count} item, ${rp(t.total)}`);
    bar.hidden = false;
  }
  function updateTabDot() {
    const live = S.orders.some((o) => orderState(o).step < 3 && orderState(o).step > -2) || S.rsvs.some((r) => rsvState(r) === 'upcoming');
    $('.tab-dot').hidden = !live;
  }

  /* =========================================================
     SCREEN: HOME
     ========================================================= */
  const Home = {
    html() {
      const d = jkt(); const open = isOpen(d);
      const first = (S.profile.name || '').trim().split(/\s+/)[0];
      const live = S.orders.find((o) => { const s = orderState(o).step; return s >= -1 && s < 3; });
      const nextR = S.rsvs.filter((r) => rsvState(r) === 'upcoming').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
      const sigs = MENU.flatMap((c) => c.items.filter((i) => i.sig));
      const cats = C.homeCats;
      return `
      <div class="home-top">
        <div class="home-bar">
          <span class="row" style="gap:8px"><img class="logo" src="assets/brand/wordmark-dark.png" alt="${esc(C.storeName)}"><span class="proto-tag" title="Prototipe untuk demo, belum terhubung ke kasir ${esc(C.storeName)}">Prototipe</span></span>
          <button class="icon-btn" data-act="search" aria-label="Cari menu">${icon('search')}</button>
        </div>
        <div class="greet">
          <small>${greeting(d)}${first ? ', ' + esc(first) : ''}</small>
          <h1>${esc(C.welcome)}</h1>
        </div>
        <button class="store-card" data-act="store" aria-label="Info toko" style="display:block;width:100%;text-align:left">
          ${pic(C.heroImg)}
          <span class="sc-tag"><span class="tag ${open ? 'olive' : 'red'}"><i class="dot"></i>${open ? `Buka · tutup ${dot(C.close)}` : `Tutup · buka ${dot(C.open)}`}</span></span>
          <span class="sc-go">${icon('info', 'sm')}</span>
          <span class="sc-in"><b class="sc-t">${esc(C.storeName)} ${esc(C.branch)}</b><span class="sc-a">${icon('map-pin', 'xs')} ${esc(C.addressShort)}</span></span>
        </button>
        <div class="modes">
          <button class="mode" data-act="start" data-mode="pickup"><span class="mi">${icon('bag')}</span><span><b>Pick Up</b><small>Pesan &amp; ambil tanpa antre</small></span></button>
          <button class="mode" data-act="start" data-mode="delivery"><span class="mi">${icon('scooter')}</span><span><b>Delivery</b><small>Garansi Tepat Waktu, dijamin</small></span></button>
          <a class="mode" href="#/reservasi"><span class="mi">${icon('calendar')}</span><span><b>Reservasi</b><small>Booking meja</small></span></a>
        </div>
      </div>

      ${IS_IOS && !IS_STANDALONE && !store.get('iosTipOff', false) ? `<div class="card ios-tip" id="ios-tip">
        <img src="assets/brand/apple-touch-icon.png" alt="">
        <span class="grow"><b>Pasang ${esc(C.storeName)} di iPhone</b><small>Ketuk ${icon('share')} lalu <b style="display:inline;font-size:12px">Tambah ke Layar Utama</b></small></span>
        <button class="icon-btn" data-act="ios-tip-off" aria-label="Tutup">${icon('x', 'sm')}</button>
      </div>` : ''}
      ${live ? `<a class="live" href="#/order/${live.id}"><span class="lv-ico pulse">${icon('coffee')}</span><span class="grow"><b>${esc(stateText(live).title)}</b><small>${esc(live.code)} · ${KIND[live.mode] || 'Pesanan'}</small></span>${icon('chevron-right', 'sm')}</a>` : ''}
      ${nextR ? `<a class="live" href="#/rsv/${nextR.id}"><span class="lv-ico" style="background:var(--sand);color:var(--ink)">${icon('calendar')}</span><span class="grow"><b>Reservasi ${esc(dateShort(nextR.date))}, ${dot(nextR.time)}</b><small>${nextR.guests} orang · ${esc(nextR.area)} · ${esc(nextR.code)}</small></span>${icon('chevron-right', 'sm')}</a>` : ''}

      <div class="sec-h"><h2>What's new</h2></div>
      <div class="hscroll carousel" id="car">
        ${BANNERS.map((b, i) => `<button class="slide" data-act="banner" data-cat="${b.cat}" aria-label="${esc(b.label)}">${pic(b.img).replace('<img ', `<img style="object-position:${b.pos}" `)}<span class="go">${esc(b.label)} ${icon('arrow-right', 'xs')}</span></button>`).join('')}
      </div>
      <div class="dots" id="car-dots">${BANNERS.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>

      <div class="sec-h"><h2>Signature</h2><a class="link" href="#/menu${C.sigCat ? '?cat=' + C.sigCat : ''}">Lihat menu ${icon('chevron-right', 'xs')}</a></div>
      <div class="hscroll sig-list">
        ${sigs.map((it) => `<div class="sig" data-act="item" data-id="${it.id}" role="button" tabindex="0">
          ${pic(it.img, it.name)}<span class="tag dark star">★ Signature</span>
          <b>${esc(it.name)}</b><span>${rp(itemPrice(it))}</span>
          ${addCtl(it).replace('class="add"', 'class="add light"')}
        </div>`).join('')}
      </div>

      <div class="sec-h"><h2>Kategori</h2><a class="link" href="#/menu">Semua menu ${icon('chevron-right', 'xs')}</a></div>
      <div class="cats">
        ${cats.map(([id, name, img]) => `<a class="cat" href="#/menu?cat=${id}">${pic(img)}<span>${name}</span></a>`).join('')}
      </div>

      <section class="story">
        <img class="logo" src="assets/brand/wordmark-light.png" alt="${esc(C.storeName)}">
        <h2>${esc(C.story.title)}</h2>
        <p>${esc(C.story.text)}</p>
        <div class="hscroll">
          ${C.storyImgs.map(([img, w]) => `<div class="ph-v" style="width:${w}px">${pic(img).replace('class="im ', 'style="height:100%" class="im ')}</div>`).join('')}
        </div>
        <a class="btn block" href="#/reservasi">${icon('calendar', 'sm')} Reservasi Meja</a>
      </section>

      <div class="sec-h"><h2>Kunjungi kami</h2></div>
      <div class="card visit">
        <iframe src="${C.mapsEmbed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Peta lokasi ${esc(C.storeName)}"></iframe>
        <div class="vi">
          <div class="info-row">${icon('map-pin', 'sm')}<span>${esc(C.address)}</span></div>
          <div class="info-row">${icon('clock', 'sm')}<span><b>Setiap hari</b> · ${dot(C.open)} – ${dot(C.close)} WIB</span></div>
          <div class="btn-row">
            <a class="btn soft" href="${C.mapsUrl}" target="_blank" rel="noopener" data-act="route">${icon('nav', 'sm')} Rute</a>
            <a class="btn soft" href="tel:+${C.phoneIntl}">${icon('phone', 'sm')} Telepon</a>
            <a class="btn soft" href="${C.instagram}" target="_blank" rel="noopener">${icon('instagram', 'sm')} Insta</a>
          </div>
        </div>
      </div>
      <div class="foot"><img src="assets/brand/lockup-dark.png" alt="${esc(C.storeName)}">${esc(C.handle)}</div>`;
    },
    mount() {
      const car = $('#car'); const dots = $$('#car-dots i');
      if (!car) return;
      const slides = $$('.slide', car);
      let idx = 0; let paused = false;
      const onScroll = () => {
        const w = slides[0].offsetWidth + 12;
        idx = Math.round(car.scrollLeft / w);
        dots.forEach((d, i) => d.classList.toggle('on', i === idx));
      };
      car.addEventListener('scroll', onScroll, { passive: true });
      car.addEventListener('touchstart', () => { paused = true; }, { passive: true });
      car.addEventListener('touchend', () => { setTimeout(() => { paused = false; }, 4000); });
      const t = setInterval(() => {
        if (paused || document.hidden || sheetStack.length) return;
        const next = (idx + 1) % slides.length;
        car.scrollTo({ left: slides[next].offsetLeft - 16, behavior: 'smooth' });
      }, 5000);
      cleanup.push(() => clearInterval(t));
    },
  };

  /* =========================================================
     SCREEN: MENU
     ========================================================= */
  let menuCtl = null;
  function menuCtx() {
    const r = activePreRsv();
    if (r) return `${icon('calendar', 'xs')}<span>Pre-order reservasi <b>${esc(dateShort(r.date))}, ${dot(r.time)}</b></span><button class="edit" data-act="cancel-pre">Batal</button>`;
    if (S.mode === 'delivery') {
      return `${icon('scooter', 'xs')}<span>Diantar <b>GoSend / GrabExpress</b>${S.addr.text.trim() ? ` ke <b>${esc(shortAddr(S.addr.text))}</b>` : ' ke alamatmu'}</span>`;
    }
    return `${icon('bag', 'xs')}<span>Ambil di <b>${esc(C.storeName)} ${esc(C.branch)}</b>, tanpa antre</span>`;
  }
  function segHTML(act) {
    const v = activePreRsv() ? 'preorder' : S.mode;
    const b = (m, ic, label) => `<button role="tab" aria-selected="${v === m}" class="${v === m ? 'on' : ''}" data-act="${act}" data-mode="${m}">${icon(ic, 'sm')} ${label}</button>`;
    return `<div class="seg" data-v="${v}" role="tablist" aria-label="Tipe pesanan">${b('pickup', 'bag', 'Pick Up')}${b('delivery', 'scooter', 'Delivery')}</div>`;
  }
  const Menu = {
    html() {
      return `
      <div class="menu-head" id="mh">
        <div class="mh-row">${segHTML('mode')}<button class="icon-btn" data-act="search" aria-label="Cari menu">${icon('search')}</button></div>
        <div class="ctx" id="ctx">${menuCtx()}</div>
        <div class="hscroll cat-chips" id="chips">
          ${MENU.map((c, i) => `<button class="chip sm ${i ? '' : 'on'}" data-act="cat" data-cat="${c.id}">${c.sig ? '★ ' : ''}${esc(c.name)}</button>`).join('')}
        </div>
      </div>
      <div class="menu-body">
        ${GROUPS.map((g) => `
          <div class="grp-h"><span>${esc(g.name)}</span></div>
          ${MENU.filter((c) => c.group === g.id).map((c) => `
            <section class="cat-sec" id="cat-${c.id}" data-cat="${c.id}">
              <h2>${esc(c.name)}${c.sig ? ` <span class="tag dark">★ Signature</span>` : ''}</h2>
              ${c.sub ? `<p>${esc(c.sub)}</p>` : ''}
              ${c.items.map(itemRow).join('')}
            </section>`).join('')}
        `).join('')}
        <p class="faint" style="font-size:12px;text-align:center;margin:26px 0 0">${C.taxRate ? `Harga sudah termasuk ${esc(C.taxLabel)}.` : esc(C.priceNote || '')}</p>
      </div>`;
    },
    mount(root, m, q) {
      const head = $('#mh'); const chips = $('#chips');
      const secs = $$('.cat-sec', root);
      let active = MENU[0].id; let lock = 0; let raf = 0;
      const hh = () => head.offsetHeight;
      const setActive = (id) => {
        active = id;
        $$('.chip', chips).forEach((c) => c.classList.toggle('on', c.dataset.cat === id));
        const on = chips.querySelector(`[data-cat="${id}"]`);
        if (on) chips.scrollTo({ left: on.offsetLeft - 16, behavior: 'smooth' });
      };
      const spy = () => {
        raf = 0;
        head.classList.toggle('shadow', scrollY > 4);
        if (Date.now() < lock) return;
        const line = hh() + 24;
        let cur = secs[0].dataset.cat;
        for (const s of secs) { if (s.getBoundingClientRect().top <= line) cur = s.dataset.cat; else break; }
        if (cur !== active) setActive(cur);
      };
      let idleT = 0;
      const onScroll = () => {
        if (lock) { clearTimeout(idleT); idleT = setTimeout(() => onEnd(), 160); }
        if (!raf) raf = requestAnimationFrame(spy);
      };
      function onEnd() { if (lock) { lock = 0; spy(); } }
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('scrollend', onEnd);
      cleanup.push(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('scrollend', onEnd); });
      menuCtl = {
        scrollTo(id, smooth = true) {
          const s = $('#cat-' + id); if (!s) return;
          lock = Date.now() + (smooth ? 1800 : 150);
          setActive(id);
          const top = s.getBoundingClientRect().top + scrollY - hh() - 4;
          window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
        },
      };
      cleanup.push(() => { menuCtl = null; });
      const cat = q.get('cat');
      if (cat) requestAnimationFrame(() => menuCtl && menuCtl.scrollTo(cat, false));
      else spy();
    },
  };
  function refreshMenuHead() {
    const seg = $('#mh .seg'); if (!seg) return;
    seg.dataset.v = S.mode;
    $$('button', seg).forEach((b) => { const on = b.dataset.mode === S.mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#ctx').innerHTML = menuCtx();
  }

  /* ---------- item detail sheet ---------- */
  function openItem(id, editKey) {
    const it = ITEMS[id]; const cat = CAT_OF[id];
    const line = editKey ? S.cart.find((l) => l.key === editKey) : null;
    const st = { qty: line ? line.qty : 1, sel: line ? clone(line.sel) : defaults(it), note: line ? line.note : '' };
    (it.opts || []).forEach((g) => { if (g.type === 'multi' && !st.sel[g.id]) st.sel[g.id] = []; else if (st.sel[g.id] == null && !g.required) st.sel[g.id] = defaults(it)[g.id]; });

    const groupHTML = (g) => {
      const v = st.sel[g.id];
      const isOn = (n) => (g.type === 'multi' ? (v || []).includes(n) : v === n);
      const prices = g.choices.map((c) => c.p || 0);
      const same = g.type === 'multi' && prices.every((p) => p === prices[0]) && prices[0] > 0;
      const tag = g.required ? '<span class="tag olive">Wajib</span>' : g.type === 'multi' ? '<span class="tag">Opsional</span>' : '<span class="tag">Pilih 1</span>';
      const head = `<div class="og-h"><b>${esc(g.name)}${same ? ` <span class="faint" style="font-weight:500;font-size:13px">· +${rp(incl(prices[0], cat))}</span>` : ''}</b>${tag}</div>`;
      if (same) {
        return `<div class="og" data-g="${g.id}">${head}<div class="opt-grid">${g.choices.map((c) => `<button class="chip sm ${isOn(c.n) ? 'on' : ''}" data-s="opt" data-g="${g.id}" data-v="${esc(c.n)}" aria-pressed="${isOn(c.n)}">${esc(c.n)}</button>`).join('')}</div></div>`;
      }
      return `<div class="og" data-g="${g.id}">${head}${g.choices.map((c) => `<button class="opt ${g.type === 'multi' ? 'multi' : ''} ${isOn(c.n) ? 'on' : ''}" data-s="opt" data-g="${g.id}" data-v="${esc(c.n)}" role="${g.type === 'multi' ? 'checkbox' : 'radio'}" aria-checked="${isOn(c.n)}"><span class="mark">${icon('check')}</span><span class="lbl">${esc(c.n)}</span>${c.p ? `<span class="op">+${rp(incl(c.p, cat))}</span>` : ''}</button>`).join('')}</div>`;
    };
    const optsHTML = () => (it.opts || []).filter((g) => visible(g, st.sel)).map(groupHTML).join('');
    const price = () => unit({ id, sel: st.sel }).p * st.qty;
    const notes = cat.notes || [];

    const sh = openSheet(`
      <div class="sheet-body">
        <button class="sheet-x" data-act="close" aria-label="Tutup">${icon('x')}</button>
        ${pic(lineImg(id, st.sel), it.name, 'pd-img', true)}
        <div class="pd-head">
          ${it.sig ? '<div class="tags"><span class="tag dark">★ Signature</span></div>' : ''}
          <h2>${esc(it.name)}</h2>
          <div class="pr">${rp(itemPrice(it))}</div>
          ${it.desc ? `<p>${esc(it.desc)}</p>` : `<p class="faint">${esc(cat.name)}${cat.sub ? ' · ' + esc(cat.sub) : ''}</p>`}
        </div>
        <div id="pd-opts">${optsHTML()}</div>
        <div class="notes bg-in">
          <b>Catatan <span class="faint" style="font-weight:400">(opsional)</span></b>
          <textarea class="textarea" id="pd-note" maxlength="120" placeholder="Contoh: ${cat.group === 'food' ? 'tidak pakai daun bawang' : 'es dipisah'}">${esc(st.note)}</textarea>
          ${notes.length ? `<div class="hscroll">${notes.map((n) => `<button class="chip sm" data-s="note" data-v="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="sheet-foot">
        <div class="qty lg"><button data-s="q-" aria-label="Kurangi">${icon('minus', 'sm')}</button><b id="pd-q">${st.qty}</b><button data-s="q+" aria-label="Tambah">${icon('plus', 'sm')}</button></div>
        <button class="btn grow" data-s="add">${line ? 'Simpan' : 'Tambah'} · <span class="price" id="pd-p">${rp(price())}</span></button>
      </div>`, { handleOnImg: !!it.img });

    const upd = () => { $('#pd-q', sh).textContent = st.qty; $('#pd-p', sh).textContent = rp(price()); };
    const noteEl = $('#pd-note', sh);
    noteEl.addEventListener('input', () => { st.note = noteEl.value; });
    sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const s = b.dataset.s;
      if (s === 'opt') {
        const g = it.opts.find((x) => x.id === b.dataset.g); const v = b.dataset.v;
        if (g.type === 'multi') { const arr = st.sel[g.id] || (st.sel[g.id] = []); const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); } else st.sel[g.id] = v;
        const body = $('.sheet-body', sh); const y = body.scrollTop;
        $('#pd-opts', sh).innerHTML = optsHTML();
        body.scrollTop = y; upd();
        const pimg = $('.pd-img img', sh); const want = IMG(lineImg(id, st.sel));
        if (pimg && !pimg.src.endsWith(want)) pimg.src = want;
      } else if (s === 'q-') { st.qty = Math.max(1, st.qty - 1); upd(); }
      else if (s === 'q+') { st.qty = Math.min(50, st.qty + 1); upd(); }
      else if (s === 'note') {
        const v = b.dataset.v; const cur = noteEl.value.trim();
        if (!cur.toLowerCase().includes(v.toLowerCase())) noteEl.value = cur ? `${cur}, ${v.toLowerCase()}` : v;
        st.note = noteEl.value; b.classList.add('on');
      } else if (s === 'add') {
        const miss = (it.opts || []).find((g) => g.required && visible(g, st.sel) && !st.sel[g.id]);
        if (miss) {
          const grp = $(`.og[data-g="${miss.id}"]`, sh);
          const body = $('.sheet-body', sh);
          body.scrollTo({ top: grp.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 70, behavior: 'smooth' });
          const tg = $('.tag', grp); tg.classList.remove('req-miss'); void tg.offsetWidth; tg.classList.add('req-miss'); tg.textContent = `Pilih ${miss.name.replace(/^Pilih /, '').toLowerCase()}`;
          return;
        }
        const sel = cleanSel(it, st.sel);
        if (line) S.cart = S.cart.filter((l) => l.key !== line.key);
        addLine(id, sel, st.note, st.qty);
        vibrate();
        closeSheet(() => {
          refreshCtl(id);
          if (parseHash().path === '/checkout') rerender(); else updateCartBar();
          const bar = $('#cartbar'); if (!bar.hidden) { bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump'); }
          toast(line ? 'Pesanan diperbarui' : `${it.name} masuk keranjang`);
        });
      }
    });
  }

  /* ---------- search sheet ---------- */
  function openSearch() {
    const prime = primeKeyboard();
    const sugg = ['Latte', 'Matcha', 'Mocktail', 'Croissant', 'Pizza', 'Fried Rice', 'Steak', 'Juice'];
    const sh = openSheet(`
      <div class="search-top">
        <label class="sbox">${icon('search', 'sm')}<span class="sr">Cari menu</span><input class="input" id="sq" type="search" placeholder="Cari kopi, matcha, pasta…" autocomplete="off" enterkeyhint="search"></label>
        <button class="btn sm soft" data-act="close">Batal</button>
      </div>
      <div class="sheet-body"><div id="sr"></div></div>`, { full: true });
    const inp = $('#sq', sh); const out = $('#sr', sh);
    const run = () => {
      const qv = inp.value.trim().toLowerCase();
      if (!qv) {
        out.innerHTML = `<div class="search-sug"><span class="eyebrow" style="width:100%;margin:4px 0">Populer dicari</span>${sugg.map((s) => `<button class="chip sm" data-q="${s}">${s}</button>`).join('')}</div>`;
        return;
      }
      const toks = qv.split(/\s+/);
      const res = Object.values(ITEMS).filter((it) => {
        const hay = `${it.name} ${it.desc || ''} ${CAT_OF[it.id].name} ${CAT_OF[it.id].sub || ''}`.toLowerCase();
        return toks.every((t) => hay.includes(t));
      });
      out.innerHTML = res.length
        ? `<div class="search-res"><p class="faint" style="font-size:12px;margin:4px 0 0">${res.length} menu ditemukan</p>${res.map(itemRow).join('')}</div>`
        : `<div class="empty"><div class="em-ico">${icon('search', 'lg')}</div><h3>Belum ketemu</h3><p>Coba kata lain, misalnya “latte” atau “nasi”.</p></div>`;
      hydrate(out);
    };
    inp.addEventListener('input', run);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    sh.addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) { inp.value = c.dataset.q; run(); } });
    run();
    focusLater(inp, prime, 380);
  }

  /* ---------- store sheet ---------- */
  function hoursTable() {
    const today = jkt().getDay();
    return `<table class="hours">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<tr class="${d === today ? 'today' : ''}"><td>${DAYS[d]}${d === today ? ' <span class="tag olive" style="margin-left:4px">Hari ini</span>' : ''}</td><td>${dot(C.open)} – ${dot(C.close)}</td></tr>`).join('')}</table>`;
  }
  function openStore() {
    const open = isOpen();
    openSheet(`
      <div class="sheet-body">
        <button class="sheet-x" data-act="close" aria-label="Tutup">${icon('x')}</button>
        ${pic(C.storeImg, '', 'pd-img').replace('class="im pd-img"', 'class="im pd-img" style="aspect-ratio:16/10"')}
        <div class="pd-head">
          <div class="tags"><span class="tag ${open ? 'olive' : 'red'}"><i class="dot"></i>${open ? 'Buka sekarang' : 'Sedang tutup'}</span></div>
          <h2>${esc(C.storeName)} ${esc(C.branch)}</h2>
          <p>${esc(C.address)}</p>
        </div>
        <div class="sheet-pad">
          <div class="btn-row" style="margin:6px 0 18px">
            <a class="btn soft" href="${C.mapsUrl}" target="_blank" rel="noopener" data-act="route">${icon('nav', 'sm')} Rute</a>
            <a class="btn soft" href="tel:+${C.phoneIntl}">${icon('phone', 'sm')} Telepon</a>
            <a class="btn soft" href="https://wa.me/${C.phoneIntl}" target="_blank" rel="noopener">${icon('chat', 'sm')} Chat</a>
          </div>
          <b style="display:block;margin-bottom:6px">Jam buka</b>
          ${hoursTable()}
          <iframe src="${C.mapsEmbed}" loading="lazy" title="Peta" style="display:block;width:100%;height:190px;border:0;border-radius:16px;margin-top:16px;background:var(--sand)"></iframe>
        </div>
      </div>`, { handleOnImg: true });
  }

  /* =========================================================
     SCREEN: CHECKOUT
     ========================================================= */
  const PAYS = [
    { id: 'qris', name: 'QRIS', sub: 'Semua e-wallet & m-banking', bg: '#1C1B19', mark: 'QRIS' },
    { id: 'gopay', name: 'GoPay', bg: '#00A5CF', mark: 'GoPay' },
    { id: 'ovo', name: 'OVO', bg: '#4C3494', mark: 'OVO' },
    { id: 'dana', name: 'DANA', bg: '#118EEA', mark: 'DANA' },
    { id: 'shopeepay', name: 'ShopeePay', bg: '#EE4D2D', mark: 'SPay' },
    { id: 'cashier', name: 'Bayar di Kasir', sub: 'Tunai, debit, atau kartu kredit', bg: '#9A6A3B', mark: 'KASIR' },
  ];
  const payOf = (id) => PAYS.find((p) => p.id === id) || PAYS[0];

  function pickupSlots() {
    const d = jkt(); const nm = minOf(d);
    const open = toMin(C.open); const last = toMin(C.lastPickup);
    const out = [];
    if (isOpen(d) && nm + C.prepMinutes <= last) out.push({ v: 'asap', t: 'Secepatnya', s: `±${C.prepMinutes} menit` });
    let start = Math.max(open + 15, Math.ceil((nm + C.prepMinutes + 10) / 15) * 15);
    for (let m = start; m <= last; m += 15) out.push({ v: hhmm(m), t: dot(hhmm(m)), s: 'Hari ini' });
    if (out.length < 4) for (let m = open + 15; m <= Math.min(last, open + 15 * 16); m += 15) out.push({ v: 'B|' + hhmm(m), t: dot(hhmm(m)), s: 'Besok' });
    return out;
  }
  const pickupLabel = (v) => (v === 'asap' ? `Secepatnya (±${C.prepMinutes} menit)` : v.startsWith('B|') ? `Besok, ${dot(v.slice(2))}` : `Hari ini, ${dot(v)}`);
  const okPhone = (p) => /^(\+?62|0)8\d{7,12}$/.test(String(p || '').replace(/[\s-]/g, ''));

  const Checkout = {
    html() {
      const back = `<header class="appbar"><button class="icon-btn" data-act="back" data-to="/menu" aria-label="Kembali">${icon('chevron-left')}</button><h1>Keranjang</h1>${S.cart.length ? `<button class="icon-btn" data-act="clear-cart" aria-label="Kosongkan keranjang">${icon('trash', 'sm')}</button>` : '<span class="spacer"></span>'}</header>`;
      if (!S.cart.length) {
        return `${back}<div class="empty" style="padding-top:70px"><div class="em-ico">${icon('bag', 'lg')}</div><h3>Keranjang masih kosong</h3><p>Yuk pilih kopi atau makanan favoritmu.</p><a class="btn" href="#/menu">Lihat Menu</a></div>`;
      }
      const t = totals(S.cart);
      const slots = pickupSlots();
      if (!slots.find((s) => s.v === S.pickup)) S.pickup = slots[0] ? slots[0].v : 'asap';
      const pre = activePreRsv();
      const kind = pre ? 'preorder' : S.mode;
      const dlv = kind === 'delivery';
      if (dlv && S.pay === 'cashier') S.pay = 'qris';
      const pays = dlv ? PAYS.filter((m) => m.id !== 'cashier') : PAYS;
      const km = dlvKm(); const cr = courierOf(S.courier); const fee = dlv ? dlvFee(cr, km) : 0;
      const far = dlv && km > DLV.maxKm;
      const open = isOpen();
      const p = S.profile;
      const closedNote = { pickup: 'Pilih jadwal ambil di bawah.', delivery: 'Pesanan delivery dikirim begitu kami buka.', preorder: 'Pre-order disiapkan menjelang jam reservasi.' }[kind];
      let typeBody;
      if (pre) {
        typeBody = `
            <div class="switch-row" style="border:0;margin-top:0;padding:0">
              <span class="lv-ico" style="width:44px;height:44px;border-radius:13px;background:var(--sand);display:grid;place-items:center">${icon('calendar')}</span>
              <div class="grow"><b>Pre-order reservasi ${esc(pre.code)}</b><small>${esc(dateShort(pre.date))}, ${dot(pre.time)} · ${pre.guests} orang — disiapkan saat kamu tiba</small></div>
              <button class="btn sm soft" data-act="cancel-pre">Batal</button>
            </div>`;
      } else if (dlv) {
        typeBody = `${segHTML('co-mode')}
            <div class="slot-lbl" style="margin-top:16px">Alamat pengantaran</div>
            <label class="field"><span class="sr">Alamat lengkap</span><textarea class="textarea" id="f-addr" data-bind="addr.text" autocomplete="street-address" placeholder="Nama jalan, nomor rumah, RT/RW, kelurahan">${esc(S.addr.text)}</textarea><span class="err-msg" hidden>Isi alamat lengkap, ya.</span></label>
            <button class="loc-btn ${S.addr.km != null ? 'ok' : ''}" data-act="locate">${icon('locate', 'sm')}<span>${S.addr.km != null ? `Lokasi terdeteksi · ±${kmLabel(S.addr.km)} dari ${esc(C.storeName)}` : 'Pakai lokasi saya untuk hitung jarak'}</span></button>
            <label class="field" style="margin-top:10px"><span class="sr">Patokan</span><input class="input" data-bind="addr.note" placeholder="Patokan untuk driver (opsional)" value="${esc(S.addr.note)}"></label>
            <div class="slot-lbl" style="margin-top:16px">Kurir</div>
            ${DLV.couriers.map((c) => `<button class="pay ${S.courier === c.id ? 'on' : ''}" data-act="courier" data-v="${c.id}" role="radio" aria-checked="${S.courier === c.id}">
              <span class="pl" style="background:${c.bg};font-size:9.5px">${c.mark}</span>
              <span class="grow"><b>${c.name}</b><small>${c.by} · tiba ±${dlvEta(km)} menit</small></span><span class="cf">${rp(dlvFee(c, km))}</span><span class="mark"></span></button>`).join('')}
            ${far ? `<div class="note-bar" style="margin:12px 0 0">${icon('info', 'sm')}<span>Lokasimu ±${kmLabel(km)} dari ${esc(C.storeName)}, di luar jangkauan pengantaran (maks ${DLV.maxKm} km). Coba Pick Up, ya.</span></div>`
              : `<div class="note-bar olive" style="margin:12px 0 0">${icon('info', 'sm')}<span>Driver ${esc(cr.by)} dipesan otomatis begitu pesananmu siap. ${S.addr.km == null ? `Sebelum lokasimu terdeteksi, ongkir dihitung untuk ±${kmLabel(DLV.defaultKm)}.` : 'Ongkir mengikuti tarif kurir saat pesanan dibuat.'}</span></div>`}`;
      } else {
        typeBody = `${segHTML('co-mode')}
            <div class="slot-lbl" style="margin-top:16px">Waktu ambil di counter pick-up</div>
            <div class="hscroll times">${slots.map((s) => `<button class="chip ${S.pickup === s.v ? 'on' : ''}" data-act="pickup" data-v="${s.v}"><span>${s.t}</span><small>${s.s}</small></button>`).join('')}</div>
            <p class="faint" style="font-size:12px;margin:10px 0 0">Tanpa antre: pesananmu langsung disiapkan, tinggal ambil di counter dengan menyebut nama atau kode pesanan.</p>
            <div class="switch-row"><div class="grow"><b>Perlu alat makan?</b><small>Sendok, garpu &amp; tisu</small></div><button class="switch ${S.cutlery ? 'on' : ''}" data-act="cutlery" role="switch" aria-checked="${S.cutlery}" aria-label="Alat makan"></button></div>`;
      }
      return `${back}
      <div class="co">
        ${!open ? `<div class="note-bar">${icon('clock', 'sm')}<span>Kami sedang tutup (buka ${dot(C.open)}–${dot(C.close)} WIB). ${closedNote}</span></div>` : ''}
        <div class="card ${dlv ? 'bg-in' : ''}">${typeBody}
        </div>

        <div class="card bg-in">
          <h3>${icon('user', 'sm')} ${dlv ? 'Data penerima' : 'Data pemesan'}</h3>
          <div class="form-grid">
            <label class="field"><span>${dlv ? 'Nama penerima' : 'Nama <em>— dipanggil saat pesanan siap</em>'}</span><input class="input" id="f-name" data-bind="name" autocomplete="name" placeholder="Nama kamu" value="${esc(p.name)}"><span class="err-msg" hidden>Isi nama kamu.</span></label>
            <label class="field"><span>No. WhatsApp ${pre ? '<em>(opsional)</em>' : dlv ? '<em>— dihubungi driver</em>' : ''}</span><input class="input" id="f-phone" data-bind="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx" value="${esc(p.phone)}"><span class="err-msg" hidden>Nomor WhatsApp belum valid.</span></label>
          </div>
        </div>

        <div class="card">
          <h3>${icon('receipt', 'sm')} Pesanan <span class="tag">${t.count} item</span></h3>
          ${S.cart.map((l) => {
            const it = ITEMS[l.id]; const u = unit(l); const sm = summary(l);
            return `<div class="ci">
              ${pic(lineImg(l.id, l.sel), it.name)}
              <div><b>${esc(it.name)}</b>${sm ? `<small>${esc(sm)}</small>` : ''}${l.note ? `<small>“${esc(l.note)}”</small>` : ''}<button class="edit-l" data-act="edit-line" data-key="${esc(l.key)}">Ubah</button></div>
              <div class="ci-r"><span class="pr">${rp(u.p * l.qty)}</span><span class="qty"><button data-act="line-dec" data-key="${esc(l.key)}" aria-label="Kurangi">${l.qty > 1 ? icon('minus', 'sm') : icon('trash', 'xs')}</button><b>${l.qty}</b><button data-act="line-inc" data-key="${esc(l.key)}" aria-label="Tambah">${icon('plus', 'sm')}</button></span></div>
            </div>`;
          }).join('')}
          <a class="add-more" href="#/menu">${icon('plus', 'sm')} Tambah menu lain</a>
        </div>

        <div class="card">
          <h3>${icon('wallet', 'sm')} Metode pembayaran</h3>
          ${pays.map((m) => `<button class="pay ${S.pay === m.id ? 'on' : ''}" data-act="pay" data-v="${m.id}" role="radio" aria-checked="${S.pay === m.id}">
            <span class="pl" style="background:${m.bg}">${m.mark}</span>
            <span class="grow"><b>${m.name}</b>${m.sub ? `<small>${m.sub}</small>` : ''}</span><span class="mark"></span></button>`).join('')}
          ${dlv ? '<p class="faint" style="font-size:12px;margin:8px 0 0">Delivery dibayar online, termasuk ongkir.</p>' : ''}
        </div>

        <div class="card">
          <h3>Ringkasan pembayaran</h3>
          <div class="sum-row"><span>Harga (${t.count} item)</span><span>${rp(t.total)}</span></div>
          ${C.taxRate ? `<div class="sum-row"><span>Termasuk ${esc(C.taxLabel)}</span><span>${rp(t.tax)}</span></div>` : ''}
          ${dlv ? `<div class="sum-row"><span>Ongkir ${esc(cr.name)} (±${kmLabel(km)})</span><span>${rp(fee)}</span></div>` : ''}
          <div class="sum-row total"><span>Total</span><span>${rp(t.total + fee)}</span></div>
        </div>
      </div>
      <div class="paybar">
        <div class="pb-t"><small>Total bayar</small><b>${rp(t.total + fee)}</b></div>
        <button class="btn ${far ? 'dis' : ''}" data-act="place">${S.pay === 'cashier' ? 'Pesan Sekarang' : 'Pesan & Bayar'}</button>
      </div>`;
    },
  };

  function placeOrder() {
    const pre = activePreRsv();
    const kind = pre ? 'preorder' : S.mode;
    const p = S.profile;
    const errs = [];
    if (kind === 'delivery') {
      const a = $('#f-addr');
      if ((S.addr.text || '').trim().length < 8) { a.classList.add('err'); a.nextElementSibling.hidden = false; errs.push(a); }
    }
    const nm = $('#f-name'); const ph = $('#f-phone');
    if ((p.name || '').trim().length < 2) { nm.classList.add('err'); nm.nextElementSibling.hidden = false; errs.push(nm); }
    if ((kind !== 'preorder' || p.phone) && !okPhone(p.phone)) { ph.classList.add('err'); ph.nextElementSibling.hidden = false; errs.push(ph); }
    if (errs.length) { errs[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Lengkapi data dulu, ya', 'info'); return; }
    if (kind === 'delivery' && dlvKm() > DLV.maxKm) { toast(`Di luar jangkauan pengantaran (maks ${DLV.maxKm} km)`, 'info'); return; }
    save('profile', 'addr');

    const t = totals(S.cart);
    const day = ymd(jkt());
    const qn = store.get('queue', { day: '', n: 0 });
    if (qn.day !== day) { qn.day = day; qn.n = 0; }
    qn.n += 1; store.set('queue', qn);
    const km = dlvKm(); const cr = courierOf(S.courier);
    const fee = kind === 'delivery' ? dlvFee(cr, km) : 0;
    const o = {
      id: uid(), code: (C.orderPrefix || 'MG-') + rand4(), queue: String(qn.n).padStart(3, '0'), createdAt: Date.now(),
      mode: kind, rsvId: pre ? pre.id : null, rsvCode: pre ? pre.code : null,
      rsvAt: pre ? rsvEpoch(pre) : null,
      pickupAt: kind === 'pickup' && S.pickup !== 'asap'
        ? rsvEpoch({ date: ymd(addDays(jkt(), S.pickup.startsWith('B|') ? 1 : 0)), time: S.pickup.replace('B|', '') }) : null,
      pickup: kind === 'pickup' ? S.pickup : null, cutlery: kind === 'pickup' ? S.cutlery : false,
      dlv: kind === 'delivery' ? {
        addr: S.addr.text.trim(), note: (S.addr.note || '').trim(), km, located: S.addr.km != null,
        courier: cr.id, courierName: cr.name, by: cr.by, fee, eta: dlvEta(km), driver: pickDriver(),
      } : null,
      name: p.name.trim(), phone: p.phone.trim(), pay: kind === 'delivery' && S.pay === 'cashier' ? 'qris' : S.pay, paid: false, paidAt: null, doneAt: null,
      lines: S.cart.map((l) => ({ id: l.id, name: ITEMS[l.id].name, img: lineImg(l.id, l.sel), qty: l.qty, sel: l.sel, note: l.note, sum: summary(l), unit: unit(l).p })),
      sub: t.total, total: t.total + fee, tax: t.tax, count: t.count,
    };
    S.orders.unshift(o); save('orders');
    if (pre) { pre.orderId = o.id; save('rsvs'); S.preRsv = null; save('preRsv'); }
    S.cart = []; save('cart');
    processing(kind === 'delivery' ? 'Mengirim pesanan & memesan kurir…' : 'Mengirim pesanan…', 1000).then(() => {
      replace('/order/' + o.id);
      if (o.pay !== 'cashier') setTimeout(() => openPayment(o), 450);
      else toast('Pesanan terkirim!');
    });
  }

  /* ---------- payment sheet (simulasi — hubungkan ke payment gateway) ---------- */
  function drawQR(cv, seed) {
    const n = 29; const s = Math.floor(cv.width / n); const ctx = cv.getContext('2d');
    let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h / 4294967296; };
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#1C1B19';
    const inF = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (inF(x, y) || (Math.abs(x - 14) < 4 && Math.abs(y - 14) < 4)) continue;
      if (rnd() > 0.5) ctx.fillRect(x * s, y * s, s, s);
    }
    const finder = (x, y) => {
      ctx.fillStyle = '#1C1B19'; ctx.fillRect(x * s, y * s, 7 * s, 7 * s);
      ctx.fillStyle = '#fff'; ctx.fillRect((x + 1) * s, (y + 1) * s, 5 * s, 5 * s);
      ctx.fillStyle = '#1C1B19'; ctx.fillRect((x + 2) * s, (y + 2) * s, 3 * s, 3 * s);
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  }
  function openPayment(o) {
    const m = payOf(o.pay);
    if (!o.expiresAt || o.expiresAt < Date.now()) { o.expiresAt = Date.now() + 10 * 60e3; save('orders'); }
    let timer = null;
    const sh = openSheet(`
      <div class="sheet-body">
        <div class="sheet-head" style="text-align:center"><h2>Selesaikan pembayaran</h2><p>Scan QR di bawah lewat ${o.pay === 'qris' ? 'e-wallet atau m-banking apa pun' : 'aplikasi ' + m.name}.</p></div>
        <div class="sheet-pad" style="text-align:center">
          <span class="timer">${icon('clock', 'xs')} Bayar dalam <span id="pt">10:00</span></span>
          <div class="qr-wrap" style="margin-top:14px"><canvas id="qr" width="232" height="232" aria-label="Kode QR pembayaran"></canvas><span class="qr-logo"><img src="assets/brand/stacked-dark.png" alt=""></span></div>
          <div style="margin-top:14px"><small class="faint">Total pembayaran · ${esc(o.code)}</small><div style="font-size:26px;font-weight:700;letter-spacing:-.01em">${rp(o.total)}</div></div>
          <ol class="steps-ol" style="text-align:left">
            <li>Buka aplikasi ${o.pay === 'qris' ? 'e-wallet / m-banking' : m.name} lalu pilih Scan / Bayar.</li>
            <li>Scan QR di atas (atau screenshot &amp; upload dari galeri).</li>
            <li>Pastikan nominal ${rp(o.total)} lalu konfirmasi.</li>
          </ol>
          <div class="note-bar" style="margin:14px 0 0;text-align:left">${icon('info', 'sm')}<span><b>Prototipe:</b> QR ini hanya simulasi. Jangan dipindai untuk membayar.</span></div>
        </div>
      </div>
      <div class="sheet-foot" style="flex-direction:column;align-items:stretch">
        <button class="btn block" data-s="paid">Saya sudah bayar</button>
        ${o.mode === 'delivery' ? '' : '<button class="btn block soft" data-s="cashier" style="height:44px">Bayar di kasir saja</button>'}
      </div>`, { onClose: () => clearInterval(timer) });
    drawQR($('#qr', sh), o.code);
    const pt = $('#pt', sh);
    const tick = () => {
      const s = Math.max(0, Math.round((o.expiresAt - Date.now()) / 1000));
      pt.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      if (!s) { clearInterval(timer); o.expiresAt = Date.now() + 10 * 60e3; save('orders'); drawQR($('#qr', sh), o.code + Date.now()); timer = setInterval(tick, 1000); }
    };
    tick(); timer = setInterval(tick, 1000);
    sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      if (b.dataset.s === 'paid') {
        processing('Memeriksa pembayaran…', 1400).then(() => {
          o.paid = true; o.paidAt = Date.now(); save('orders');
          closeSheet(() => { rerender(); toast('Pembayaran berhasil'); });
        });
      } else {
        o.pay = 'cashier'; save('orders');
        closeSheet(() => { rerender(); toast('Silakan bayar di kasir', 'banknote'); });
      }
    });
  }

  /* =========================================================
     ORDER STATUS
     ========================================================= */
  function rsvEpoch(r) {
    const [y, mo, d] = r.date.split('-').map(Number); const [h, mi] = r.time.split(':').map(Number);
    return Date.UTC(y, mo - 1, d, h - 7, mi); // WIB = UTC+7
  }
  function orderState(o) {
    const online = o.pay !== 'cashier';
    if (online && !o.paid) return { step: -1 };
    if (o.doneAt) return { step: 3 };
    let start = online ? o.paidAt : o.createdAt;
    if (o.rsvAt) start = Math.max(start, o.rsvAt - 15 * 60e3);
    if (o.pickupAt) start = Math.max(start, o.pickupAt - C.prepMinutes * 60e3);
    const t = (Date.now() - start) / 1000;
    if (t < 0) return { step: 0, scheduled: true };
    if (t > 90 * 60) return { step: 3 };
    return { step: t < DEMO_STATUS_SECONDS[0] ? 0 : t < DEMO_STATUS_SECONDS[1] ? 1 : 2 };
  }
  function stateText(o) {
    const st = orderState(o); const dl = o.dlv;
    switch (st.step) {
      case -1: return { title: 'Menunggu pembayaran', sub: 'Selesaikan pembayaran agar pesananmu segera kami siapkan.' };
      case 0: return st.scheduled
        ? (o.rsvCode
          ? { title: 'Pre-order terjadwal', sub: 'Pesananmu akan disiapkan menjelang jam reservasi.' }
          : { title: 'Pesanan terjadwal', sub: `Pesananmu akan disiapkan menjelang jam ambil (${pickupLabel(o.pickup)}).` })
        : { title: 'Pesanan diterima', sub: 'Barista kami sudah menerima pesananmu.' };
      case 1: return dl
        ? { title: 'Sedang disiapkan', sub: `Pesananmu sedang dibuat. Driver ${dl.by} dipesan otomatis begitu pesanan siap.` }
        : { title: 'Sedang disiapkan', sub: 'Pesananmu sedang dibuat dengan sepenuh hati.' };
      case 2:
        if (dl) return { title: 'Sedang diantar', sub: `${dl.driver.name} (${dl.courierName}) sedang menuju alamatmu. Estimasi tiba ±${Math.max(5, Math.ceil(dl.km * 3))} menit.` };
        if (isPickup(o)) return { title: 'Siap diambil', sub: `Langsung ambil di counter pick-up tanpa antre. Sebutkan nama “${o.name}” atau kode ${o.code}.` };
        return { title: 'Siap disajikan', sub: `Pesanan sedang diantar ke ${o.rsvCode ? 'mejamu saat kamu tiba' : 'Meja ' + o.table}.` };
      default: return dl
        ? { title: 'Pesanan tiba', sub: `Terima kasih sudah memesan di ${C.storeName}. Selamat menikmati!` }
        : { title: 'Selesai', sub: `Terima kasih sudah mampir. Sampai jumpa lagi di ${C.storeName}.` };
    }
  }
  const payLabel = (o) => {
    const m = payOf(o.pay);
    if (o.pay === 'cashier') return 'Bayar di kasir';
    return `${m.name} · ${o.paid ? 'Lunas' : 'Belum dibayar'}`;
  };
  function orderMsg(o) {
    const dl = o.dlv;
    const type = dl ? `Delivery · ${dl.courierName} (±${kmLabel(dl.km)})`
      : isPickup(o) ? `Pick Up · ${pickupLabel(o.pickup)}${o.cutlery ? ' · perlu alat makan' : ''}`
        : o.rsvCode ? `Pre-order reservasi ${o.rsvCode}` : `Dine In · Meja ${o.table}`;
    return [
      `Halo ${C.storeName}, saya pesan lewat website:`, '',
      `*${o.code}* (antrean ${o.queue})`,
      `Tipe: ${type}`,
      `Nama: ${o.name}${o.phone ? ' · ' + o.phone : ''}`,
      ...(dl ? [`Alamat: ${dl.addr}${dl.note ? ' (' + dl.note + ')' : ''}`] : []), '',
      ...o.lines.map((l) => `${l.qty}x ${l.name}${l.sum ? ' (' + l.sum + ')' : ''}${l.note ? ' — "' + l.note + '"' : ''}`), '',
      ...(dl ? [`Subtotal: ${rp(o.sub)}`, `Ongkir: ${rp(dl.fee)}`] : []),
      `Total: ${rp(o.total)}`,
      `Pembayaran: ${payLabel(o)}`,
    ].join('\n');
  }
  const waLink = (text) => `https://wa.me/${C.phoneIntl}?text=${encodeURIComponent(text)}`;
  const cupSVG = (done) => `
    <svg class="cup-ill ${done ? 'done' : ''}" viewBox="0 0 120 120" aria-hidden="true">
      <g class="steam"><path d="M47 34c-5-6 5-10 0-17"/><path d="M60 34c-5-6 5-10 0-17"/><path d="M73 34c-5-6 5-10 0-17"/></g>
      <path d="M28 44h62v24a26 26 0 0 1-26 26h-10a26 26 0 0 1-26-26Z" fill="#fff" stroke="#1C1B19" stroke-width="2.5"/>
      <path d="M90 52h5a10 10 0 0 1 0 20h-7" fill="none" stroke="#1C1B19" stroke-width="2.5"/>
      <path d="M20 102h80" stroke="#1C1B19" stroke-width="2.5" stroke-linecap="round"/>
      ${done ? '<circle cx="86" cy="36" r="13" fill="#4A6538"/><path d="m80 36 4.2 4.2L92.5 31.8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : ''}
      <text x="59" y="74" text-anchor="middle" font-family="Poppins, sans-serif" font-weight="700" font-size="13" fill="#1C1B19">${esc(C.cupMark || 'm.')}</text>
    </svg>`;

  const OrderView = {
    html(m) {
      const o = S.orders.find((x) => x.id === m[1]);
      const bar = `<header class="appbar"><button class="icon-btn" data-act="back" data-to="/pesanan" aria-label="Kembali">${icon('chevron-left')}</button><h1>Status Pesanan</h1><span class="spacer"></span></header>`;
      if (!o) return `${bar}<div class="empty"><h3>Pesanan tidak ditemukan</h3><a class="btn" href="#/pesanan">Lihat pesanan</a></div>`;
      const st = orderState(o); const tx = stateText(o); const dl = o.dlv; const pu = isPickup(o);
      const labels = dl ? ['Pesanan diterima', 'Sedang disiapkan', 'Diantar driver', 'Tiba di tujuan']
        : ['Pesanan diterima', 'Sedang disiapkan', pu ? 'Siap diambil' : 'Disajikan di meja', 'Selesai'];
      const subs = [clock(o.paidAt || o.createdAt), dl ? `Barista & dapur · kurir ${dl.by} dipesan` : 'Barista & dapur',
        dl ? dl.courierName : pu ? 'Counter pick-up · tanpa antre' : (o.rsvCode ? 'Saat kamu tiba' : 'Meja ' + o.table), dl ? shortAddr(dl.addr) : ''];
      const driverCard = dl && st.step >= 1 ? `<div class="card driver">${st.step === 1
        ? `<span class="dv-av pulse">${icon('scooter')}</span><span class="grow"><b>Memesan driver ${esc(dl.by)}…</b><small>${esc(dl.courierName)} · otomatis saat pesanan siap</small></span>`
        : `<span class="dv-av">${esc(dl.driver.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span><span class="grow"><b>${esc(dl.driver.name)}</b><small>${esc(dl.driver.plate)} · ${esc(dl.driver.bike)}</small><small>${esc(dl.courierName)}</small></span><button class="icon-btn" data-act="driver" data-by="${esc(dl.by)}" aria-label="Hubungi driver">${icon('chat', 'sm')}</button>`}</div>
        <p class="proto-note">Prototipe: data driver masih simulasi. Di versi final, pesanan diteruskan ke API ${esc(dl.courierName)} dan driver serta lokasinya tampil langsung di sini.</p>` : '';
      return `${bar}
      <div class="track-hero">${cupSVG(st.step >= 2)}<h1 id="st-title">${esc(tx.title)}</h1><p>${esc(tx.sub)}</p></div>
      ${st.step === -1 ? `<div class="pad" style="margin-top:14px"><button class="btn block" data-act="pay-now" data-id="${o.id}">${icon('qr', 'sm')} Bayar sekarang · ${rp(o.total)}</button></div>` : ''}
      <div class="card queue"><div><small>No. antrean</small><b>${esc(o.queue)}</b></div><i></i><div><small>Kode pesanan</small><b class="code">${esc(o.code)}</b></div></div>
      ${driverCard}
      ${st.step >= 0 ? `<div class="card tl">${labels.map((l, i) => `<div class="tl-s ${i < st.step || st.step === 3 ? 'done' : i === st.step ? 'cur' : ''}"><span class="dot">${i < st.step || st.step === 3 ? icon('check', 'xs') : ''}</span><div><b>${l}</b>${subs[i] ? `<small>${esc(subs[i])}</small>` : ''}</div></div>`).join('')}</div>` : ''}
      <div class="card receipt">
        <div class="rc-h"><b>Detail pesanan</b><span class="tag ${pu || dl ? 'olive' : ''}">${KIND[o.mode] || 'Pesanan'}</span></div>
        <div class="kv"><span>Waktu pesan</span><span>${esc(stampLabel(o.createdAt))}</span></div>
        ${dl ? `<div class="kv"><span>Alamat</span><span>${esc(dl.addr)}</span></div>${dl.note ? `<div class="kv"><span>Patokan</span><span>${esc(dl.note)}</span></div>` : ''}<div class="kv"><span>Kurir</span><span>${esc(dl.courierName)} · ±${kmLabel(dl.km)}</span></div>`
          : pu ? `<div class="kv"><span>Ambil</span><span>${esc(pickupLabel(o.pickup))}</span></div>${o.cutlery ? '<div class="kv"><span>Alat makan</span><span>Ya</span></div>' : ''}`
            : `<div class="kv"><span>${o.rsvCode ? 'Reservasi' : 'Meja'}</span><span>${o.rsvCode ? esc(o.rsvCode) : 'No. ' + esc(o.table)}</span></div>`}
        <div class="kv"><span>Nama</span><span>${esc(o.name)}</span></div>
        <div class="kv"><span>Pembayaran</span><span>${esc(payLabel(o))}</span></div>
        <div class="rc-sep"></div>
        ${o.lines.map((l) => `<div class="rc-line"><span class="q">${l.qty}x</span><span class="n">${esc(l.name)}${l.sum ? `<small>${esc(l.sum)}</small>` : ''}${l.note ? `<small>“${esc(l.note)}”</small>` : ''}</span><span>${rp(l.unit * l.qty)}</span></div>`).join('')}
        <div class="rc-sep"></div>
        ${dl ? `<div class="kv"><span>Subtotal</span><span>${rp(o.sub)}</span></div><div class="kv"><span>Ongkir ${esc(dl.courierName)}</span><span>${rp(dl.fee)}</span></div>` : ''}
        ${C.taxRate ? `<div class="kv"><span>Termasuk ${esc(C.taxLabel)}</span><span>${rp(o.tax)}</span></div>` : ''}
        <div class="kv" style="font-size:16px"><span style="color:var(--ink);font-weight:600">Total</span><span style="font-weight:700">${rp(o.total)}</span></div>
      </div>
      <div class="actions ${st.step === 2 ? '' : 'two'}" style="padding-bottom:calc(28px + var(--safe-b))">
        ${st.step === 2 ? `<button class="btn olive block" data-act="received" data-id="${o.id}">${icon('check', 'sm')} Pesanan sudah ${pu ? 'diambil' : 'diterima'}</button><div class="actions two" style="margin:0">` : ''}
        <a class="btn ghost" href="${waLink(orderMsg(o))}" target="_blank" rel="noopener">${icon('chat', 'sm')} WhatsApp</a>
        <button class="btn soft" data-act="reorder" data-id="${o.id}">${icon('rotate', 'sm')} Pesan lagi</button>
        ${st.step === 2 ? '</div>' : ''}
      </div>`;
    },
    mount(root, m) {
      const o = S.orders.find((x) => x.id === m[1]); if (!o) return;
      let last = orderState(o).step;
      const t = setInterval(() => {
        const s = orderState(o).step;
        if (s !== last && !sheetStack.length) { last = s; rerender(); if (s === 2) { vibrate(); toast(o.dlv ? 'Pesananmu sedang diantar driver' : isPickup(o) ? 'Pesananmu siap diambil!' : 'Pesananmu siap disajikan', o.dlv ? 'scooter' : 'coffee'); } }
      }, 1000);
      cleanup.push(() => clearInterval(t));
    },
  };

  /* =========================================================
     SCREEN: RESERVASI
     ========================================================= */
  const AREAS = C.areas;
  const OCCASIONS = ['Nongkrong', 'Kerja / Meeting', 'Ulang Tahun', 'Keluarga', 'Date', 'Lainnya'];
  function rsvSlots(date) {
    const d = jkt(); const isToday = date === ymd(d);
    const minOk = isToday ? minOf(d) + 60 : 0;
    const out = [];
    for (let m = toMin(C.rsvFirst); m <= toMin(C.rsvLast); m += 30) out.push({ m, v: hhmm(m), off: m < minOk });
    return out;
  }
  function rsvDates() {
    const d = jkt(); const out = [];
    for (let i = 0; i < 21 && out.length < 14; i++) {
      const x = ymd(addDays(d, i));
      if (rsvSlots(x).some((s) => !s.off)) out.push(x);
    }
    return out;
  }
  function draft() {
    const dates = rsvDates();
    if (!S.rd) S.rd = { date: dates[0], time: null, guests: 2, area: 'Indoor', occ: '', note: '' };
    if (!dates.includes(S.rd.date)) { S.rd.date = dates[0]; S.rd.time = null; }
    if (S.rd.time && (rsvSlots(S.rd.date).find((s) => s.v === S.rd.time) || { off: true }).off) S.rd.time = null;
    return S.rd;
  }
  const rsvState = (r) => (r.status === 'cancelled' ? 'cancelled' : rsvEpoch(r) + 2 * 3600e3 < Date.now() ? 'past' : 'upcoming');

  const Reservasi = {
    html() {
      const rd = draft(); const p = S.profile; const dates = rsvDates();
      const slots = rsvSlots(rd.date);
      const parts = [['Siang', (m) => m < 15 * 60], ['Sore', (m) => m >= 15 * 60 && m < 18 * 60], ['Malam', (m) => m >= 18 * 60]];
      const today = ymd(jkt()); const tmr = ymd(addDays(jkt(), 1));
      return `
      <section class="rsv-hero">
        ${pic(C.rsvImg)}
        <div class="rh-in"><img src="assets/brand/wordmark-light.png" alt="${esc(C.storeName)}"><h1>Reservasi Meja</h1><p>Amankan tempatmu untuk ngobrol panjang, meeting, atau momen spesial.</p></div>
      </section>
      <div class="rsv-body">
        <div class="card">
          <h3><span class="n">1</span> Pilih tanggal</h3>
          <div class="hscroll dates" id="dates">${dates.map((x) => { const dd = parseYmd(x); return `<button class="date ${x === rd.date ? 'on' : ''}" data-act="rsv-date" data-v="${x}" aria-pressed="${x === rd.date}"><small>${x === today ? 'Hari ini' : x === tmr ? 'Besok' : DAYS_S[dd.getDay()]}</small><b>${dd.getDate()}</b><small>${MONTHS_S[dd.getMonth()]}</small></button>`; }).join('')}</div>
        </div>
        <div class="card">
          <h3><span class="n">2</span> Pilih jam <span class="faint" style="font-weight:400;font-size:12.5px;margin-left:auto">${esc(dateShort(rd.date))}</span></h3>
          ${parts.map(([lbl, f]) => { const ss = slots.filter((s) => f(s.m)); return ss.length ? `<div class="slot-lbl">${lbl}</div><div class="slots">${ss.map((s) => `<button class="chip ${rd.time === s.v ? 'on' : ''}" data-act="rsv-time" data-v="${s.v}" ${s.off ? 'disabled' : ''}>${dot(s.v)}</button>`).join('')}</div>` : ''; }).join('')}
        </div>
        <div class="card">
          <h3><span class="n">3</span> Jumlah tamu</h3>
          <div class="guests">
            <span class="qty lg"><button data-act="rsv-g" data-d="-1" aria-label="Kurangi tamu">${icon('minus', 'sm')}</button><b>${rd.guests}</b><button data-act="rsv-g" data-d="1" aria-label="Tambah tamu">${icon('plus', 'sm')}</button></span>
            <div class="g-txt"><b>${rd.guests} orang</b><small>${rd.guests >= 12 ? 'Rombongan besar — tim kami akan menghubungi untuk detail.' : `Maksimal ${C.maxGuests} orang per reservasi`}</small></div>
          </div>
        </div>
        <div class="card">
          <h3><span class="n">4</span> Preferensi area</h3>
          <div class="areas">${AREAS.map((a) => `<button class="area ${rd.area === a.v ? 'on' : ''}" data-act="rsv-area" data-v="${a.v}" aria-pressed="${rd.area === a.v}">${pic(a.img, a.v)}<span>${a.v}<small>${a.sub}</small></span></button>`).join('')}</div>
          <div class="slot-lbl" style="margin-top:16px">Acara <span style="font-weight:400">(opsional)</span></div>
          <div class="occ">${OCCASIONS.map((o) => `<button class="chip sm ${rd.occ === o ? 'on' : ''}" data-act="rsv-occ" data-v="${o}">${o}</button>`).join('')}</div>
        </div>
        <div class="card bg-in">
          <h3><span class="n">5</span> Data pemesan</h3>
          <div class="form-grid">
            <label class="field"><span>Nama lengkap</span><input class="input" id="r-name" data-bind="name" autocomplete="name" placeholder="Nama kamu" value="${esc(p.name)}"><span class="err-msg" hidden>Isi nama kamu.</span></label>
            <label class="field"><span>No. WhatsApp</span><input class="input" id="r-phone" data-bind="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx" value="${esc(p.phone)}"><span class="err-msg" hidden>Nomor WhatsApp belum valid.</span></label>
            <label class="field"><span>Catatan <em>(opsional)</em></span><textarea class="textarea" data-bind="rd.note" maxlength="200" placeholder="Contoh: dekat stopkontak, kursi bayi, dekorasi ulang tahun">${esc(rd.note)}</textarea></label>
          </div>
        </div>
        <p class="faint" style="font-size:12px;text-align:center;margin:16px 12px 0">Reservasi dikonfirmasi oleh tim ${esc(C.storeName)} melalui WhatsApp.</p>
      </div>
      <div class="paybar">
        <div class="pb-t grow" style="min-width:0"><small>${rd.time ? `${esc(dateShort(rd.date))} · ${dot(rd.time)} WIB` : 'Pilih jam kedatangan'}</small><b style="font-size:15px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rd.guests} orang · ${esc(rd.area)}</b></div>
        <button class="btn" style="flex:none;padding:0 26px" data-act="rsv-next" ${rd.time ? '' : 'disabled'}>Lanjut ${icon('arrow-right', 'sm')}</button>
      </div>`;
    },
    mount() {
      const on = $('#dates .date.on');
      if (on) $('#dates').scrollLeft = on.offsetLeft - 16;
    },
  };

  function rsvNext() {
    const rd = draft(); const p = S.profile;
    const nm = $('#r-name'); const ph = $('#r-phone'); const errs = [];
    if ((p.name || '').trim().length < 2) { nm.classList.add('err'); nm.nextElementSibling.hidden = false; errs.push(nm); }
    if (!okPhone(p.phone)) { ph.classList.add('err'); ph.nextElementSibling.hidden = false; errs.push(ph); }
    if (errs.length) { errs[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Lengkapi data pemesan dulu', 'info'); return; }
    save('profile', 'rd');
    const sh = openSheet(`
      <div class="sheet-body">
        <div class="sheet-head"><h2>Konfirmasi reservasi</h2><p>Pastikan detail berikut sudah benar.</p></div>
        <div class="sheet-pad">
          <div class="kv"><span>Tanggal</span><span>${esc(dateLong(rd.date))}</span></div>
          <div class="kv"><span>Jam</span><span>${dot(rd.time)} WIB</span></div>
          <div class="kv"><span>Jumlah tamu</span><span>${rd.guests} orang</span></div>
          <div class="kv"><span>Area</span><span>${esc(rd.area)}</span></div>
          ${rd.occ ? `<div class="kv"><span>Acara</span><span>${esc(rd.occ)}</span></div>` : ''}
          <div class="kv"><span>Atas nama</span><span>${esc(p.name)}</span></div>
          <div class="kv"><span>WhatsApp</span><span>${esc(p.phone)}</span></div>
          ${rd.note ? `<div class="kv"><span>Catatan</span><span>${esc(rd.note)}</span></div>` : ''}
          <div class="note-bar olive" style="margin:16px 0 0">${icon('info', 'sm')}<span>Setelah ini, kirim konfirmasi via WhatsApp agar tim kami bisa memastikan mejamu.</span></div>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn soft" data-act="close">Ubah</button><button class="btn grow" data-s="ok">Konfirmasi Reservasi</button></div>`);
    $('[data-s="ok"]', sh).addEventListener('click', () => {
      const r = { id: uid(), code: 'RSV-' + rand4(), date: rd.date, time: rd.time, guests: rd.guests, area: rd.area, occ: rd.occ, note: (rd.note || '').trim(), name: p.name.trim(), phone: p.phone.trim(), status: 'pending', createdAt: Date.now() };
      S.rsvs.unshift(r); save('rsvs');
      S.rd = { ...rd, time: null, note: '', occ: '' }; save('rd');
      processing('Menyimpan reservasi…', 900).then(() => closeSheet(() => { go('/rsv/' + r.id); setTimeout(() => toast('Reservasi tercatat!'), 300); }));
    });
  }
  function rsvMsg(r) {
    return [
      `Halo ${C.storeName}, saya ingin reservasi meja:`, '',
      `Kode: *${r.code}*`,
      `Nama: ${r.name}`,
      `Tanggal: ${dateLong(r.date)}`,
      `Jam: ${dot(r.time)} WIB`,
      `Jumlah tamu: ${r.guests} orang`,
      `Area: ${r.area}`,
      r.occ ? `Acara: ${r.occ}` : null,
      r.note ? `Catatan: ${r.note}` : null,
      '', 'Mohon konfirmasinya. Terima kasih!',
    ].filter((x) => x !== null).join('\n');
  }
  function downloadICS(r) {
    const f = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = rsvEpoch(r);
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${C.icsDomain}//reservasi//ID`, 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${r.id}@${C.icsDomain}`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(start)}`, `DTEND:${f(start + 2 * 3600e3)}`,
      `SUMMARY:Reservasi ${C.storeName} (${r.guests} orang)`, `LOCATION:${C.address.replace(/,/g, '\\,')}`,
      `DESCRIPTION:Kode reservasi ${r.code} · Area ${r.area}`, 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:Reservasi ${C.storeName}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    if (IS_IOS) {
      // Safari iOS menampilkan lembar "Tambah ke Kalender" untuk data text/calendar
      const data = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(body);
      if (IS_STANDALONE) window.open(data, '_blank'); else window.location.href = data;
      return;
    }
    const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = `reservasi-${C.icsDomain}-${r.code}.ics`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const RsvView = {
    html(m) {
      const r = getRsv(m[1]);
      const bar = `<header class="appbar"><button class="icon-btn" data-act="back" data-to="/pesanan?tab=rsv" aria-label="Kembali">${icon('chevron-left')}</button><h1>Reservasi</h1><span class="spacer"></span></header>`;
      if (!r) return `${bar}<div class="empty"><h3>Reservasi tidak ditemukan</h3><a class="btn" href="#/reservasi">Buat reservasi</a></div>`;
      const st = rsvState(r);
      const tag = st === 'cancelled' ? '<span class="tag red">Dibatalkan</span>' : st === 'past' ? '<span class="tag">Selesai</span>' : '<span class="tag warn">Menunggu konfirmasi</span>';
      const o = r.orderId && S.orders.find((x) => x.id === r.orderId);
      return `${bar}
      <div class="ticket">
        <div class="tk-top">
          <img src="assets/brand/wordmark-light.png" alt="${esc(C.storeName)}">${tag}
          <h2>${esc(dateLong(r.date).replace(/ \d{4}$/, ''))}</h2>
          <p>${dot(r.time)} WIB · ${r.guests} orang · ${esc(r.area)}</p>
        </div>
        <div class="tk-cut"><i></i></div>
        <div class="tk-grid">
          <div><small>Atas nama</small><b>${esc(r.name)}</b></div>
          <div><small>WhatsApp</small><b>${esc(r.phone)}</b></div>
          <div><small>Area</small><b>${esc(r.area)}</b></div>
          <div><small>Acara</small><b>${esc(r.occ || '—')}</b></div>
          ${r.note ? `<div style="grid-column:1/-1"><small>Catatan</small><b style="font-weight:500">${esc(r.note)}</b></div>` : ''}
        </div>
        <div class="tk-code"><span><small class="faint" style="display:block;font-size:11.5px">Kode reservasi</small><b>${esc(r.code)}</b></span><button class="icon-btn" data-act="copy" data-v="${esc(r.code)}" aria-label="Salin kode">${icon('copy', 'sm')}</button></div>
      </div>
      ${st === 'upcoming' ? `
        <div class="actions" style="margin-top:14px">
          <a class="btn block olive" href="${waLink(rsvMsg(r))}" target="_blank" rel="noopener">${icon('chat', 'sm')} Konfirmasi via WhatsApp</a>
        </div>
        ${o ? `<a class="live" href="#/order/${o.id}"><span class="lv-ico">${icon('receipt')}</span><span class="grow"><b>Pre-order ${esc(o.code)}</b><small>${o.count} item · ${rp(o.total)}</small></span>${icon('chevron-right', 'sm')}</a>` : ''}
        <div class="actions two">
          ${o ? '' : `<button class="btn soft" data-act="rsv-pre" data-id="${r.id}">${icon('coffee', 'sm')} Pre-order</button>`}
          <button class="btn soft" data-act="rsv-ics" data-id="${r.id}" ${o ? 'style="grid-column:1/-1"' : ''}>${icon('calendar-plus', 'sm')} Kalender</button>
          ${navigator.share ? `<button class="btn soft" data-act="rsv-share" data-id="${r.id}" style="grid-column:1/-1">${icon('share', 'sm')} Bagikan ke teman</button>` : ''}
        </div>
        <div class="pad" style="margin-top:6px;padding-bottom:calc(28px + var(--safe-b))"><button class="btn block" style="background:transparent;color:var(--danger);height:46px" data-act="rsv-cancel" data-id="${r.id}">Batalkan reservasi</button></div>`
        : `<div class="actions" style="padding-bottom:28px"><a class="btn" href="#/reservasi">${icon('calendar', 'sm')} Buat reservasi baru</a></div>`}`;
    },
  };

  /* =========================================================
     SCREEN: PESANAN
     ========================================================= */
  function orderCard(o) {
    const st = orderState(o); const tx = stateText(o);
    const tag = st.step === 3 ? '<span class="tag">Selesai</span>' : st.step === -1 ? '<span class="tag warn">Belum dibayar</span>' : `<span class="tag olive"><i class="dot"></i>${esc(tx.title)}</span>`;
    const where = o.dlv ? o.dlv.courierName : isPickup(o) ? pickupLabel(o.pickup).replace(/ \(.+\)/, '') : o.rsvCode || `Meja ${o.table}`;
    return `<a class="card oc" href="#/order/${o.id}">
      <div class="oc-h"><span class="ic">${icon(KIND_ICON[o.mode] || 'bag', 'sm')}</span><span class="grow"><b>${KIND[o.mode] || 'Pesanan'} · ${esc(where)}</b><small>${esc(o.code)} · ${esc(stampLabel(o.createdAt))}</small></span>${tag}</div>
      <div class="oc-items">${o.lines.map((l) => `${l.qty}x ${esc(l.name)}`).join(', ')}</div>
      <div class="oc-f"><span>${rp(o.total)}</span>${st.step === 3 ? `<span class="btn sm soft" data-act="reorder" data-id="${o.id}">${icon('rotate', 'xs')} Pesan lagi</span>` : `<span class="faint" style="font-weight:500;font-size:12.5px;display:inline-flex;align-items:center;gap:2px">Lacak ${icon('chevron-right', 'xs')}</span>`}</div>
    </a>`;
  }
  function rsvCard(r) {
    const st = rsvState(r);
    const tag = st === 'cancelled' ? '<span class="tag red">Dibatalkan</span>' : st === 'past' ? '<span class="tag">Selesai</span>' : '<span class="tag warn">Menunggu konfirmasi</span>';
    return `<a class="card oc" href="#/rsv/${r.id}">
      <div class="oc-h"><span class="ic">${icon('calendar', 'sm')}</span><span class="grow"><b>${esc(dateShort(r.date))} · ${dot(r.time)}</b><small>${esc(r.code)} · ${r.guests} orang · ${esc(r.area)}</small></span>${tag}</div>
    </a>`;
  }
  const Pesanan = {
    html(m, q) {
      const tab = q.get('tab') === 'rsv' ? 'rsv' : 'orders';
      const seg = `<div class="seg" data-v="${tab}" role="tablist"><button role="tab" class="${tab === 'orders' ? 'on' : ''}" data-act="ptab" data-v="orders">${icon('receipt', 'sm')} Pesanan</button><button role="tab" class="${tab === 'rsv' ? 'on' : ''}" data-act="ptab" data-v="rsv">${icon('calendar', 'sm')} Reservasi</button></div>`;
      let body;
      if (tab === 'orders') {
        const act = S.orders.filter((o) => orderState(o).step < 3);
        const done = S.orders.filter((o) => orderState(o).step === 3);
        body = S.orders.length
          ? `${act.length ? `<div class="list-sub">Sedang berjalan</div>${act.map(orderCard).join('')}` : ''}${done.length ? `<div class="list-sub">Riwayat</div>${done.slice(0, 30).map(orderCard).join('')}` : ''}`
          : `<div class="empty"><div class="em-ico">${icon('receipt', 'lg')}</div><h3>Belum ada pesanan</h3><p>Pesan pick up atau delivery langsung dari ponselmu.</p><a class="btn" href="#/menu">Mulai Pesan</a></div>`;
      } else {
        const up = S.rsvs.filter((r) => rsvState(r) === 'upcoming').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const old = S.rsvs.filter((r) => rsvState(r) !== 'upcoming');
        body = S.rsvs.length
          ? `${up.length ? `<div class="list-sub">Akan datang</div>${up.map(rsvCard).join('')}` : ''}${old.length ? `<div class="list-sub">Riwayat</div>${old.slice(0, 30).map(rsvCard).join('')}` : ''}<a class="btn block soft" style="margin-top:16px" href="#/reservasi">${icon('plus', 'sm')} Reservasi baru</a>`
          : `<div class="empty"><div class="em-ico">${icon('calendar', 'lg')}</div><h3>Belum ada reservasi</h3><p>Booking meja untuk nongkrong, meeting, atau momen spesial.</p><a class="btn" href="#/reservasi">Reservasi Meja</a></div>`;
      }
      return `<div class="list-head"><h1>Aktivitas</h1>${seg}</div><div class="olist">${body}</div>`;
    },
  };

  /* =========================================================
     SCREEN: AKUN
     ========================================================= */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  const Akun = {
    html() {
      const p = S.profile; const nm = (p.name || '').trim();
      return `
      <div class="acc-head"><h1>Akun</h1>
        <button class="card profile" data-act="profile" style="width:100%;text-align:left">
          <span class="avatar">${esc((nm[0] || 'm').toUpperCase())}</span>
          <span class="grow"><b>${nm ? esc(nm) : `Tamu ${C.storeName}`}</b><small>${p.phone ? esc(p.phone) : 'Lengkapi nama & WhatsApp untuk checkout lebih cepat'}</small></span>
          ${icon('edit', 'sm')}
        </button>
      </div>
      <div class="sec-h" style="margin-top:24px"><h2>Toko</h2></div>
      <div class="card menu-list">
        <button class="ml" data-act="route"><span class="ml-i">${icon('map-pin', 'sm')}</span><span class="grow">Petunjuk arah<small>${esc(C.addressShort)}</small></span>${icon('chevron-right', 'sm')}</button>
        <button class="ml" data-act="store"><span class="ml-i">${icon('clock', 'sm')}</span><span class="grow">Jam buka<small>Setiap hari · ${dot(C.open)} – ${dot(C.close)} WIB</small></span>${icon('chevron-right', 'sm')}</button>
        <a class="ml" href="tel:+${C.phoneIntl}"><span class="ml-i">${icon('phone', 'sm')}</span><span class="grow">Telepon<small>${esc(C.phoneDisplay)}</small></span>${icon('chevron-right', 'sm')}</a>
        <a class="ml" href="https://wa.me/${C.phoneIntl}" target="_blank" rel="noopener"><span class="ml-i">${icon('chat', 'sm')}</span><span class="grow">WhatsApp<small>Tanya menu, acara &amp; reservasi</small></span>${icon('chevron-right', 'sm')}</a>
      </div>
      <div class="sec-h" style="margin-top:24px"><h2>Ikuti kami</h2></div>
      <div class="card menu-list">
        <a class="ml" href="${C.instagram}" target="_blank" rel="noopener"><span class="ml-i">${icon('instagram', 'sm')}</span><span class="grow">Instagram<small>${esc(C.handle)}</small></span>${icon('chevron-right', 'sm')}</a>
        ${C.tiktok ? `<a class="ml" href="${C.tiktok}" target="_blank" rel="noopener"><span class="ml-i">${icon('tiktok', 'sm')}</span><span class="grow">TikTok<small>${esc(C.handle)}</small></span>${icon('chevron-right', 'sm')}</a>` : ''}
      </div>
      <div class="sec-h" style="margin-top:24px"><h2>Aplikasi</h2></div>
      <div class="card menu-list">
        <button class="ml" data-act="install"><span class="ml-i">${icon('phone2', 'sm')}</span><span class="grow">Pasang di layar utama<small>Buka ${esc(C.storeName)} seperti aplikasi</small></span>${icon('chevron-right', 'sm')}</button>
        <button class="ml" data-act="reset"><span class="ml-i">${icon('trash', 'sm')}</span><span class="grow">Hapus data di perangkat ini<small>Keranjang, riwayat & profil</small></span>${icon('chevron-right', 'sm')}</button>
      </div>
      <div class="foot" style="padding-top:36px"><img src="assets/brand/lockup-dark.png" alt="${esc(C.storeName)}"><span>${esc(C.handle)}</span><span style="display:block;margin-top:10px">${esc(C.footNote)}</span></div>`;
    },
  };
  function openProfile() {
    const p = S.profile;
    const sh = openSheet(`
      <div class="sheet-body bg-in">
        <div class="sheet-head"><h2>Profil kamu</h2><p>Dipakai otomatis saat checkout &amp; reservasi. Tersimpan hanya di perangkat ini.</p></div>
        <div class="sheet-pad form-grid">
          <label class="field"><span>Nama</span><input class="input" id="pf-name" autocomplete="name" placeholder="Nama kamu" value="${esc(p.name)}"></label>
          <label class="field"><span>No. WhatsApp</span><input class="input" id="pf-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx" value="${esc(p.phone)}"><span class="err-msg" hidden>Nomor WhatsApp belum valid.</span></label>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn block" data-s="save">Simpan</button></div>`);
    $('[data-s="save"]', sh).addEventListener('click', () => {
      const name = $('#pf-name', sh).value.trim(); const phone = $('#pf-phone', sh).value.trim();
      if (phone && !okPhone(phone)) { const i = $('#pf-phone', sh); i.classList.add('err'); i.nextElementSibling.hidden = false; return; }
      S.profile = { name, phone }; save('profile');
      closeSheet(() => { rerender(); toast('Profil tersimpan'); });
    });
  }

  /* ---------- routes ---------- */
  const ROUTES = [
    { re: /^\/$/, tab: 'home', view: Home },
    { re: /^\/menu$/, tab: 'menu', view: Menu },
    { re: /^\/reservasi$/, tab: 'reservasi', view: Reservasi },
    { re: /^\/pesanan$/, tab: 'pesanan', view: Pesanan },
    { re: /^\/akun$/, tab: 'akun', view: Akun },
    { re: /^\/checkout$/, tab: null, view: Checkout },
    { re: /^\/order\/([\w-]+)$/, tab: null, view: OrderView },
    { re: /^\/rsv\/([\w-]+)$/, tab: null, view: RsvView },
  ];

  /* =========================================================
     ACTIONS (event delegation)
     ========================================================= */
  // ganti tipe pesanan; pre-order reservasi ikut batal bila sedang aktif
  function setMode(m) {
    const hadPre = !!activePreRsv();
    S.mode = normMode(m); S.preRsv = null; save('mode', 'preRsv');
    if (hadPre) toast('Pre-order dibatalkan', 'info');
  }
  const ACT = {
    close: () => closeSheet(),
    search: () => openSearch(),
    store: () => openStore(),
    item: (t) => openItem(t.dataset.id),
    banner: (t) => go('/menu?cat=' + t.dataset.cat),
    checkout: () => go('/checkout'),
    back: (t) => { if (navDepth > 0) history.back(); else go(t.dataset.to || '/'); },
    start: (t) => { S.mode = normMode(t.dataset.mode); S.preRsv = null; save('mode', 'preRsv'); go('/menu'); },
    mode: (t) => { setMode(t.dataset.mode); refreshMenuHead(); updateCartBar(); vibrate(); },
    'co-mode': (t) => { setMode(t.dataset.mode); rerender(); },
    courier: (t) => { S.courier = t.dataset.v; save('courier'); rerender(); },
    locate: (t) => {
      const lbl = $('span', t);
      if (!navigator.geolocation) { toast('Lokasi tidak tersedia di perangkat ini', 'info'); return; }
      if (lbl) lbl.textContent = 'Mencari lokasimu…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const km = distKm(pos.coords.latitude, pos.coords.longitude);
        S.addr.km = km; save('addr');
        if (parseHash().path === '/checkout') rerender();
        toast(km > DLV.maxKm ? `±${kmLabel(km)} — di luar jangkauan pengantaran` : `Jarak ±${kmLabel(km)} dari ${C.storeName}`, 'map-pin');
      }, () => {
        if (lbl) lbl.textContent = 'Pakai lokasi saya untuk hitung jarak';
        toast('Lokasi tidak diizinkan, ongkir memakai estimasi', 'info');
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    },
    driver: (t) => toast(`Simulasi: di versi final membuka chat driver di aplikasi ${t.dataset.by}`, 'chat'),
    cat: (t) => menuCtl && menuCtl.scrollTo(t.dataset.cat),
    quick: (t) => {
      const it = ITEMS[t.dataset.id];
      if (hasOpts(it)) { openItem(it.id); return; }
      addLine(it.id, {}, '', 1); vibrate();
      const card = t.closest('.item, .sig'); const imgEl = card && $('.im', card);
      refreshCtl(it.id); updateCartBar();
      fly(imgEl || t, it.img);
      toast(`${it.name} masuk keranjang`);
    },
    inc: (t) => { const id = t.dataset.id; addLine(id, {}, '', 1); refreshCtl(id); updateCartBar(); vibrate(); },
    dec: (t) => {
      const id = t.dataset.id; const lines = S.cart.filter((l) => l.id === id); const l = lines[lines.length - 1];
      if (!l) return; l.qty -= 1; if (l.qty <= 0) S.cart = S.cart.filter((x) => x !== l);
      save('cart'); refreshCtl(id); updateCartBar();
    },
    'line-inc': (t) => { const l = S.cart.find((x) => x.key === t.dataset.key); if (l) { l.qty = Math.min(50, l.qty + 1); save('cart'); rerender(); } },
    'line-dec': (t) => {
      const l = S.cart.find((x) => x.key === t.dataset.key); if (!l) return;
      l.qty -= 1; if (l.qty <= 0) { S.cart = S.cart.filter((x) => x !== l); toast(`${ITEMS[l.id].name} dihapus`, 'trash'); }
      save('cart'); rerender();
    },
    'edit-line': (t) => { const l = S.cart.find((x) => x.key === t.dataset.key); if (l) openItem(l.id, l.key); },
    'clear-cart': () => confirmSheet({ title: 'Kosongkan keranjang?', text: 'Semua menu di keranjang akan dihapus.', ok: 'Kosongkan', danger: true, onOk: () => { S.cart = []; save('cart'); rerender(); } }),
    pickup: (t) => { S.pickup = t.dataset.v; $$('.times .chip').forEach((c) => c.classList.toggle('on', c === t)); },
    cutlery: (t) => { S.cutlery = !S.cutlery; t.classList.toggle('on', S.cutlery); t.setAttribute('aria-checked', S.cutlery); },
    pay: (t) => { S.pay = t.dataset.v; save('pay'); rerender(); },
    place: () => placeOrder(),
    'cancel-pre': () => { S.preRsv = null; save('preRsv'); refreshMenuHead(); updateCartBar(); if (parseHash().path === '/checkout') rerender(); toast('Pre-order dibatalkan', 'info'); },
    'pay-now': (t) => { const o = S.orders.find((x) => x.id === t.dataset.id); if (o) openPayment(o); },
    received: (t) => { const o = S.orders.find((x) => x.id === t.dataset.id); if (o) { o.doneAt = Date.now(); save('orders'); rerender(); toast('Selamat menikmati!', 'coffee'); } },
    reorder: (t, e) => {
      e.stopPropagation();
      const o = S.orders.find((x) => x.id === t.dataset.id); if (!o) return;
      let n = 0;
      o.lines.forEach((l) => { if (ITEMS[l.id]) { addLine(l.id, l.sel, l.note, l.qty); n += l.qty; } });
      S.mode = o.mode === 'delivery' ? 'delivery' : 'pickup'; S.preRsv = null; save('mode', 'preRsv');
      go('/checkout'); setTimeout(() => toast(`${n} item ditambahkan ke keranjang`), 250);
    },
    ptab: (t) => replace(t.dataset.v === 'rsv' ? '/pesanan?tab=rsv' : '/pesanan'),
    'rsv-date': (t) => { const rd = draft(); rd.date = t.dataset.v; if (rd.time && (rsvSlots(rd.date).find((s) => s.v === rd.time) || {}).off) rd.time = null; save('rd'); rerender(); },
    'rsv-time': (t) => { draft().time = t.dataset.v; save('rd'); rerender(); },
    'rsv-g': (t) => { const rd = draft(); rd.guests = Math.min(C.maxGuests, Math.max(1, rd.guests + Number(t.dataset.d))); save('rd'); rerender(); },
    'rsv-area': (t) => { draft().area = t.dataset.v; save('rd'); rerender(); },
    'rsv-occ': (t) => { const rd = draft(); rd.occ = rd.occ === t.dataset.v ? '' : t.dataset.v; save('rd'); rerender(); },
    'rsv-next': () => rsvNext(),
    'rsv-ics': (t) => { const r = getRsv(t.dataset.id); if (r) downloadICS(r); },
    'rsv-pre': (t) => {
      const r = getRsv(t.dataset.id); if (!r) return;
      S.preRsv = r.id; save('preRsv');
      go('/menu'); setTimeout(() => toast(`Pre-order untuk ${r.code}`, 'calendar'), 300);
    },
    'rsv-cancel': (t) => confirmSheet({
      title: 'Batalkan reservasi?', text: 'Reservasi ini akan ditandai batal. Kabari kami via WhatsApp jika sudah sempat dikonfirmasi.', ok: 'Ya, batalkan', danger: true,
      onOk: () => { const r = getRsv(t.dataset.id); if (r) { r.status = 'cancelled'; save('rsvs'); if (S.preRsv === r.id) { S.preRsv = null; save('preRsv'); } rerender(); toast('Reservasi dibatalkan', 'info'); } },
    }),
    copy: (t) => {
      const v = t.dataset.v;
      const ok = () => toast('Kode disalin', 'copy');
      const legacy = () => { // fallback utk http / Safari lama
        const ta = el('textarea'); ta.value = v; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;opacity:0;font-size:16px';
        document.body.append(ta); ta.select(); ta.setSelectionRange(0, v.length);
        let done = false; try { done = document.execCommand('copy'); } catch (e) { /* noop */ }
        ta.remove(); toast(done ? 'Kode disalin' : `Kode: ${v}`, 'copy');
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(ok, legacy); else legacy();
    },
    profile: () => openProfile(),
    route: () => {
      const ll = `${C.lat},${C.lng}`;
      const row = (href, ic, name, sub) => `<a class="ml" href="${href}" target="_blank" rel="noopener"><span class="ml-i">${icon(ic, 'sm')}</span><span class="grow">${name}<small>${sub}</small></span>${icon('chevron-right', 'sm')}</a>`;
      openSheet(`<div class="sheet-body"><div class="sheet-head"><h2>Petunjuk arah</h2><p>${esc(C.address)}</p></div>
        <div class="sheet-pad"><div class="menu-list" style="margin:0;padding:0">
          ${IS_IOS ? row(`https://maps.apple.com/?daddr=${ll}&dirflg=d&q=${encodeURIComponent(C.appleMapsQuery || C.storeName)}`, 'map-pin', 'Apple Maps', 'Bawaan iPhone') : ''}
          ${row(C.mapsUrl, 'nav', 'Google Maps', 'Rute & ulasan')}
          ${row(`https://waze.com/ul?ll=${ll}&navigate=yes`, 'nav', 'Waze', 'Navigasi berkendara')}
        </div></div></div>`);
    },
    'ios-tip-off': () => { store.set('iosTipOff', true); const t = $('#ios-tip'); if (t) t.remove(); },
    'rsv-share': (t) => {
      const r = getRsv(t.dataset.id); if (!r) return;
      const text = `Reservasi di ${C.storeName} ${C.branch}\n${dateLong(r.date)}, ${dot(r.time)} WIB · ${r.guests} orang\n${C.address}\n${C.mapsUrl}`;
      navigator.share({ title: `Reservasi ${C.storeName}`, text }).catch(() => {});
    },
    install: async () => {
      if (IS_STANDALONE) { toast(`${C.storeName} sudah terpasang di perangkat ini`, 'check'); return; }
      if (installEvt) { installEvt.prompt(); installEvt = null; return; }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      openSheet(`<div class="sheet-body"><div class="sheet-head"><h2>Pasang di layar utama</h2><p>Akses ${esc(C.storeName)} dengan satu ketukan, seperti aplikasi.</p></div>
        <div class="sheet-pad"><ol class="steps-ol">${ios
          ? `<li>Ketuk tombol <b>Bagikan</b> ${icon('share', 'xs')} di Safari.</li><li>Pilih <b>Tambah ke Layar Utama</b>.</li><li>Ketuk <b>Tambah</b>.</li>`
          : '<li>Buka menu browser (ikon ⋮).</li><li>Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.</li><li>Konfirmasi.</li>'}</ol></div></div>
        <div class="sheet-foot"><button class="btn block" data-act="close">Mengerti</button></div>`);
    },
    reset: () => confirmSheet({
      title: 'Hapus data?', text: 'Keranjang, riwayat pesanan, reservasi, dan profil di perangkat ini akan dihapus.', ok: 'Hapus', danger: true,
      onOk: () => { ['cart', 'orders', 'rsvs', 'profile', 'rd', 'preRsv', 'addr', 'courier', 'mode', 'queue'].forEach((k) => { try { localStorage.removeItem('mg_' + k); } catch (e) { /* noop */ } }); location.reload(); },
    }),
  };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const fn = ACT[t.dataset.act];
    if (!fn) return;
    if (t.disabled) return;
    e.preventDefault();
    fn(t, e);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape' && sheetStack.length) closeSheet();
  });
  // input binding (nilai form bertahan saat layar dirender ulang)
  let bindT;
  document.addEventListener('input', (e) => {
    const b = e.target.dataset && e.target.dataset.bind; if (!b) return;
    const v = e.target.value;
    e.target.classList.remove('err');
    const msg = e.target.parentElement.querySelector('.err-msg'); if (msg) msg.hidden = true;
    if (b === 'name' || b === 'phone') S.profile[b] = v;
    else if (b === 'addr.text') S.addr.text = v;
    else if (b === 'addr.note') S.addr.note = v;
    else if (b === 'rd.note') draft().note = v;
    clearTimeout(bindT); bindT = setTimeout(() => save('profile', 'addr', 'rd'), 300);
  });

  /* ---------- iPhone: :active states, keyboard & viewport ---------- */
  document.addEventListener('touchstart', () => {}, { passive: true }); // aktifkan :active di Safari iOS
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const syncVV = () => {
      const zoomed = vv.scale > 1.01;
      const kb = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', kb + 'px');
      root.style.setProperty('--vvh', Math.round(zoomed ? window.innerHeight : vv.height) + 'px');
      root.classList.toggle('kb', kb > 120);
    };
    vv.addEventListener('resize', syncVV);
    vv.addEventListener('scroll', syncVV);
    syncVV();
  }

  /* ---------- init ---------- */
  let navDepth = 0;
  window.addEventListener('hashchange', () => { navDepth += 1; });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  hydrate(document);
  render();

  // splash
  const splash = $('#splash');
  let seen = false;
  try { seen = sessionStorage.getItem('mg_splash') === '1'; sessionStorage.setItem('mg_splash', '1'); } catch (e) { /* noop */ }
  if (seen) splash.remove();
  else setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 600); }, 1100);

  setInterval(updateTabDot, 5000);
})();
