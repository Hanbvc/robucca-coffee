/* Daftar transaksi semua cabang dengan detail struk, cetak ulang, dan refund. */
import { S, master } from '../../state.js';
import { $, esc, icon, drawer, debounce } from '../../lib/ui.js';
import { rp } from '../../core/money.js';
import { dateTime, rangeLabel } from '../../core/dates.js';
import { detailHTML, actionsHTML, runAction, statusTag } from '../../components/orderDetail.js';
import { filterBar, wireFilters, range, branchIds, scopeLabel, pageHead, branchName, exportCSV, demoNote } from './common.js';

const PAGE = 50;

export async function mount(el) {
  let status = ''; let q = ''; let offset = 0; let data = { total: 0, rows: [] };
  el.innerHTML = '<div id="t-head"></div><div class="page"><div id="t-filters"></div><div class="table-card" id="t-table"></div></div>';

  function paintFilters() {
    const r = range();
    $('#t-head', el).innerHTML = pageHead('Transaksi', `${esc(scopeLabel())} · ${esc(rangeLabel(r))}`, `<button class="btn ghost sm" data-csv>${icon('download', 'sm')} Ekspor CSV</button>`);
    $('#t-filters', el).innerHTML = filterBar({
      extra: `<span class="sep"></span><select class="select sm" data-status aria-label="Status">
        ${[['', 'Semua status'], ['paid', 'Lunas'], ['open', 'Belum dibayar'], ['void', 'Void'], ['refunded', 'Direfund'], ['refund', 'Dokumen refund']].map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select><div class="input-wrap right" style="width:240px">${icon('search', 'sm')}<input class="input sm" data-q type="search" placeholder="Nomor, nama, meja, kasir" value="${esc(q)}" autocomplete="off"></div>`,
    }) + demoNote();
  }
  async function load() {
    const r = range();
    $('#t-table', el).style.opacity = '.5';
    data = await S.be.ordersQuery({ ...r, branchIds: branchIds(), status, q, limit: PAGE, offset });
    $('#t-table', el).style.opacity = '';
    render();
  }

  function render() {
    const rows = data.rows;
    $('#t-table', el).innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Nomor</th><th>Waktu</th><th>Cabang</th><th>Kasir</th><th>Tipe</th><th>Pembayaran</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>
      ${rows.length ? rows.map((o) => `<tr class="click" data-id="${o.id}">
        <td><b>${esc(o.number)}</b>${o.queueNo && o.kind === 'sale' ? `<span class="sub">antrean ${esc(o.queueNo)}</span>` : ''}</td>
        <td class="n">${dateTime(o.paidAt || o.createdAt, (master().branch[o.branchId] || {}).tz)}</td>
        <td>${esc(branchName(o.branchId))}</td><td>${esc(o.cashierName || '-')}</td>
        <td>${esc(o.channelName || o.channel || '')}${o.table ? `<span class="sub">Meja ${esc(o.table)}</span>` : ''}</td>
        <td>${esc((o.payments || []).map((p) => p.name).join(' + ') || '—')}</td>
        <td class="r">${o.status === 'void' ? `<s class="muted">${rp(o.totals.total)}</s>` : rp(o.totals.total)}</td>
        <td>${statusTag(o)}</td></tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">Tidak ada transaksi.</td></tr>'}
      </tbody></table></div>
      <div class="pager"><span>${data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} dari ${data.total} transaksi` : ''}</span>
        <div class="row"><button class="btn ghost sm" data-pg="-1" ${offset ? '' : 'disabled'}>${icon('chevron-left', 'sm')} Sebelumnya</button><button class="btn ghost sm" data-pg="1" ${offset + PAGE < data.total ? '' : 'disabled'}>Berikutnya ${icon('chevron-right', 'sm')}</button></div></div>`;
  }

  async function open(id) {
    let o = data.rows.find((x) => x.id === id) || await S.be.orderById(id);
    if (!o) return;
    const d = drawer({ title: o.number, sub: `${esc(branchName(o.branchId))} · ${dateTime(o.paidAt || o.createdAt, (master().branch[o.branchId] || {}).tz)}`, body: detailHTML(o), foot: actionsHTML(o) });
    d.el.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-od]'); if (!x) return;
      if (await runAction(x.dataset.od, o)) {
        o = (await S.be.orderById(o.id)) || o;
        d.setBody(detailHTML(o)); d.setFoot(actionsHTML(o));
        load();
      }
    });
  }

  wireFilters(el, () => { offset = 0; paintFilters(); load(); });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-status]')) { status = e.target.value; offset = 0; load(); } });
  el.addEventListener('input', debounce((e) => { if (e.target.matches('[data-q]')) { q = e.target.value; offset = 0; load(); } }, 300));
  el.addEventListener('click', async (e) => {
    const pg = e.target.closest('[data-pg]'); if (pg) { offset = Math.max(0, offset + +pg.dataset.pg * PAGE); load(); return; }
    const tr = e.target.closest('tr[data-id]'); if (tr) { open(tr.dataset.id); return; }
    if (e.target.closest('[data-csv]')) {
      const all = await S.be.ordersQuery({ ...range(), branchIds: branchIds(), status, q, limit: 100000, offset: 0 });
      exportCSV('transaksi', all.rows, [
        { label: 'Nomor', key: 'number' }, { label: 'Jenis', get: (o) => (o.kind === 'refund' ? 'Refund' : 'Penjualan') },
        { label: 'Status', key: 'status' }, { label: 'Tanggal bisnis', key: 'bizDate' },
        { label: 'Waktu', get: (o) => dateTime(o.paidAt || o.createdAt, (master().branch[o.branchId] || {}).tz) },
        { label: 'Cabang', get: (o) => branchName(o.branchId) }, { label: 'Terminal', key: 'terminalNo' }, { label: 'Kasir', key: 'cashierName' },
        { label: 'Tipe', key: 'channelName' }, { label: 'Meja', key: 'table' }, { label: 'Pelanggan', get: (o) => (o.customer && o.customer.name) || '' },
        { label: 'Item', get: (o) => o.totals.items }, { label: 'Kotor', get: (o) => o.totals.gross }, { label: 'Diskon', get: (o) => o.totals.discount },
        { label: 'Bersih', get: (o) => o.totals.net }, { label: 'Layanan', get: (o) => o.totals.service }, { label: 'Pajak', get: (o) => o.totals.tax },
        { label: 'Pembulatan', get: (o) => o.totals.rounding }, { label: 'Total', get: (o) => o.totals.total },
        { label: 'Pembayaran', get: (o) => (o.payments || []).map((p) => `${p.name}:${p.amount}`).join(' + ') },
        { label: 'Alasan void/refund', get: (o) => o.voidReason || o.refundReason || o.reason || '' },
      ]);
    }
  });
  paintFilters();
  await load();
}
