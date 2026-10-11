/* Layar antrean untuk pelanggan: "Sedang disiapkan" & "Siap diambil". Port dari pos/js/views/queue.js. */
import { addDays, clock } from '@robucca/core';
import { useEffect, useState } from 'react';
import type { Order } from '../data/types';
import { useBus } from '../lib/bus';
import { Icon } from '../lib/icons';
import { kitchenState } from '../ops';
import { S, branch, nav, settings, today } from '../state';

const READY_SHOW_MIN = 10;

export function QueueView() {
  const be = S.be;
  const b = branch();
  const [now, setNow] = useState(Date.now());
  const [prep, setPrep] = useState<Order[]>([]);
  const [ready, setReady] = useState<Order[]>([]);

  const load = async () => {
    const t = today();
    const orders = (await be.ordersOf(addDays(t, -1), t)).filter((o) => (o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT' || o.status === 'PAID') && o.lines.some((l) => l.kAt && !l.voided));
    const marks = await be.kitchenMarks(Date.now() - 24 * 3600e3);
    const n = Date.now();
    const p: { o: Order; at: number }[] = [];
    const r: { o: Order; at: number }[] = [];
    for (const o of orders) {
      // pesanan yang sudah diambil pelanggan / dibawa driver delivery tidak ditampilkan lagi
      if ((o.fulfillment === 'COMPLETED' && o.source === 'PWA') || o.fulfillment === 'OUT_FOR_DELIVERY') continue;
      const k = kitchenState(o, marks);
      if (!k.sent) continue;
      if (k.ready) {
        if (n - k.readyAt! < READY_SHOW_MIN * 60e3) r.push({ o, at: k.readyAt! });
      } else p.push({ o, at: o.createdAt });
    }
    p.sort((a, x) => a.at - x.at);
    r.sort((a, x) => x.at - a.at);
    setPrep(p.map((x) => x.o));
    setReady(r.map((x) => x.o));
  };
  useEffect(() => {
    void load();
    const t1 = setInterval(() => setNow(Date.now()), 10000);
    const t2 = setInterval(() => void load(), 15000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useBus(['orders', 'kitchen'], () => void load());

  const card = (o: Order) => (
    <div className="q-num" key={o.id}>
      <b>{o.queueNo}</b>
      <small>{(o.customerName ? o.customerName.split(' ')[0] : '') || (o.table ? `Meja ${o.table}` : '')}</small>
    </div>
  );
  const ig = settings().instagram;
  return (
    <div className="queue">
      <div className="q-head">
        <img src="assets/brand/wordmark-light.png" alt="Robucca" />
        <div>
          <b style={{ fontSize: 20 }}>{b.name}</b>
          <div style={{ opacity: 0.8 }}>Pantau nomor antrean Anda</div>
        </div>
        <div className="q-clock" id="q-clock">
          {clock(now, b.timezone)}
        </div>
        <button
          className="btn ghost sm"
          style={{ color: 'var(--cream)', boxShadow: 'inset 0 0 0 1.5px rgba(250,238,218,.3)', marginLeft: 14 }}
          aria-label="Keluar dari layar antrean"
          onClick={() => nav('dapur')}
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
      <div className="q-cols">
        <section className="q-col">
          <h2>Sedang disiapkan</h2>
          <div className="q-nums" id="q-prep">
            {prep.length ? prep.slice(0, 24).map(card) : <span style={{ opacity: 0.7, fontSize: 18 }}>—</span>}
          </div>
        </section>
        <section className="q-col ready">
          <h2>Siap diambil</h2>
          <div className="q-nums" id="q-ready">
            {ready.length ? ready.slice(0, 18).map(card) : <span style={{ opacity: 0.6, fontSize: 18 }}>—</span>}
          </div>
        </section>
      </div>
      <div className="q-foot">Terima kasih sudah menunggu{ig ? ` · ${ig}` : ''}</div>
    </div>
  );
}
