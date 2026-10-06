/* =========================================================
   Utilitas tampilan: DOM, ikon, toast, modal, drawer, konfirmasi.
   ========================================================= */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const IMG = (id) => `../assets/img/${encodeURIComponent(id)}.jpg`;
export const initials = (name) => String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
export const avatar = (s, cls = '') => `<span class="avatar ${cls}" style="background:${esc((s && s.color) || '#01512C')}" aria-hidden="true">${esc(initials(s && s.name))}</span>`;
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Ikon (garis 24px) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v3M10 2v3M14 2v3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  receipt: '<path d="M5 2.5v19l2.3-1.5 2.4 1.5 2.3-1.5 2.3 1.5 2.4-1.5 2.3 1.5v-19l-2.3 1.5-2.4-1.5-2.3 1.5-2.3-1.5-2.4 1.5Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a5.5 5.5 0 0 1 3.5 5.1v.9"/>',
  'user-plus': '<circle cx="9" cy="7" r="4"/><path d="M2 21v-1a7 7 0 0 1 7-7 7 7 0 0 1 7 7v1M19 8v6M22 11h-6"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9.5"/><path d="m8 12 2.7 2.7L16 9.5"/>',
  'x-circle': '<circle cx="12" cy="12" r="9.5"/><path d="m15 9-6 6M9 9l6 6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  star: '<path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m2.5 0-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6"/>',
  edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  store: '<path d="M3.5 9.5 5 4h14l1.5 5.5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4.5h4V20"/>',
  bag: '<path d="M6 7h12l1.2 13a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  utensils: '<path d="M4 2v7a3 3 0 0 0 3 3v10M10 2v7a3 3 0 0 1-3 3M7 2v6"/><path d="M20 15V2a5 5 0 0 0-4 5v6a2 2 0 0 0 2 2h2Zm0 0v7"/>',
  scooter: '<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.6 18h6.6l2.4-6"/><path d="M14.5 5.5h2.3l2.6 10"/><path d="M3.5 14.5h6.3l1.6 3.5"/><rect x="3.5" y="8" width="6" height="6.5" rx="1"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M3 7h16a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16V7"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  'wifi-off': '<path d="m2 2 20 20M8.5 16.4a6 6 0 0 1 7 0M5 12.6a11 11 0 0 1 5.2-2.5M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.3-2.8M12 20h.01"/>',
  rotate: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  chef: '<path d="M6 13.9V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6.1"/><path d="M6 17h12"/><path d="M17.5 13.9A4 4 0 0 0 16 6a4 4 0 0 0-8 0 4 4 0 0 0-1.5 7.9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  'volume-x': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  swap: '<path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
  chat: '<path d="M3 21l1.6-4.4A8.5 8.5 0 1 1 8 20Z"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
};
export const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- Gambar menu: tampil halus, sembunyi bila gagal ---------- */
export function hydrateImgs(root) {
  $$('img[data-fade]', root).forEach((img) => {
    const ok = () => img.classList.add('ok');
    if (img.complete && img.naturalWidth) ok();
    else {
      img.addEventListener('load', ok, { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
    }
  });
}

/* ---------- Toast ---------- */
export function toast(msg, type = 'ok', ms = 2600) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type === 'ok' ? '' : type}`;
  t.innerHTML = `${icon(type === 'err' ? 'alert' : type === 'warn' ? 'info' : 'check-circle', 'sm')}<span>${esc(msg)}</span>`;
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Layar sibuk ---------- */
export function busy(text = 'Memproses…') {
  const o = document.createElement('div');
  o.className = 'busy';
  o.innerHTML = `<div class="bx"><div class="spinner"></div><span>${esc(text)}</span></div>`;
  document.body.append(o);
  return { set: (t) => { $('span', o).textContent = t; }, done: () => o.remove() };
}

/* ---------- Modal ---------- */
const stack = [];
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  if (top.opts.dismissable !== false) { e.preventDefault(); top.close(undefined); }
});
export const modalOpen = () => stack.length > 0;
export function closeAllModals() { [...stack].reverse().forEach((m) => m.close(undefined)); }

/**
 * modal({ title, sub, body, foot, size: 'sm'|'lg'|'xl', dismissable, onOpen(el, m), onClose(result) })
 * Kembalikan { el, close(result), result: Promise }
 */
export function modal(opts) {
  const bd = document.createElement('div');
  bd.className = 'modal-bd';
  bd.innerHTML = `<div class="modal ${opts.size || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '')}">
      ${opts.title ? `<div class="modal-head"><div class="grow"><h2>${esc(opts.title)}</h2>${opts.sub ? `<p>${opts.sub}</p>` : ''}</div>${opts.dismissable === false ? '' : `<button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button>`}</div>` : ''}
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.foot ? `<div class="modal-foot">${opts.foot}</div>` : ''}
    </div>`;
  document.body.append(bd);
  let resolve; const result = new Promise((r) => { resolve = r; });
  const prevFocus = document.activeElement;
  const m = {
    el: bd.firstElementChild, bd, opts, result, closed: false,
    close(val) {
      if (m.closed) return;
      m.closed = true;
      stack.splice(stack.indexOf(m), 1);
      bd.classList.remove('in');
      setTimeout(() => bd.remove(), 200);
      if (opts.onClose) opts.onClose(val);
      resolve(val);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ } }
    },
  };
  stack.push(m);
  bd.addEventListener('click', (e) => {
    if (e.target === bd && opts.dismissable !== false) m.close(undefined);
    if (e.target.closest('[data-close]')) m.close(undefined);
  });
  hydrateImgs(bd);
  requestAnimationFrame(() => bd.classList.add('in'));
  if (opts.onOpen) opts.onOpen(m.el, m);
  const f = $('[autofocus]', m.el);
  if (f) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 60);
  return m;
}

export function confirmBox({ title, text = '', ok = 'Ya', cancel = 'Batal', danger = false }) {
  const m = modal({
    title, size: 'sm', body: text ? `<p style="margin:0;color:var(--ink-2)">${text}</p>` : '',
    foot: `<button class="btn ghost" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button>`,
  });
  $('[data-ok]', m.el).addEventListener('click', () => m.close(true));
  return m.result.then((v) => v === true);
}

/** Minta teks (mis. alasan void). presets = pilihan cepat. */
export function promptBox({ title, text = '', label = '', placeholder = '', value = '', ok = 'Simpan', danger = false, presets = [], required = true, type = 'text' }) {
  const m = modal({
    title, size: 'sm',
    body: `${text ? `<p style="margin:0 0 12px;color:var(--ink-2)">${text}</p>` : ''}
      <label class="field">${label ? `<span>${esc(label)}</span>` : ''}<input class="input" data-in type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" autofocus autocomplete="off"></label>
      ${presets.length ? `<div class="quick-notes">${presets.map((p) => `<button class="chip sm" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
      <p class="err-text" data-err hidden>Wajib diisi.</p>`,
    foot: `<button class="btn ghost" data-close>Batal</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button>`,
  });
  const inp = $('[data-in]', m.el);
  const submit = () => {
    const v = inp.value.trim();
    if (required && !v) { $('[data-err]', m.el).hidden = false; inp.classList.add('err'); return; }
    m.close(v);
  };
  $('[data-ok]', m.el).addEventListener('click', submit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  m.el.addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (p) { inp.value = p.dataset.p; inp.focus(); } });
  return m.result.then((v) => (typeof v === 'string' ? v : null));
}

/* ---------- Drawer (panel kanan) ---------- */
export function drawer({ title, sub = '', body = '', foot = '', wide = false, onClose }) {
  const bd = document.createElement('div'); bd.className = 'drawer-bd';
  const dr = document.createElement('aside'); dr.className = `drawer ${wide ? 'wide' : ''}`;
  dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
  dr.innerHTML = `<div class="modal-head"><div class="grow"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></div>
    <div class="modal-body" style="flex:1">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  document.body.append(bd, dr);
  let resolve; const result = new Promise((r) => { resolve = r; });
  const d = {
    el: dr, opts: { dismissable: true }, closed: false, result,
    close(v) {
      if (d.closed) return;
      d.closed = true; stack.splice(stack.indexOf(d), 1);
      bd.classList.remove('in'); dr.classList.remove('in');
      setTimeout(() => { bd.remove(); dr.remove(); }, 260);
      if (onClose) onClose(v);
      resolve(v);
    },
    setBody(html) { $('.modal-body', dr).innerHTML = html; hydrateImgs(dr); },
    setFoot(html) { const f = $('.modal-foot', dr); if (f) f.innerHTML = html; },
  };
  stack.push(d);
  bd.addEventListener('click', () => d.close());
  dr.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  hydrateImgs(dr);
  requestAnimationFrame(() => { bd.classList.add('in'); dr.classList.add('in'); });
  return d;
}

/* ---------- Unduh berkas ---------- */
export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' + text : text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- Input nominal Rupiah (format ribuan saat mengetik) ---------- */
export function moneyInput(inp, onChange) {
  const fmt = () => {
    const d = inp.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    inp.value = d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
    if (onChange) onChange(d ? parseInt(d, 10) : 0);
  };
  inp.addEventListener('input', fmt);
  fmt();
}

/* ---------- Bunyi pendek (dapur) ---------- */
let actx = null;
export function beep(times = 2) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      const t0 = actx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
    return true;
  } catch (e) { return false; }
}
export const audioReady = () => !!actx && actx.state === 'running';
