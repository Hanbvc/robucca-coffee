/* Tagihan terbuka: pesanan sudah dikirim ke dapur, belum dibayar (semua terminal cabang),
   termasuk pesanan Pick Up / Delivery dari aplikasi pelanggan yang dibayar di kasir. Port dari pos/js/views/bills.js. */
import { ago, clock, rp } from '@robucca/core';
import { useEffect, useState } from 'react';
import { printHTML, receiptHTML, ticketHTML } from '../components/receipt';
import { typeName } from '../data/master';
import type { Order } from '../data/types';
import { useBus } from '../lib/bus';
import { Icon } from '../lib/icons';
import { isAppOrder } from '../ops';
import { S, branch, nav, settings } from '../state';

export function BillsView() {
  const b = branch();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Order[] | null>(null);
  const load = () => void S.be.openOrders().then((r) => setRows(r.sort((a, x) => a.createdAt - x.createdAt)));
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  useBus(['orders'], load);

  const s = q.trim().toLowerCase();
  const list = (rows ?? []).filter((o) => !s || [o.number, o.queueNo, o.table, o.customerName].some((x) => String(x || '').toLowerCase().includes(s)));
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Tagihan terbuka</h1>
          <div className="crumb">Pesanan yang sudah dikirim ke dapur dan belum dibayar · semua terminal {b.name}</div>
        </div>
        <div className="right row">
          <div className="input-wrap" style={{ width: 260 }}>
            <Icon name="search" size="sm" />
            <input className="input" id="b-q" type="search" placeholder="Cari meja, nama, nomor" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn" data-a="new" onClick={() => nav('kasir')}>
            <Icon name="plus" size="sm" /> Pesanan baru
          </button>
        </div>
      </div>
      <div className="page" id="b-list">
        {rows && !list.length ? (
          <div className="empty">
            <div className="em-ico">
              <Icon name="pause" size="lg" />
            </div>
            <h3>{q ? 'Tidak ditemukan' : 'Tidak ada tagihan terbuka'}</h3>
            <p>
              Tekan <b>Simpan</b> di layar kasir untuk menyimpan pesanan dine-in yang dibayar belakangan. Pesanan Pick Up / Delivery dari aplikasi pelanggan juga muncul di sini.
            </p>
          </div>
        ) : (
          <div className="list">
            {list.map((o) => (
              <div className="li" key={o.id} data-bill={o.id} style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto auto' }}>
                <span className="lq">{o.queueNo}</span>
                <div>
                  <b>
                    {o.table ? `Meja ${o.table}` : o.customerName || 'Tanpa nama'}
                    {o.table && o.customerName ? ` · ${o.customerName}` : ''}{' '}
                    {isAppOrder(o) && <span className="tag blue">{typeName(o.type)}</span>}
                    {o.syncError && <span className="tag red">Ditolak server</span>}
                  </b>
                  <small>
                    {o.channelName} · {o.totals.items} item · {o.number}{o.terminalNo ? ` · T${o.terminalNo}` : ''} · {o.cashierName || (isAppOrder(o) ? 'aplikasi' : '')} · {clock(o.createdAt, b.timezone)} (
                    {ago(Date.now() - o.createdAt)})
                  </small>
                </div>
                <span className="amt">{rp(o.totals.total)}</span>
                <div className="row">
                  <button
                    className="icon-btn"
                    title="Cetak tagihan"
                    onClick={() => printHTML(receiptHTML(o, { branch: b, settings: settings(), bill: true }), { paper: b.receiptPaperMm, title: o.number })}
                  >
                    <Icon name="printer" size="sm" />
                  </button>
                  <button
                    className="icon-btn"
                    title="Cetak tiket dapur"
                    onClick={() => printHTML(ticketHTML(o, o.lines.filter((l) => !l.voided && l.kAt), { branch: b }), { paper: b.receiptPaperMm, title: o.number })}
                  >
                    <Icon name="chef" size="sm" />
                  </button>
                  <button className="btn sm" data-open={o.id} onClick={() => nav(`kasir?bill=${o.id}`)}>
                    Buka <Icon name="arrow-right" size="xs" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
