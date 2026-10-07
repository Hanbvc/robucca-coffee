/* =========================================================
   Menu pelanggan Robucca — hanya untuk dilihat (tanpa memesan): QR di meja,
   tautan di bio Instagram, tablet, atau TV di kasir.
   Urutan kelompok: Minuman → Snack → Makanan Berat → Pastry & Dessert.

   Sumber data, berurutan:
   1. ?pratinjau=1 — salinan dari POS mode demo di perangkat ini (Kantor › Menu)
   2. Server POS (/api/public/menu?cabang=KODE) — harga & ketersediaan cabang,
      diperbarui tiap menit
   3. Menu standar js/data.js — bila tidak ada server (mis. GitHub Pages)
   ========================================================= */
import { menuFromData, publicMenu } from '../pos/js/core/menu.js';
import { rp } from '../pos/js/core/money.js';
import { clock, tzLabel } from '../pos/js/core/dates.js';

const C = window.MG_CONFIG || {};
const params = new URLSearchParams(location.search);
const want = (params.get('cabang') || '').trim().toUpperCase().slice(0, 8);
const PREVIEW_KEY = 'pos:menuPreview';
const REFRESH_MS = 60e3;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG = (id) => `../assets/img/${encodeURIComponent(id)}.jpg`;
const dot = (t) => String(t || '').replace(':', '.');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const initials = (s) => String(s || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/* ---------- sumber data ---------- */
function fromPreview() {
  try {
    const p = JSON.parse(localStorage.getItem(PREVIEW_KEY) || 'null');
    if (p && p.menu && Date.now() - p.at < 12 * 3600e3 && (!want || p.menu.branch.code === want)) return { ...p, source: 'preview' };
  } catch (e) { /* penyimpanan diblokir */ }
  return null;
}

/** Server POS di alamat yang sama (server menyajikan /menu/), atau MG_CONFIG.posServer.
    null = bukan server POS (mis. GitHub Pages) · { error } = server menjawab galat. */
async function fromServer() {
  const bases = [new URL('../', location.href).href];
  if (C.posServer) bases.push(`${String(C.posServer).replace(/\/+$/, '')}/`);
  let failure = null;
  for (const base of bases) {
    const url = new URL(`api/public/menu${want ? `?cabang=${encodeURIComponent(want)}` : ''}`, base);
    let res;
    try { res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }); } catch (e) { failure = { error: 'Server menu tidak bisa dihubungi' }; continue; }
    if (!(res.headers.get('content-type') || '').includes('application/json')) continue;
    const body = await res.json().catch(() => null);
    if (!body) continue;
    if (res.ok) return { ...body, source: 'server' };
    if (res.status === 404 && Array.isArray(body.branches)) return { ...body, menu: null, notFound: true, source: 'server' };
    failure = { error: body.error || `Galat ${res.status}` };
  }
  return failure;
}

function fromStatic(note = '') {
  const raw = {
    settings: [{}],
    branches: [{ id: 'std', code: '', name: C.branch || '', address: C.address || '', phone: C.phoneDisplay || '', open: C.open || '', close: C.close || '', tz: 'Asia/Jakarta', taxPct: 0, active: true }],
    ...menuFromData(window.MG_MENU || []),
    itemBranch: [],
    channels: [],
  };
  const menu = publicMenu(raw, 'std');
  menu.priceNote = C.priceNote || '';
  return { source: 'static', org: { name: C.storeName || 'Robucca', instagram: C.handle || '' }, branches: [], menu, note };
}

/* ---------- status ---------- */
let data = null;
let shown = '';
let lastLoad = 0;
let activeG = '';
let activeC = '';
let q = '';
let lock = 0;
let raf = 0;
let timer = 0;

async function load(first) {
  let d = first && params.has('pratinjau') ? fromPreview() : null;
  if (!d) {
    const s = await fromServer();
    if (s && s.source === 'server') d = s;
    else if (first || !data) d = fromStatic(s && s.error ? 'Harga & ketersediaan cabang sedang tidak bisa dimuat, jadi yang tampil adalah menu standar.' : '');
    else return; // pembaruan berkala gagal: tetap tampilkan data terakhir
  }
  lastLoad = Date.now();
  render(d);
}

/* ---------- tampilan ---------- */
function openState(b) {
  const hhmm = /^\d\d:\d\d$/;
  if (!hhmm.test(b.open || '') || !hhmm.test(b.close || '')) return null;
  let now;
  try { now = new Intl.DateTimeFormat('en-GB', { timeZone: b.tz || 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/[^\d:]/g, '').slice(0, 5); } catch (e) { return null; }
  const open = b.open < b.close ? now >= b.open && now < b.close : now >= b.open || now < b.close;
  return { open, label: open ? `Buka · tutup pukul ${dot(b.close)}` : `Sedang tutup · buka pukul ${dot(b.open)}` };
}

function renderWhere(d) {
  const b = d.menu.branch; const st = openState(b);
  $('#where').innerHTML = `<div><h1><small>MENU</small>${esc(b.name || (d.org && d.org.name) || 'Robucca')}</h1>
    ${st ? `<div class="status ${st.open ? '' : 'closed'}"><i aria-hidden="true"></i>${esc(st.label)}</div>` : ''}</div>
    ${d.source === 'server' && (d.branches || []).length > 1 ? '<a class="change" href="./">Ganti cabang</a>' : ''}`;
}

function itemHTML(it, { cat = '', star = true } = {}) {
  const pic = it.img ? `<img src="${IMG(it.img)}" alt="" loading="lazy" decoding="async" width="76" height="76">` : esc(initials(it.name));
  return `<article class="item${it.soldOut ? ' out' : ''}">
    <div class="im" data-n="${esc(it.name)}" aria-hidden="true">${pic}</div>
    <div><h4>${esc(it.name)}${star && it.sig ? ' <span class="star" role="img" aria-label="Signature">★</span>' : ''}</h4>
      ${cat ? `<div class="where-cat">${esc(cat)}</div>` : ''}
      ${it.notes && it.notes.length ? `<div class="opts">${it.notes.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : ''}</div>
    <div class="pr"><b>${rp(it.price)}</b>${it.soldOut ? '<br><span class="habis">Habis</span>' : ''}</div>
  </article>`;
}

function listHTML(menu) {
  if (!menu.groups.length) return '<div class="state"><h2>Menu belum tersedia</h2><p>Silakan tanyakan menu kepada kasir kami.</p></div>';
  return menu.groups.map((g) => {
    const n = g.cats.reduce((a, c) => a + c.items.length, 0);
    // kelompok berisi satu kategori bernama sama (mis. Snack) tidak perlu judul kategori
    const single = g.cats.length === 1 && norm(g.cats[0].name) === norm(g.name);
    return `<section class="grp" id="g-${g.id}" data-g="${g.id}" aria-labelledby="h-${g.id}">
      <h2 id="h-${g.id}">${esc(g.name)} <small>${n} menu</small></h2>
      ${g.cats.map((c) => {
        const allSig = c.items.every((i) => i.sig);
        return `<section class="cat" id="c-${esc(c.id)}" data-g="${g.id}" data-c="${esc(c.id)}">
          ${single ? '' : `<h3>${esc(c.name)}${allSig ? ' <span class="sig">★ Signature</span>' : ''}</h3>`}
          <div class="items">${c.items.map((it) => itemHTML(it, { star: !allSig })).join('')}</div>
        </section>`;
      }).join('')}
    </section>`;
  }).join('');
}

function renderFoot(d) {
  const m = d.menu; const b = m.branch; const tz = tzLabel(b.tz);
  const src = d.source === 'server' ? `Harga & ketersediaan langsung dari kasir cabang · diperbarui ${clock(d.at || lastLoad, b.tz)} ${tz}`
    : d.source === 'preview' ? `Pratinjau dari POS mode demo (${clock(d.at, b.tz)} ${tz}) — hanya tampil di perangkat ini`
      : (C.footNote || '');
  $('#foot').innerHTML = `${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
    ${m.priceNote ? `<p class="note">${esc(m.priceNote)}</p>` : ''}
    <p>${esc([d.org && d.org.name, b.name].filter(Boolean).join(' '))}${b.address ? ` · ${esc(b.address)}` : ''}</p>
    ${b.open && b.close ? `<p>Jam buka ${dot(b.open)}–${dot(b.close)} ${tz}${b.phone ? ` · ${esc(b.phone)}` : ''}</p>` : ''}
    ${d.org && d.org.instagram ? `<p>${esc(d.org.instagram)}</p>` : ''}
    ${src ? `<p class="src">${esc(src)}</p>` : ''}`;
}

function renderPicker(d) {
  $('#bar').hidden = true;
  $('#where').innerHTML = `<div><h1><small>MENU</small>${esc((d.org && d.org.name) || 'Robucca')}</h1></div>`;
  const list = d.branches || [];
  $('#list').innerHTML = `<div class="state">
    <h2>${d.notFound ? 'Cabang tidak ditemukan' : list.length ? 'Pilih cabang' : 'Menu belum tersedia'}</h2>
    <p>${d.notFound ? `Kode cabang "${esc(want)}" tidak dikenal. Silakan pilih cabang di bawah.` : list.length ? 'Harga dan ketersediaan menu bisa berbeda di tiap cabang.' : 'Silakan tanyakan menu kepada kasir kami.'}</p>
    <div class="picks">${list.map((b) => `<a href="?cabang=${encodeURIComponent(b.code)}"><b>${esc(b.name)}</b>${b.address ? `<span>${esc(b.address)}</span>` : ''}</a>`).join('')}</div>
  </div>`;
  $('#foot').innerHTML = '';
}

function hydrate(root) {
  for (const img of $$('.im img', root)) {
    const ok = () => img.classList.add('ok');
    const bad = () => { const box = img.parentElement; img.remove(); box.textContent = initials(box.dataset.n); };
    if (img.complete && img.naturalWidth) ok();
    else { img.addEventListener('load', ok, { once: true }); img.addEventListener('error', bad, { once: true }); }
  }
}

function render(d) {
  const sig = JSON.stringify([d.source, d.menu, d.branches, d.notFound, d.note]);
  data = d;
  const loading = $('#loading'); if (loading) loading.remove();
  $('#proto').hidden = d.source !== 'static';
  if (sig === shown) { if (d.menu) { renderWhere(d); renderFoot(d); } return; }
  shown = sig;
  if (!d.menu) { renderPicker(d); return; }
  const b = d.menu.branch;
  document.title = `Menu ${[d.org && d.org.name, b.name].filter(Boolean).join(' ')}`;
  renderWhere(d);
  $('#bar').hidden = false;
  $('#tabs').innerHTML = d.menu.groups.map((g) => `<a class="tab" href="#g-${g.id}" data-g="${g.id}">${esc(g.name)}</a>`).join('');
  $('#list').innerHTML = listHTML(d.menu);
  hydrate($('#list'));
  renderFoot(d);
  activeG = ''; activeC = '';
  if (q) renderResults();
  spy(true);
}

/* ---------- navigasi: tab kelompok, chip kategori, sorotan saat menggulir ---------- */
const barH = () => $('#bar').offsetHeight || 0;
// geser tab/chip aktif agar terlihat penuh, di luar tepi yang dipudarkan (36px)
function into(box, el) { if (box && el) box.scrollTo({ left: Math.max(0, el.offsetLeft - 48), behavior: smooth() }); }

function setActive(gid, cid) {
  if (!data || !data.menu) return;
  if (gid !== activeG) {
    activeG = gid; activeC = '';
    $$('.tab').forEach((t) => t.setAttribute('aria-current', String(t.dataset.g === gid)));
    const g = data.menu.groups.find((x) => x.id === gid);
    $('#chips').innerHTML = g ? g.cats.map((c) => `<a class="chip" href="#c-${esc(c.id)}" data-c="${esc(c.id)}">${esc(c.name)}</a>`).join('') : '';
    into($('#tabs'), $(`.tab[data-g="${gid}"]`));
  }
  if (cid !== activeC) {
    activeC = cid;
    $$('.chip').forEach((c) => c.classList.toggle('on', c.dataset.c === cid));
    into($('#chips'), $$('.chip').find((c) => c.dataset.c === cid));
  }
}

function spy(force) {
  raf = 0;
  const bar = $('#bar');
  bar.classList.toggle('lift', !bar.hidden && bar.getBoundingClientRect().top <= 0 && scrollY > 0);
  if (q || (!force && Date.now() < lock)) return;
  const cats = $$('#list .cat');
  if (!cats.length) return;
  // kategori aktif = kategori pertama yang masih terlihat di bawah bilah navigasi
  const line = barH() + 16;
  let cur = cats[cats.length - 1];
  if (innerHeight + scrollY < document.documentElement.scrollHeight - 4) cur = cats.find((s) => s.getBoundingClientRect().bottom > line) || cur;
  setActive(cur.dataset.g, cur.dataset.c);
}

function go(id, behavior = smooth()) {
  const el = document.getElementById(id);
  if (!el) return;
  if (q) closeSearch();
  const firstCat = el.classList.contains('grp') ? $('.cat', el) : el;
  if (firstCat) setActive(firstCat.dataset.g, firstCat.dataset.c);
  lock = Date.now() + 1200;
  el.scrollIntoView({ behavior, block: 'start' });
  history.replaceState(null, '', `#${id}`);
}

/* ---------- cari ---------- */
function renderResults() {
  const box = $('#results');
  if (!q) { box.hidden = true; $('#list').hidden = false; return; }
  const s = norm(q); const hits = [];
  for (const g of data.menu.groups) for (const c of g.cats) for (const it of c.items) if (norm(it.name).includes(s) || norm(c.name).includes(s)) hits.push([it, c.name]);
  $('#list').hidden = true; box.hidden = false;
  box.innerHTML = hits.length
    ? `<p class="where-cat" style="margin:14px 0 0" role="status">${hits.length} menu ditemukan</p><div class="items">${hits.map(([it, cat]) => itemHTML(it, { cat })).join('')}</div>`
    : `<div class="state" role="status"><h2>Tidak ditemukan</h2><p>Coba kata lain, mis. "latte", "ramen", atau "croissant".</p></div>`;
  hydrate(box);
}
function openSearch() {
  $('#bar').classList.add('searching');
  const top = $('.top').offsetHeight;
  if (scrollY > top) scrollTo(0, top);
  $('#q').focus();
}
function closeSearch() {
  q = ''; $('#q').value = '';
  $('#bar').classList.remove('searching');
  renderResults();
  spy(true);
}

/** Tandai tepi bilah yang masih bisa digeser (dipudarkan lewat CSS) */
function edges(box) {
  const f = () => {
    box.classList.toggle('more-l', box.scrollLeft > 2);
    box.classList.toggle('more-r', box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
  };
  box.addEventListener('scroll', f, { passive: true });
  new ResizeObserver(f).observe(box);
  new MutationObserver(f).observe(box, { childList: true });
}

/* ---------- mulai ---------- */
function bind() {
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${barH()}px`)).observe($('#bar'));
  edges($('#tabs')); edges($('#chips'));
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => spy(false)); }, { passive: true });
  addEventListener('scrollend', () => { lock = 0; spy(true); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.tab, a.chip');
    if (a) { e.preventDefault(); go(a.getAttribute('href').slice(1)); }
  });
  $('#search-open').addEventListener('click', () => ($('#bar').classList.contains('searching') ? closeSearch() : openSearch()));
  $('#search-close').addEventListener('click', closeSearch);
  $('#q').addEventListener('input', () => { q = $('#q').value.trim(); renderResults(); });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && data.source === 'server' && Date.now() - lastLoad > 30e3) load(false).catch(() => {});
  });
  // jam buka/tutup & pembaruan menu dari server
  setInterval(() => { if (data && data.menu) renderWhere(data); }, 60e3);
  timer = setInterval(() => { if (data && data.source === 'server' && document.visibilityState === 'visible') load(false).catch(() => {}); }, REFRESH_MS);
}

async function start() {
  bind();
  try {
    await load(true);
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && document.getElementById(h)) go(h, 'auto');
  } catch (e) {
    clearInterval(timer);
    const loading = $('#loading'); if (loading) loading.remove();
    $('#list').innerHTML = `<div class="state"><h2>Menu gagal dimuat</h2><p>${esc(e.message || 'Terjadi kesalahan.')}</p><button class="btn" type="button" id="retry">Muat ulang</button></div>`;
    $('#retry').addEventListener('click', () => location.reload());
  }
}
start();
