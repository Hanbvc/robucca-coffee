/* Riwayat transaksi cabang (hari ini & kemarin) di perangkat kasir: struk, cetak ulang, void, refund.
   Port dari pos/js/views/history.js. */
import { addDays, clock, rp } from '@robucca/core';
import { useEffect, useState } from 'react';
import { OrderActions, OrderDetail, StatusTag } from '../components/OrderDetail';
import type { Order } from '../data/types';
import { useBus } from '../lib/bus';
import { Icon } from '../lib/icons';
import { S, branch, today } from '../state';

type Filter = '' | 'PAID' | 'OPEN' | 'VOIDED' | 'REFUNDED';

export function HistoryView() {
  const b = branch();
  const [day, setDay] = useState(today());
  const [filter, setFilter] = useState<Filter>('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [rows, setRows] = useState<Order[]>([]);

  const load = () =>
    void S.be.ordersOf(day, day).then((r) => setRows(r.filter((o) => o.status !== 'DRAFT').sort((a, x) => (x.paidAt || x.createdAt) - (a.paidAt || a.createdAt))));
  useEffect(load, [day]);
  useBus(['orders'], load);

  let list = rows;
  if (filter === 'OPEN') list = list.filter((o) => o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT');
  else if (filter) list = list.filter((o) => o.status === filter);
  const s = q.trim().toLowerCase();
  if (s) list = list.filter((o) => [o.number, o.queueNo, o.table, o.customerName, o.cashierName].some((x) => String(x || '').toLowerCase().includes(s)));
  const paid = rows.filter((o) => o.status === 'PAID' || o.status === 'REFUNDED');
  const total = paid.reduce((a, o) => a + o.totals.total - (o.refund?.amount ?? 0), 0);
  const cur = rows.find((x) => x.id === sel);

  const days: [string, string][] = [
    [today(), 'Hari ini'],
    [addDays(today(), -1), 'Kemarin'],
  ];
  const filters: [Filter, string][] = [
    ['', 'Semua'],
    ['PAID', 'Lunas'],
    ['OPEN', 'Belum bayar'],
    ['VOIDED', 'Void'],
    ['REFUNDED', 'Refund'],
  ];
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Riwayat transaksi</h1>
          <div className="crumb">{b.name} · semua terminal</div>
        </div>
      </div>
      <div className="page">
        <div className="filters">
          <div className="seg" id="h-day">
            {days.map(([d, label]) => (
              <button
                key={d}
                className={day === d ? 'on' : ''}
                onClick={() => {
                  setDay(d);
                  setSel(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="sep" />
          <div className="seg" id="h-f">
            {filters.map(([f, label]) => (
              <button key={f} className={filter === f ? 'on' : ''} data-f={f} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          <div className="input-wrap right" style={{ width: 240 }}>
            <Icon name="search" size="sm" />
            <input className="input sm" id="h-q" type="search" placeholder="Nomor, nama, meja" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="two-col">
          <div id="h-list">
            <div className="mini-stats" style={{ marginBottom: 12 }}>
              <div className="mini">
                <small>Transaksi</small>
                <b>{paid.length}</b>
              </div>
              <div className="mini">
                <small>Penjualan</small>
                <b>{rp(total)}</b>
              </div>
              <div className="mini">
                <small>Void</small>
                <b>{rows.filter((o) => o.status === 'VOIDED').length}</b>
              </div>
            </div>
            {list.length ? (
              <div className="list">
                {list.slice(0, 300).map((o) => (
                  <button key={o.id} className={`li ${sel === o.id ? 'on' : ''}`} data-o={o.id} onClick={() => setSel(o.id)}>
                    <span className="lq">{o.queueNo || '—'}</span>
                    <div>
                      <b>
                        {o.number} <StatusTag o={o} />
                        {o.syncError && <span className="tag red">Ditolak server</span>}
                      </b>
                      <small>
                        {clock(o.paidAt || o.createdAt, b.timezone)} · {o.channelName}
                        {o.table ? ` · Meja ${o.table}` : ''}
                        {o.customerName ? ` · ${o.customerName}` : ''} · {o.cashierName}
                        {o.demo ? ' · contoh' : ''}
                      </small>
                    </div>
                    <span className={`amt ${o.status === 'VOIDED' ? 'muted' : ''}`}>{o.status === 'VOIDED' ? <s>{rp(o.totals.total)}</s> : rp(o.totals.total)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="em-ico">
                  <Icon name="receipt" size="lg" />
                </div>
                <h3>Belum ada transaksi</h3>
              </div>
            )}
          </div>
          <div className="card pad sticky" id="h-detail">
            {cur ? (
              <>
                <OrderDetail o={cur} />
                <OrderActions o={cur} after={load} />
              </>
            ) : (
              <div className="empty" style={{ padding: '30px 10px' }}>
                <div className="em-ico">
                  <Icon name="receipt" size="lg" />
                </div>
                <p>Pilih transaksi untuk melihat struk.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
