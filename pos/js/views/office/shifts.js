/* Rekap shift kasir semua cabang: kas awal, kas seharusnya, kas dihitung, selisih. */
import { S, master } from '../../state.js';
import { $, esc, icon, drawer } from '../../lib/ui.js';
import { rp, num } from '../../core/money.js';
import { dateTime, clock, rangeLabel } from '../../core/dates.js';
import { filterBar, wireFilters, range, branchIds, scopeLabel, pageHead, demoNote, branchName, exportCSV } from './common.js';
import { shiftHTML, printHTML } from '../../components/receipt.js';

export async function mount(el) {
  let rows = [];
  el.innerHTML = '<div id="s-head"></div><div class="page"><div id="s-filters"></div><div id="s-sum"></div><div class="table-card" id="s-table"></div></div>';

  async function load() {
    const r = range();
    $('#s-head', el).innerHTML = pageHead('Shift kasir', `${esc(scopeLabel())} · ${esc(rangeLabel(r))}`, `<button class="btn ghost sm" data-csv>${icon('download', 'sm')} Ekspor CSV</button>`);
    $('#s-filters', el).innerHTML = filterBar() + demoNote();
    rows = await S.be.shiftsQuery({ ...r, branchIds: branchIds() });
    render();
  }
  const tzOf = (s) => (master().branch[s.branchId] || {}).tz;
  function render() {
    const closed = rows.filter((s) => s.status === 'closed');
    const diff = closed.reduce((a, s) => a + (s.difference || 0), 0);
    const off = closed.filter((s) => s.difference);
    $('#s-sum', el).innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-label">Shift</div><div class="k-value">${num(rows.length)}</div><div class="k-sub">${rows.length - closed.length} masih terbuka</div></div>
      <div class="kpi"><div class="k-label">Shift dengan selisih kas</div><div class="k-value">${num(off.length)}</div><div class="k-sub">dari ${closed.length} shift ditutup</div></div>
      <div class="kpi"><div class="k-label">Total selisih kas</div><div class="k-value ${diff < 0 ? 'neg' : ''}">${diff > 0 ? '+' : ''}${rp(diff)}</div><div class="k-sub">negatif = uang kurang</div></div>
    </div>`;
    $('#s-table', el).innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Cabang</th><th>Terminal</th><th>Dibuka</th><th>Ditutup</th><th class="r">Kas awal</th><th class="r">Penjualan</th><th class="r">Kas seharusnya</th><th class="r">Kas dihitung</th><th class="r">Selisih</th></tr></thead><tbody>
      ${rows.length ? rows.map((s) => `<tr class="click" data-id="${s.id}"><td>${esc(branchName(s.branchId))}</td><td>T${s.terminalNo || '-'}</td>
        <td class="n">${dateTime(s.openedAt, tzOf(s))}<span class="sub">${esc(s.openedByName || '')}</span></td>
        <td class="n">${s.closedAt ? `${dateTime(s.closedAt, tzOf(s))}<span class="sub">${esc(s.closedByName || '')}</span>` : '<span class="tag green"><span class="dot"></span>Terbuka</span>'}</td>
        <td class="r">${rp(s.openingCash)}</td><td class="r">${s.summary ? rp(s.summary.total) : '—'}</td>
        <td class="r">${s.expectedCash != null ? rp(s.expectedCash) : '—'}</td><td class="r">${s.countedCash != null ? rp(s.countedCash) : '—'}</td>
        <td class="r ${s.difference < 0 ? 'neg' : s.difference > 0 ? 'pos' : ''}">${s.status === 'closed' ? `${s.difference > 0 ? '+' : ''}${rp(s.difference || 0)}` : '—'}</td></tr>`).join('')
        : '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Belum ada shift pada periode ini.</td></tr>'}</tbody></table></div>`;
  }
  async function open(id) {
    const s = rows.find((x) => x.id === id); if (!s) return;
    const moves = await S.be.cashMovesOf(s.id).catch(() => []);
    const b = master().branch[s.branchId];
    const sum = s.summary;
    drawer({
      title: `Shift T${s.terminalNo} · ${branchName(s.branchId)}`, sub: `${dateTime(s.openedAt, tzOf(s))}${s.closedAt ? ` – ${clock(s.closedAt, tzOf(s))}` : ' · masih terbuka'}`,
      body: `${sum ? `<div class="mini-stats"><div class="mini"><small>Transaksi</small><b>${num(sum.count)}</b></div><div class="mini"><small>Penjualan</small><b>${rp(sum.total)}</b></div><div class="mini"><small>Tunai masuk</small><b>${rp(sum.cashSales)}</b></div></div>
          <h3 class="card-title" style="margin-top:16px">Per metode</h3>${sum.byMethod.map((p) => `<div class="sum-row" style="padding:5px 0"><span>${esc(p.name)}</span><b>${rp(p.amount)}</b></div>`).join('')}` : '<p class="muted">Ringkasan tersedia setelah shift ditutup.</p>'}
        <h3 class="card-title" style="margin-top:16px">Kas masuk & keluar</h3>
        ${moves.length ? moves.map((m) => `<div class="sum-row" style="padding:5px 0"><span>${clock(m.at, tzOf(s))} · ${esc(m.reason)} <span class="muted">(${esc(m.byName || '')})</span></span><b class="${m.type === 'in' ? 'pos' : 'neg'}">${m.type === 'in' ? '+' : '−'}${rp(m.amount)}</b></div>`).join('') : '<p class="muted">Tidak ada.</p>'}
        ${s.note ? `<div class="note" style="margin-top:14px">${icon('note', 'sm')}<span>${esc(s.note)}</span></div>` : ''}`,
      foot: sum ? `<button class="btn ghost" data-pr>${icon('printer', 'sm')} Cetak laporan</button>` : '',
    }).el.addEventListener('click', (e) => { if (e.target.closest('[data-pr]')) printHTML(shiftHTML(s, sum, { branch: b, settings: master().settings }), { paper: (b && b.paper) || 80, title: 'Laporan shift' }); });
  }

  wireFilters(el, load);
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (tr) { open(tr.dataset.id); return; }
    if (e.target.closest('[data-csv]')) {
      exportCSV('shift', rows, [
        { label: 'Cabang', get: (s) => branchName(s.branchId) }, { label: 'Terminal', key: 'terminalNo' }, { label: 'Tanggal', key: 'bizDate' },
        { label: 'Dibuka', get: (s) => dateTime(s.openedAt, tzOf(s)) }, { label: 'Dibuka oleh', key: 'openedByName' },
        { label: 'Ditutup', get: (s) => (s.closedAt ? dateTime(s.closedAt, tzOf(s)) : '') }, { label: 'Ditutup oleh', key: 'closedByName' },
        { label: 'Kas awal', key: 'openingCash' }, { label: 'Penjualan', get: (s) => (s.summary ? s.summary.total : '') },
        { label: 'Kas seharusnya', key: 'expectedCash' }, { label: 'Kas dihitung', key: 'countedCash' }, { label: 'Selisih', key: 'difference' }, { label: 'Catatan', key: 'note' },
      ]);
    }
  });
  await load();
}
