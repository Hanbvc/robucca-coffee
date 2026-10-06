/* Tagihan terbuka (pesanan sudah dikirim ke dapur, belum dibayar). */
import { S, branch, settings, nav } from '../state.js';
import { $, esc, icon, debounce } from '../lib/ui.js';
import { rp } from '../core/money.js';
import { ago, clock } from '../core/dates.js';
import { printHTML, receiptHTML, ticketHTML } from '../components/receipt.js';
import { bus } from '../data/bus.js';

export async function mount(el) {
  const b = branch(); let q = '';
  el.innerHTML = `<div class="topbar"><div><h1>Tagihan terbuka</h1><div class="crumb">Pesanan yang sudah dikirim ke dapur dan belum dibayar · semua terminal ${esc(b.name)}</div></div>
      <div class="right row"><div class="input-wrap" style="width:260px">${icon('search', 'sm')}<input class="input" id="b-q" type="search" placeholder="Cari meja, nama, nomor" autocomplete="off"></div>
      <button class="btn" data-a="new">${icon('plus', 'sm')} Pesanan baru</button></div></div>
    <div class="page" id="b-list"></div>`;
  const list = $('#b-list', el);

  async function render() {
    let rows = (await S.be.openOrders(b.id)).sort((a, x) => a.createdAt - x.createdAt);
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((o) => [o.number, o.queueNo, o.table, o.customer && o.customer.name].some((x) => String(x || '').toLowerCase().includes(s)));
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><div class="em-ico">${icon('pause', 'lg')}</div><h3>${q ? 'Tidak ditemukan' : 'Tidak ada tagihan terbuka'}</h3><p>Tekan <b>Simpan</b> di layar kasir untuk menyimpan pesanan dine-in yang dibayar belakangan.</p></div>`;
      return;
    }
    list.innerHTML = `<div class="list">${rows.map((o) => `<div class="li" style="grid-template-columns:auto minmax(0,1fr) auto auto">
        <span class="lq">${esc(o.queueNo)}</span>
        <div><b>${o.table ? `Meja ${esc(o.table)}` : esc((o.customer && o.customer.name) || 'Tanpa nama')}${o.table && o.customer && o.customer.name ? ` · ${esc(o.customer.name)}` : ''}</b>
          <small>${esc(o.channelName || '')} · ${o.totals.items} item · ${esc(o.number)} · T${o.terminalNo} · ${esc(o.cashierName || '')} · ${clock(o.createdAt, b.tz)} (${ago(Date.now() - o.createdAt)})</small></div>
        <span class="amt">${rp(o.totals.total)}</span>
        <div class="row"><button class="icon-btn" data-pre="${o.id}" title="Cetak tagihan">${icon('printer', 'sm')}</button><button class="icon-btn" data-tk="${o.id}" title="Cetak tiket dapur">${icon('chef', 'sm')}</button><button class="btn sm" data-open="${o.id}">Buka ${icon('arrow-right', 'xs')}</button></div>
      </div>`).join('')}</div>`;
  }

  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-a="new"]')) { nav('kasir'); return; }
    const op = e.target.closest('[data-open]'); if (op) { nav(`kasir?bill=${op.dataset.open}`); return; }
    const pre = e.target.closest('[data-pre]');
    if (pre) { const o = await S.be.get('orders', pre.dataset.pre); printHTML(`<div class="c b">TAGIHAN (BELUM DIBAYAR)</div>${receiptHTML(o, { branch: b, settings: settings() })}`, { paper: b.paper, title: o.number }); return; }
    const tk = e.target.closest('[data-tk]');
    if (tk) { const o = await S.be.get('orders', tk.dataset.tk); printHTML(ticketHTML(o, o.lines.filter((l) => !l.voided && l.kAt), { branch: b }), { paper: b.paper, title: o.number }); }
  });
  $('#b-q', el).addEventListener('input', debounce((e) => { q = e.target.value; render(); }, 150));
  await render();
  const t = setInterval(render, 30000);
  const off = bus.on('orders', render);
  return () => { off(); clearInterval(t); };
}
