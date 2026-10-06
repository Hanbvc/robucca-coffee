/* Riwayat transaksi cabang (hari ini & kemarin) di perangkat kasir. */
import { S, branch, today } from '../state.js';
import { $, esc, icon, debounce } from '../lib/ui.js';
import { rp } from '../core/money.js';
import { clock, addDays } from '../core/dates.js';
import { detailHTML, actionsHTML, wireActions, statusTag } from '../components/orderDetail.js';
import { bus } from '../data/bus.js';

export async function mount(el) {
  const b = branch();
  let day = today(); let filter = ''; let q = ''; let sel = null; let rows = [];
  el.innerHTML = `<div class="topbar"><div><h1>Riwayat transaksi</h1><div class="crumb">${esc(b.name)} · semua terminal</div></div></div>
    <div class="page">
      <div class="filters">
        <div class="seg" id="h-day"><button data-day="${today()}">Hari ini</button><button data-day="${addDays(today(), -1)}">Kemarin</button></div>
        <span class="sep"></span>
        <div class="seg" id="h-f"><button data-f="">Semua</button><button data-f="paid">Lunas</button><button data-f="open">Belum bayar</button><button data-f="void">Void</button><button data-f="refund">Refund</button></div>
        <div class="input-wrap right" style="width:240px">${icon('search', 'sm')}<input class="input sm" id="h-q" type="search" placeholder="Nomor, nama, meja" autocomplete="off"></div>
      </div>
      <div class="two-col">
        <div id="h-list"></div>
        <div class="card pad sticky" id="h-detail"></div>
      </div>
    </div>`;

  const paintSeg = () => {
    el.querySelectorAll('[data-day]').forEach((x) => x.classList.toggle('on', x.dataset.day === day));
    el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x.dataset.f === filter));
  };
  async function load() {
    rows = (await S.be.ordersOf(b.id, day, day)).sort((a, x) => (x.paidAt || x.createdAt) - (a.paidAt || a.createdAt));
    render();
  }
  function render() {
    paintSeg();
    let list = rows;
    if (filter === 'refund') list = list.filter((o) => o.kind === 'refund');
    else if (filter) list = list.filter((o) => o.kind === 'sale' && o.status === filter);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((o) => [o.number, o.queueNo, o.table, o.customer && o.customer.name, o.cashierName].some((x) => String(x || '').toLowerCase().includes(s)));
    const paid = rows.filter((o) => o.kind === 'sale' && (o.status === 'paid' || o.status === 'refunded'));
    const total = rows.filter((o) => o.status !== 'void' && o.status !== 'open').reduce((a, o) => a + o.totals.total, 0);
    $('#h-list', el).innerHTML = `<div class="mini-stats" style="margin-bottom:12px"><div class="mini"><small>Transaksi</small><b>${paid.length}</b></div><div class="mini"><small>Penjualan</small><b>${rp(total)}</b></div><div class="mini"><small>Void</small><b>${rows.filter((o) => o.status === 'void').length}</b></div></div>
      ${list.length ? `<div class="list">${list.slice(0, 300).map((o) => `<button class="li ${sel === o.id ? 'on' : ''}" data-o="${o.id}">
        <span class="lq">${esc(o.queueNo || '—')}</span>
        <div><b>${esc(o.number)} ${statusTag(o)}</b><small>${clock(o.paidAt || o.createdAt, b.tz)} · ${esc(o.channelName || '')}${o.table ? ` · Meja ${esc(o.table)}` : ''}${o.customer && o.customer.name ? ` · ${esc(o.customer.name)}` : ''} · ${esc(o.cashierName || '')}${o.demo ? ' · contoh' : ''}</small></div>
        <span class="amt ${o.status === 'void' ? 'muted' : ''}">${o.status === 'void' ? `<s>${rp(o.totals.total)}</s>` : rp(o.totals.total)}</span></button>`).join('')}</div>`
        : `<div class="empty"><div class="em-ico">${icon('receipt', 'lg')}</div><h3>Belum ada transaksi</h3></div>`}`;
    renderDetail();
  }
  function renderDetail() {
    const box = $('#h-detail', el);
    const o = rows.find((x) => x.id === sel);
    if (!o) { box.innerHTML = `<div class="empty" style="padding:30px 10px"><div class="em-ico">${icon('receipt', 'lg')}</div><p>Pilih transaksi untuk melihat struk.</p></div>`; return; }
    box.innerHTML = `${detailHTML(o)}<div class="row wrap" style="margin-top:14px;gap:8px">${actionsHTML(o)}</div>`;
  }
  wireActions(el, () => rows.find((x) => x.id === sel), load);

  el.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]'); if (d) { day = d.dataset.day; sel = null; load(); return; }
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; render(); return; }
    const r = e.target.closest('[data-o]'); if (r) { sel = r.dataset.o; render(); }
  });
  $('#h-q', el).addEventListener('input', debounce((e) => { q = e.target.value; render(); }, 150));
  await load();
  const off = bus.on('orders', load);
  return () => off();
}
