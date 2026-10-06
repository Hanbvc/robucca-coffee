/* Laporan: ringkasan, menu, kategori, pembayaran, tipe pesanan, kasir, harian/pajak, void & refund. */
import { S, master } from '../../state.js';
import { $, esc, icon } from '../../lib/ui.js';
import { rp, num } from '../../core/money.js';
import { dateLabel, dateTime, rangeLabel } from '../../core/dates.js';
import { filterBar, wireFilters, range, branchIds, scopeLabel, pageHead, demoNote, sortableTable, exportCSV, branchName } from './common.js';
import { printHTML } from '../../components/receipt.js';

const TABS = [
  ['ringkasan', 'Ringkasan'], ['menu', 'Per menu'], ['kategori', 'Per kategori'], ['bayar', 'Pembayaran'],
  ['tipe', 'Tipe pesanan'], ['kasir', 'Per kasir'], ['harian', 'Harian & pajak'], ['cabang', 'Per cabang'], ['batal', 'Void & refund'],
];

export async function mount(el) {
  let tab = sessionStorage.getItem('pos:report:tab') || 'ringkasan';
  let data = null; let seq = 0;
  el.innerHTML = '<div id="r-head"></div><div class="page"><div id="r-filters"></div><div class="tabs" id="r-tabs" role="tablist"></div><div id="r-body"></div></div>';

  async function load() {
    const my = ++seq; const r = range();
    $('#r-head', el).innerHTML = pageHead('Laporan', `${esc(scopeLabel())} · ${esc(rangeLabel(r))}`, `<button class="btn ghost sm" data-print>${icon('printer', 'sm')} Cetak</button><button class="btn sm" data-csv>${icon('download', 'sm')} Ekspor CSV</button>`);
    $('#r-filters', el).innerHTML = filterBar() + demoNote();
    $('#r-body', el).style.opacity = '.5';
    const d = await S.be.report({ ...r, branchIds: branchIds() });
    if (my !== seq) return;
    data = d; $('#r-body', el).style.opacity = '';
    render();
  }

  function views() {
    const d = data; const k = d.kpi; const pct = (v, t) => (t ? `${Math.round((v / t) * 1000) / 10}%` : '0%');
    const sales = d.items.reduce((a, x) => a + x.amount, 0);
    return {
      ringkasan: {
        cols: [{ key: 'l', label: 'Keterangan', get: (r) => r.l }, { key: 'v', label: 'Nilai', r: true, get: (r) => r.v, sort: (r) => r.n }],
        rows: [
          { l: 'Penjualan kotor (harga menu)', v: rp(k.gross), n: k.gross },
          { l: 'Diskon', v: `−${rp(k.discount)}`, n: -k.discount },
          { l: 'Penjualan bersih (tanpa pajak & servis)', v: rp(k.net), n: k.net },
          { l: 'Biaya layanan', v: rp(k.service), n: k.service },
          { l: 'Pajak (PB1)', v: rp(k.tax), n: k.tax },
          { l: 'Pembulatan', v: rp(k.rounding), n: k.rounding },
          { l: 'Total diterima (omzet)', v: rp(k.total), n: k.total },
          { l: 'Jumlah transaksi', v: num(k.orders), n: k.orders },
          { l: 'Rata-rata per transaksi', v: rp(k.avg), n: k.avg },
          { l: 'Item terjual', v: num(k.items), n: k.items },
          { l: `Refund (${k.refunds} transaksi, sudah dikurangkan)`, v: `−${rp(k.refundTotal)}`, n: -k.refundTotal },
          { l: `Void (${k.voids} transaksi, tidak dihitung)`, v: rp(k.voidTotal), n: k.voidTotal },
        ],
        note: 'Semua angka sudah dikurangi refund pada tanggal refund dilakukan. Transaksi void tidak termasuk penjualan.',
        noSort: true,
      },
      menu: {
        cols: [
          { key: 'name', label: 'Menu', get: (r) => r.name },
          { key: 'cat', label: 'Kategori', get: (r) => (master().cat[r.catId] || {}).name || r.catId || '' },
          { key: 'qty', label: 'Terjual', r: true, get: (r) => num(r.qty), sort: (r) => r.qty },
          { key: 'gross', label: 'Kotor', r: true, get: (r) => rp(r.gross), sort: (r) => r.gross },
          { key: 'disc', label: 'Diskon', r: true, get: (r) => rp(r.disc), sort: (r) => r.disc },
          { key: 'amount', label: 'Penjualan', r: true, get: (r) => rp(r.amount), sort: (r) => r.amount },
          { key: 'share', label: 'Porsi', r: true, get: (r) => pct(r.amount, sales), sort: (r) => r.amount },
        ],
        rows: d.items, sortKey: 'amount',
        foot: ['Total', '', num(d.items.reduce((a, x) => a + x.qty, 0)), rp(d.items.reduce((a, x) => a + x.gross, 0)), rp(d.items.reduce((a, x) => a + x.disc, 0)), rp(sales), '100%'],
        note: 'Penjualan per menu = harga menu setelah diskon (termasuk pajak bila harga sudah termasuk pajak).',
      },
      kategori: {
        cols: [{ key: 'name', label: 'Kategori', get: (r) => r.name }, { key: 'qty', label: 'Terjual', r: true, get: (r) => num(r.qty), sort: (r) => r.qty }, { key: 'amount', label: 'Penjualan', r: true, get: (r) => rp(r.amount), sort: (r) => r.amount }, { key: 'share', label: 'Porsi', r: true, get: (r) => pct(r.amount, sales), sort: (r) => r.amount }],
        rows: d.categories, sortKey: 'amount',
      },
      bayar: {
        cols: [{ key: 'name', label: 'Metode', get: (r) => r.name }, { key: 'count', label: 'Transaksi', r: true, get: (r) => num(r.count), sort: (r) => r.count }, { key: 'amount', label: 'Nominal', r: true, get: (r) => rp(r.amount), sort: (r) => r.amount }, { key: 'share', label: 'Porsi', r: true, get: (r) => pct(r.amount, k.total), sort: (r) => r.amount }],
        rows: d.payments, sortKey: 'amount', foot: ['Total', num(d.payments.reduce((a, x) => a + x.count, 0)), rp(d.payments.reduce((a, x) => a + x.amount, 0)), ''],
        note: 'Gunakan untuk mencocokkan setoran: tunai dengan laporan shift, QRIS/kartu dengan mutasi bank, ojol dengan laporan mitra.',
      },
      tipe: {
        cols: [{ key: 'name', label: 'Tipe pesanan', get: (r) => r.name }, { key: 'orders', label: 'Transaksi', r: true, get: (r) => num(r.orders), sort: (r) => r.orders }, { key: 'total', label: 'Omzet', r: true, get: (r) => rp(r.total), sort: (r) => r.total }, { key: 'share', label: 'Porsi', r: true, get: (r) => pct(r.total, k.total), sort: (r) => r.total }],
        rows: d.channels, sortKey: 'total',
      },
      kasir: {
        cols: [{ key: 'name', label: 'Kasir', get: (r) => r.name }, { key: 'orders', label: 'Transaksi', r: true, get: (r) => num(r.orders), sort: (r) => r.orders }, { key: 'total', label: 'Omzet', r: true, get: (r) => rp(r.total), sort: (r) => r.total }, { key: 'avg', label: 'Rata-rata', r: true, get: (r) => rp(r.orders ? Math.round(r.total / r.orders) : 0), sort: (r) => (r.orders ? r.total / r.orders : 0) }],
        rows: d.cashiers, sortKey: 'total',
      },
      harian: {
        cols: [{ key: 'date', label: 'Tanggal', get: (r) => dateLabel(r.date), sort: (r) => r.date }, { key: 'orders', label: 'Transaksi', r: true, get: (r) => num(r.orders), sort: (r) => r.orders }, { key: 'net', label: 'Bersih (DPP)', r: true, get: (r) => rp(r.net), sort: (r) => r.net }, { key: 'tax', label: 'Pajak', r: true, get: (r) => rp(r.tax), sort: (r) => r.tax }, { key: 'total', label: 'Omzet', r: true, get: (r) => rp(r.total), sort: (r) => r.total }],
        rows: d.days, sortKey: 'date', desc: false,
        foot: ['Total', num(k.orders), rp(k.net), rp(k.tax), rp(k.total)],
        note: 'DPP = dasar pengenaan pajak (penjualan bersih tanpa pajak, sebelum biaya layanan). Cocokkan dengan ketentuan PBJT/PB1 daerah masing-masing cabang.',
      },
      cabang: {
        cols: [{ key: 'name', label: 'Cabang', get: (r) => r.name }, { key: 'orders', label: 'Transaksi', r: true, get: (r) => num(r.orders), sort: (r) => r.orders }, { key: 'items', label: 'Item', r: true, get: (r) => num(r.items), sort: (r) => r.items }, { key: 'net', label: 'Bersih', r: true, get: (r) => rp(r.net), sort: (r) => r.net }, { key: 'total', label: 'Omzet', r: true, get: (r) => rp(r.total), sort: (r) => r.total }, { key: 'avg', label: 'Rata-rata', r: true, get: (r) => rp(r.orders ? Math.round(r.total / r.orders) : 0), sort: (r) => (r.orders ? r.total / r.orders : 0) }],
        rows: d.branches, sortKey: 'total',
      },
      batal: {
        cols: [
          { key: 'type', label: 'Jenis', get: (r) => (r.refOf ? 'Refund' : 'Void') },
          { key: 'number', label: 'Nomor', get: (r) => r.refNumber || r.number },
          { key: 'branch', label: 'Cabang', get: (r) => branchName(r.branchId) },
          { key: 'at', label: 'Waktu', get: (r) => dateTime(r.at, (master().branch[r.branchId] || {}).tz), sort: (r) => r.at },
          { key: 'by', label: 'Oleh', get: (r) => r.by },
          { key: 'reason', label: 'Alasan', get: (r) => r.reason },
          { key: 'total', label: 'Nominal', r: true, get: (r) => rp(Math.abs(r.total)), sort: (r) => Math.abs(r.total) },
        ],
        rows: [...d.voids, ...d.refunds], sortKey: 'at',
        note: 'Pantau void & refund per kasir/cabang. Setiap void & refund wajib alasan dan persetujuan PIN manajer.',
      },
    };
  }

  function render() {
    $('#r-tabs', el).innerHTML = TABS.map(([id, l]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}" role="tab" aria-selected="${tab === id}">${l}</button>`).join('');
    const v = views()[tab];
    $('#r-body', el).innerHTML = `${v.note ? `<p class="hint" style="margin:0 0 10px">${esc(v.note)}</p>` : ''}<div class="table-card" id="r-table"></div>`;
    sortableTable($('#r-table', el), v.cols, v.rows, { sortKey: v.noSort ? null : v.sortKey, desc: v.desc !== false, foot: v.foot });
  }

  wireFilters(el, load);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; sessionStorage.setItem('pos:report:tab', tab); render(); return; }
    if (!data) return;
    const v = views()[tab];
    if (e.target.closest('[data-csv]')) exportCSV(`laporan-${tab}`, v.rows, v.cols.map((c) => ({ label: c.label, get: (r) => (c.sort && typeof c.sort(r) === 'number' && c.key !== 'share' ? c.sort(r) : c.get(r)) })));
    if (e.target.closest('[data-print]')) {
      const r = range();
      printHTML(`<div class="c b">${esc(master().settings.orgName)} — LAPORAN ${esc(TABS.find((x) => x[0] === tab)[1].toUpperCase())}</div><div class="c">${esc(scopeLabel())}</div><div class="c">${esc(rangeLabel(r))}</div><hr>
        ${v.rows.map((row) => `<div class="r"><span>${esc(v.cols[0].get(row))}</span><span>${esc(v.cols[v.cols.length - (tab === 'menu' || tab === 'kategori' || tab === 'bayar' || tab === 'tipe' ? 2 : 1)].get(row))}</span></div>`).join('')}<hr>`, { paper: 80, title: 'Laporan' });
    }
  });
  await load();
}
