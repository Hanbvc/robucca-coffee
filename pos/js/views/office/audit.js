/* Log aktivitas: void, refund, diskon disetujui, shift, kas, stok, & perubahan pengaturan. */
import { S, master } from '../../state.js';
import { $, esc, icon } from '../../lib/ui.js';
import { rp } from '../../core/money.js';
import { dateTime, rangeLabel } from '../../core/dates.js';
import { filterBar, wireFilters, range, branchIds, scopeLabel, pageHead, branchName, exportCSV } from './common.js';

const LABEL = {
  'order.void': ['Void transaksi', 'red'], 'order.refund': ['Refund', 'red'], 'line.void': ['Batal item', 'red'],
  'discount.approve': ['Diskon disetujui', 'amber'], 'shift.open': ['Buka shift', 'green'], 'shift.close': ['Tutup shift', 'green'],
  'cash.in': ['Kas masuk', 'blue'], 'cash.out': ['Kas keluar', 'blue'], 'master.save': ['Ubah data', ''], 'master.delete': ['Hapus data', ''],
  'stock.receive': ['Stok masuk', 'blue'], 'stock.adjust': ['Opname', 'blue'], 'stock.waste': ['Barang rusak', 'blue'], 'stock.transfer': ['Transfer stok', 'blue'],
  'device.pair': ['Pasang perangkat', ''], 'device.revoke': ['Cabut perangkat', 'red'], 'office.docs': ['Data dari kantor', ''],
};
const COLL = { items: 'menu', categories: 'kategori', itemBranch: 'menu cabang', branches: 'cabang', staff: 'karyawan', discounts: 'promo', settings: 'pengaturan', channels: 'tipe pesanan', payMethods: 'metode bayar' };

function detail(a) {
  const d = a.detail || {};
  switch (a.action) {
    case 'order.void': return `${esc(d.number)} · ${rp(d.total || 0)} · “${esc(d.reason)}”${d.cashier ? ` · kasir ${esc(d.cashier)}` : ''}`;
    case 'order.refund': return `${esc(d.number)} · ${rp(d.total || 0)} · “${esc(d.reason)}”`;
    case 'line.void': return `${esc(d.number || '')} · ${d.qty}x ${esc(d.item)} · “${esc(d.reason)}”`;
    case 'discount.approve': return esc(d.promo || `${d.type === 'pct' ? `${d.value}%` : rp(d.value || 0)}`);
    case 'shift.open': return `Kas awal ${rp(d.openingCash || 0)}`;
    case 'shift.close': return `Seharusnya ${rp(d.expected || 0)} · dihitung ${rp(d.counted || 0)} · selisih ${rp(d.difference || 0)}${d.note ? ` · “${esc(d.note)}”` : ''}`;
    case 'cash.in': case 'cash.out': return `${rp(d.amount || 0)} · ${esc(d.reason)}`;
    case 'master.save': case 'master.delete': return `${esc(COLL[d.coll] || d.coll)}: ${esc(d.name || d.id || '')}`;
    default: return esc(Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')).slice(0, 200);
  }
}

export async function mount(el) {
  let rows = [];
  el.innerHTML = '<div id="a-head"></div><div class="page"><div id="a-f"></div><div class="table-card" id="a-t"></div></div>';
  async function load() {
    const r = range();
    $('#a-head', el).innerHTML = pageHead('Log aktivitas', `${esc(scopeLabel())} · ${esc(rangeLabel(r))}`, `<button class="btn ghost sm" data-csv>${icon('download', 'sm')} Ekspor CSV</button>`);
    $('#a-f', el).innerHTML = filterBar();
    rows = await S.be.auditQuery({ ...r, branchIds: branchIds() });
    $('#a-t', el).innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Waktu</th><th>Cabang</th><th>Oleh</th><th>Aktivitas</th><th>Detail</th></tr></thead><tbody>
      ${rows.length ? rows.map((a) => { const l = LABEL[a.action] || [a.action, '']; return `<tr><td class="n">${dateTime(a.at, (master().branch[a.branchId] || {}).tz)}</td><td>${a.branchId ? esc(branchName(a.branchId)) : 'Pusat'}</td><td>${esc(a.byName || '-')}</td><td><span class="tag ${l[1]}">${esc(l[0])}</span></td><td>${detail(a)}</td></tr>`; }).join('')
        : '<tr><td colspan="5" class="muted" style="text-align:center;padding:28px">Belum ada aktivitas.</td></tr>'}</tbody></table></div>`;
  }
  wireFilters(el, load);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-csv]')) exportCSV('log', rows, [{ label: 'Waktu', get: (a) => dateTime(a.at, (master().branch[a.branchId] || {}).tz) }, { label: 'Cabang', get: (a) => (a.branchId ? branchName(a.branchId) : 'Pusat') }, { label: 'Oleh', key: 'byName' }, { label: 'Aktivitas', get: (a) => (LABEL[a.action] || [a.action])[0] }, { label: 'Detail', get: (a) => detail(a).replace(/&[a-z#0-9]+;/g, '') }]);
  });
  await load();
}
