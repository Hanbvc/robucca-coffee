/* Laporan: ringkasan, menu, kategori, pembayaran, tipe pesanan, kasir, harian/pajak, cabang, void & refund. */
import { dateLabel, dateTime, num, rp } from '@robucca/core';
import { useState } from 'react';
import { printHTML, esc } from '../../components/receipt';
import { Icon } from '../../lib/icons';
import { ss } from '../../lib/store';
import { settings } from '../../state';
import { toast } from '../../ui/overlay';
import { branchName, csv, errText, fileRange, ms, oget, pct, periodLabel, rangeQ, scopeLabel, tzOf } from '../lib';
import type { Report, SlimDoc } from '../types';
import { Body, FilterBar, PageHead, SortTable, useLoad, type Col } from '../ui';

const TABS = [
  ['ringkasan', 'Ringkasan', 'summary'], ['menu', 'Per menu', 'items'], ['kategori', 'Per kategori', 'categories'], ['bayar', 'Pembayaran', 'payments'],
  ['tipe', 'Tipe pesanan', 'channels'], ['kasir', 'Per kasir', 'cashiers'], ['harian', 'Harian & pajak', 'days'], ['cabang', 'Per cabang', 'branches'],
  ['diskon', 'Diskon', 'discounts'], ['batal', 'Void & refund', 'voids'],
] as const;
type Tab = (typeof TABS)[number][0];

interface View {
  cols: Col<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  rows: unknown[];
  sortKey?: string | null;
  desc?: boolean;
  foot?: (string | number)[];
  note?: string;
  /** kolom nilai untuk cetak ringkas */
  printCol?: number;
}

function views(d: Report): Record<Tab, View> {
  const k = d.kpi;
  const sales = d.items.reduce((a, x) => a + x.amount, 0);
  type R = { l: string; v: string; n: number };
  type It = Report['items'][number];
  type Pay = Report['payments'][number];
  type Ch = Report['channels'][number];
  type Ca = Report['cashiers'][number];
  type Dy = Report['days'][number];
  type Br = Report['branches'][number];
  type Ds = Report['discounts'][number];
  type Ct = Report['categories'][number];
  return {
    ringkasan: {
      cols: [
        { key: 'l', label: 'Keterangan', get: (r: R) => r.l },
        { key: 'v', label: 'Nilai', r: true, get: (r: R) => r.v, sort: (r: R) => r.n },
      ],
      rows: [
        { l: 'Penjualan kotor (harga menu)', v: rp(k.gross), n: k.gross },
        { l: 'Diskon', v: `−${rp(k.discount)}`, n: -k.discount },
        { l: 'Penjualan bersih (tanpa pajak & servis)', v: rp(k.net), n: k.net },
        { l: 'Biaya layanan', v: rp(k.service), n: k.service },
        { l: 'Pajak (PB1)', v: rp(k.tax), n: k.tax },
        { l: 'Ongkir', v: rp(k.deliveryFee), n: k.deliveryFee },
        { l: 'Pembulatan', v: rp(k.rounding), n: k.rounding },
        { l: 'Total diterima (omzet)', v: rp(k.total), n: k.total },
        { l: 'Jumlah transaksi', v: num(k.orders), n: k.orders },
        { l: 'Rata-rata per transaksi', v: rp(k.avg), n: k.avg },
        { l: 'Item terjual', v: num(k.items), n: k.items },
        { l: `Refund (${k.refunds} transaksi, sudah dikurangkan)`, v: `−${rp(k.refundTotal)}`, n: -k.refundTotal },
        { l: `Void (${k.voids} transaksi, tidak dihitung)`, v: rp(k.voidTotal), n: k.voidTotal },
      ],
      sortKey: null,
      note: 'Semua angka sudah dikurangi refund pada tanggal refund dilakukan. Transaksi void tidak termasuk penjualan.',
      printCol: 1,
    },
    menu: {
      cols: [
        { key: 'name', label: 'Menu', get: (r: It) => r.name },
        { key: 'cat', label: 'Kategori', get: (r: It) => r.categoryName },
        { key: 'qty', label: 'Terjual', r: true, get: (r: It) => num(r.qty), sort: (r: It) => r.qty },
        { key: 'gross', label: 'Kotor', r: true, get: (r: It) => rp(r.gross), sort: (r: It) => r.gross },
        { key: 'disc', label: 'Diskon', r: true, get: (r: It) => rp(r.disc), sort: (r: It) => r.disc },
        { key: 'amount', label: 'Penjualan', r: true, get: (r: It) => rp(r.amount), sort: (r: It) => r.amount },
        { key: 'share', label: 'Porsi', r: true, get: (r: It) => pct(r.amount, sales), sort: (r: It) => r.amount },
      ],
      rows: d.items,
      sortKey: 'amount',
      foot: ['Total', '', num(d.items.reduce((a, x) => a + x.qty, 0)), rp(d.items.reduce((a, x) => a + x.gross, 0)), rp(d.items.reduce((a, x) => a + x.disc, 0)), rp(sales), '100%'],
      note: 'Penjualan per menu = harga menu setelah diskon (termasuk pajak bila harga sudah termasuk pajak).',
      printCol: 5,
    },
    kategori: {
      cols: [
        { key: 'name', label: 'Kategori', get: (r: Ct) => r.name },
        { key: 'qty', label: 'Terjual', r: true, get: (r: Ct) => num(r.qty), sort: (r: Ct) => r.qty },
        { key: 'amount', label: 'Penjualan', r: true, get: (r: Ct) => rp(r.amount), sort: (r: Ct) => r.amount },
        { key: 'share', label: 'Porsi', r: true, get: (r: Ct) => pct(r.amount, sales), sort: (r: Ct) => r.amount },
      ],
      rows: d.categories,
      sortKey: 'amount',
      printCol: 2,
    },
    bayar: {
      cols: [
        { key: 'name', label: 'Metode', get: (r: Pay) => r.name },
        { key: 'count', label: 'Transaksi', r: true, get: (r: Pay) => num(r.count), sort: (r: Pay) => r.count },
        { key: 'amount', label: 'Nominal', r: true, get: (r: Pay) => rp(r.amount), sort: (r: Pay) => r.amount },
        { key: 'share', label: 'Porsi', r: true, get: (r: Pay) => pct(r.amount, k.total), sort: (r: Pay) => r.amount },
      ],
      rows: d.payments,
      sortKey: 'amount',
      foot: ['Total', num(d.payments.reduce((a, x) => a + x.count, 0)), rp(d.payments.reduce((a, x) => a + x.amount, 0)), ''],
      note: 'Gunakan untuk mencocokkan setoran: tunai dengan laporan shift, QRIS/kartu dengan mutasi bank, ojol dengan laporan mitra.',
      printCol: 2,
    },
    tipe: {
      cols: [
        { key: 'name', label: 'Tipe pesanan', get: (r: Ch) => r.name },
        { key: 'orders', label: 'Transaksi', r: true, get: (r: Ch) => num(r.orders), sort: (r: Ch) => r.orders },
        { key: 'total', label: 'Omzet', r: true, get: (r: Ch) => rp(r.total), sort: (r: Ch) => r.total },
        { key: 'share', label: 'Porsi', r: true, get: (r: Ch) => pct(r.total, k.total), sort: (r: Ch) => r.total },
      ],
      rows: d.channels,
      sortKey: 'total',
      printCol: 2,
    },
    kasir: {
      cols: [
        { key: 'name', label: 'Kasir', get: (r: Ca) => r.name },
        { key: 'orders', label: 'Transaksi', r: true, get: (r: Ca) => num(r.orders), sort: (r: Ca) => r.orders },
        { key: 'total', label: 'Omzet', r: true, get: (r: Ca) => rp(r.total), sort: (r: Ca) => r.total },
        { key: 'avg', label: 'Rata-rata', r: true, get: (r: Ca) => rp(r.orders ? Math.round(r.total / r.orders) : 0), sort: (r: Ca) => (r.orders ? r.total / r.orders : 0) },
      ],
      rows: d.cashiers,
      sortKey: 'total',
      printCol: 2,
    },
    harian: {
      cols: [
        { key: 'date', label: 'Tanggal', get: (r: Dy) => dateLabel(r.date), sort: (r: Dy) => r.date },
        { key: 'orders', label: 'Transaksi', r: true, get: (r: Dy) => num(r.orders), sort: (r: Dy) => r.orders },
        { key: 'net', label: 'Bersih (DPP)', r: true, get: (r: Dy) => rp(r.net), sort: (r: Dy) => r.net },
        { key: 'tax', label: 'Pajak', r: true, get: (r: Dy) => rp(r.tax), sort: (r: Dy) => r.tax },
        { key: 'total', label: 'Omzet', r: true, get: (r: Dy) => rp(r.total), sort: (r: Dy) => r.total },
      ],
      rows: d.days,
      sortKey: 'date',
      desc: false,
      foot: ['Total', num(k.orders), rp(k.net), rp(k.tax), rp(k.total)],
      note: 'DPP = dasar pengenaan pajak (penjualan bersih tanpa pajak, sebelum biaya layanan). Cocokkan dengan ketentuan PBJT/PB1 daerah masing-masing cabang.',
      printCol: 4,
    },
    cabang: {
      cols: [
        { key: 'name', label: 'Cabang', get: (r: Br) => r.name },
        { key: 'orders', label: 'Transaksi', r: true, get: (r: Br) => num(r.orders), sort: (r: Br) => r.orders },
        { key: 'items', label: 'Item', r: true, get: (r: Br) => num(r.items), sort: (r: Br) => r.items },
        { key: 'net', label: 'Bersih', r: true, get: (r: Br) => rp(r.net), sort: (r: Br) => r.net },
        { key: 'total', label: 'Omzet', r: true, get: (r: Br) => rp(r.total), sort: (r: Br) => r.total },
        { key: 'avg', label: 'Rata-rata', r: true, get: (r: Br) => rp(r.orders ? Math.round(r.total / r.orders) : 0), sort: (r: Br) => (r.orders ? r.total / r.orders : 0) },
      ],
      rows: d.branches,
      sortKey: 'total',
      printCol: 4,
    },
    diskon: {
      cols: [
        { key: 'name', label: 'Promo / diskon', get: (r: Ds) => r.name },
        { key: 'count', label: 'Dipakai', r: true, get: (r: Ds) => num(r.count), sort: (r: Ds) => r.count },
        { key: 'amount', label: 'Nominal diskon', r: true, get: (r: Ds) => rp(r.amount), sort: (r: Ds) => r.amount },
      ],
      rows: d.discounts,
      sortKey: 'amount',
      note: 'Diskon manual kasir di atas batas dan promo bertanda "Perlu persetujuan" selalu disetujui PIN manajer.',
      printCol: 2,
    },
    batal: {
      cols: [
        { key: 'type', label: 'Jenis', get: (r: SlimDoc) => (r.kind === 'refund' ? 'Refund' : 'Void') },
        { key: 'number', label: 'Nomor', get: (r: SlimDoc) => r.number },
        { key: 'branch', label: 'Cabang', get: (r: SlimDoc) => branchName(r.branchId) },
        { key: 'at', label: 'Waktu', get: (r: SlimDoc) => dateTime(ms(r.at), tzOf(r.branchId)), sort: (r: SlimDoc) => r.at },
        { key: 'by', label: 'Oleh', get: (r: SlimDoc) => r.by },
        { key: 'reason', label: 'Alasan', get: (r: SlimDoc) => r.reason },
        { key: 'total', label: 'Nominal', r: true, get: (r: SlimDoc) => rp(Math.abs(r.total)), sort: (r: SlimDoc) => Math.abs(r.total) },
      ],
      rows: [...d.voids, ...d.refunds],
      sortKey: 'at',
      note: 'Pantau void & refund per kasir/cabang. Setiap void & refund wajib alasan dan persetujuan PIN manajer.',
      printCol: 6,
    },
  };
}

export default function ReportsPage() {
  const [tab, setTabState] = useState<Tab>(() => ss.get<Tab>('pos:report:tab', 'ringkasan'));
  const setTab = (t: Tab) => {
    setTabState(t);
    ss.set('pos:report:tab', t);
  };
  const l = useLoad(() => oget<Report>(`/office/reports${rangeQ()}`), []);
  const meta = TABS.find((t) => t[0] === tab) ?? TABS[0];
  const print = () => {
    if (!l.data) return;
    const v = views(l.data)[tab];
    const c = v.printCol ?? v.cols.length - 1;
    printHTML(
      `<div class="c b">${esc(settings().orgName)} — LAPORAN ${esc(meta[1].toUpperCase())}</div><div class="c">${esc(scopeLabel())}</div><div class="c">${esc(periodLabel())}</div><hr>
      ${v.rows.map((row) => `<div class="r"><span>${esc(v.cols[0]!.get(row))}</span><span>${esc(v.cols[c]!.get(row))}</span></div>`).join('')}<hr>`,
      { paper: 80, title: 'Laporan' },
    );
  };
  return (
    <>
      <PageHead
        title="Laporan"
        sub={`${scopeLabel()} · ${periodLabel()}`}
        actions={
          <>
            <button className="btn ghost sm" data-print onClick={print}>
              <Icon name="printer" size="sm" /> Cetak
            </button>
            <button
              className="btn sm"
              data-csv
              onClick={() => csv(`/office/reports${rangeQ({ view: meta[2] })}`, `robucca-laporan-${tab}-${fileRange()}`).catch((e: unknown) => toast(errText(e), 'err'))}
            >
              <Icon name="download" size="sm" /> Ekspor CSV
            </button>
          </>
        }
      />
      <div className="page">
        <FilterBar />
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'on' : ''}`} data-tab={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <Body l={l}>
          {(d) => {
            const v = views(d)[tab];
            return (
              <>
                {v.note ? (
                  <p className="hint" style={{ margin: '0 0 10px' }}>
                    {v.note}
                  </p>
                ) : null}
                <div className="table-card" id="r-table">
                  <SortTable key={tab} cols={v.cols} rows={v.rows} sortKey={v.sortKey ?? null} desc={v.desc !== false} foot={v.foot} />
                </div>
              </>
            );
          }}
        </Body>
      </div>
    </>
  );
}
