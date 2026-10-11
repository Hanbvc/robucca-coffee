/* =========================================================
   Layar dapur/bar (KDS): tiket dari kasir & aplikasi pelanggan, tandai selesai per item / per tiket.
   Pembaruan langsung lewat SSE /pos/stream → feed. Port dari pos/js/views/kds.js.
   ========================================================= */
import { addDays, ago, clock } from '@robucca/core';
import { Fragment, useEffect, useRef, useState } from 'react';
import { typeName } from '../data/master';
import type { KitchenMark, Line, Order } from '../data/types';
import { useBus } from '../lib/bus';
import { Icon } from '../lib/icons';
import { ls } from '../lib/store';
import { isAppOrder, markKitchen } from '../ops';
import { S, branch, nav, settings, today } from '../state';
import { audioReady, beep, Modal, openLayer, toast } from '../ui/overlay';

type Station = 'all' | 'BAR' | 'KITCHEN';
interface Ticket {
  o: Order;
  lines: Line[];
  pending: Line[];
  since: number;
}

export function KdsView() {
  const be = S.be;
  const b = branch();
  const [station, setStation] = useState<Station>(() => ls.get<Station>('pos:kds:station', 'all'));
  const [sound, setSound] = useState(() => ls.get('pos:kds:sound', false));
  const [orders, setOrders] = useState<Order[]>([]);
  const [marks, setMarks] = useState<KitchenMark[]>([]);
  const [, setTick] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  const load = async () => {
    const t = today();
    const os = (await be.ordersOf(addDays(t, -1), t)).filter((o) => (o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT' || o.status === 'PAID') && o.lines.some((l) => l.kAt));
    setOrders(os);
    setMarks(await be.kitchenMarks(Date.now() - 36 * 3600e3));
  };
  useEffect(() => {
    void load();
    if (sound && !audioReady()) toast('Ketuk layar sekali untuk mengaktifkan bunyi tiket baru', 'warn', 4000);
    const timer = setInterval(() => setTick((x) => x + 1), 15000);
    const poll = setInterval(() => void load(), be.isServer ? 20000 : 60000);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useBus(['orders', 'kitchen'], () => void load());

  const dm = new Map(marks.map((k) => [`${k.orderId}:${k.lineId}`, k]));
  const tickets: Ticket[] = [];
  for (const o of orders) {
    const lines = o.lines.filter((l) => l.kAt && l.station !== 'NONE' && (station === 'all' || l.station === station));
    const pending = lines.filter((l) => !l.voided && !dm.get(`${o.id}:${l.id}`)?.done);
    if (!pending.length) continue;
    tickets.push({ o, lines, pending, since: Math.min(...pending.map((l) => l.kAt!)) });
  }
  tickets.sort((a, x) => a.since - x.since);

  // tiket baru → bunyi
  useEffect(() => {
    const ids = new Set(tickets.map((t) => `${t.o.id}:${t.pending.map((l) => l.id).join(',')}`));
    if (seen.current && sound) {
      for (const id of ids)
        if (!seen.current.has(id)) {
          beep(2);
          break;
        }
    }
    seen.current = ids;
  });

  const now = Date.now();
  const s = settings();
  const items = tickets.reduce((a, t) => a + t.pending.reduce((x, l) => x + l.qty, 0), 0);

  const toggleLine = async (o: Order, lid: string) => {
    const cur = dm.get(`${o.id}:${lid}`);
    await markKitchen(o, [lid], !cur?.done);
  };
  const bump = async (t: Ticket) => {
    await markKitchen(t.o, t.pending.map((l) => l.id), true);
    toast(`Antrean ${t.o.queueNo} selesai`);
  };
  const recall = async () => {
    const since = Date.now() - 45 * 60e3;
    const recent = new Map<string, { o: Order; at: number }>();
    marks
      .filter((k) => k.done && k.at >= since)
      .forEach((k) => {
        const o = orders.find((x) => x.id === k.orderId);
        if (o) recent.set(o.id, { o, at: Math.max(k.at, recent.get(o.id)?.at ?? 0) });
      });
    const list = [...recent.values()].sort((a, x) => x.at - a.at).slice(0, 20);
    const id = await openLayer<string>((close) => (
      <Modal title="Baru selesai" sub="45 menit terakhir. Kembalikan tiket bila terlanjur ditandai selesai." size="sm">
        {list.length ? (
          <div className="list">
            {list.map(({ o, at }) => (
              <div key={o.id} className="li" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                <span className="lq">{o.queueNo}</span>
                <div>
                  <b>{o.table ? `Meja ${o.table}` : o.customerName || o.channelName}</b>
                  <small>selesai {clock(at, b.timezone)}</small>
                </div>
                <button className="btn sm ghost" onClick={() => close(o.id)}>
                  <Icon name="undo" size="sm" /> Kembalikan
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Belum ada.</p>
        )}
      </Modal>
    ));
    if (!id) return;
    const o = orders.find((x) => x.id === id)!;
    const ids = marks.filter((k) => k.orderId === o.id && k.done && k.at >= since).map((k) => k.lineId);
    await markKitchen(o, ids, false);
    toast(`Antrean ${o.queueNo} dikembalikan`);
  };

  return (
    <div className="kds">
      <div className="kds-head">
        <h1>
          <Icon name="chef" size="lg" /> Dapur
        </h1>
        <div className="seg" id="k-st">
          {(
            [
              ['all', 'Semua'],
              ['BAR', 'Bar'],
              ['KITCHEN', 'Dapur'],
            ] as [Station, string][]
          ).map(([st, label]) => (
            <button
              key={st}
              className={station === st ? 'on' : ''}
              data-st={st}
              onClick={() => {
                setStation(st);
                ls.set('pos:kds:station', st);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="kds-stat" id="k-stat">
          <span>
            <b>{tickets.length}</b> tiket
          </span>
          <span>
            <b>{items}</b> item
          </span>
          {tickets.length > 0 && (
            <span>
              terlama <b>{ago(now - tickets[0]!.since)}</b>
            </span>
          )}
        </div>
        <div className="right row">
          <button
            className="btn ghost sm"
            data-a="sound"
            id="k-sound"
            onClick={() => {
              const v = !sound;
              setSound(v);
              ls.set('pos:kds:sound', v);
              if (v) beep(1);
            }}
          >
            <Icon name={sound ? 'volume' : 'volume-x'} size="sm" /> {sound ? 'Bunyi aktif' : 'Bunyi mati'}
          </button>
          <button className="btn ghost sm" data-a="recall" onClick={() => void recall()}>
            <Icon name="undo" size="sm" /> Baru selesai
          </button>
          <button className="btn ghost sm" data-a="queue" onClick={() => nav('antrean')}>
            <Icon name="tv" size="sm" /> Layar antrean
          </button>
          <button
            className="btn ghost sm"
            data-a="full"
            aria-label="Layar penuh"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else document.documentElement.requestFullscreen().catch(() => {});
            }}
          >
            <Icon name="monitor" size="sm" />
          </button>
        </div>
      </div>
      <div id="k-body">
        {!tickets.length ? (
          <div className="kds-empty">
            <div>
              <Icon name="check-circle" size="lg" />
              <b>Semua pesanan beres</b>Tiket baru dari kasir muncul di sini otomatis.
            </div>
          </div>
        ) : (
          <div className="tickets">
            {tickets.map((tk) => {
              const { o, lines, pending, since } = tk;
              const age = now - since;
              const min = age / 60000;
              const cls = min >= (s.kdsLateMinutes || 15) ? 'late' : min >= (s.kdsWarnMinutes || 8) ? 'warn' : '';
              const batches = [...new Set(lines.map((l) => l.kAt!))].sort((a, x) => a - x);
              const live = lines.filter((l) => !l.voided).length;
              return (
                <article className={`ticket ${cls}`} key={o.id} data-ticket={o.queueNo}>
                  <div className="t-head">
                    <div>
                      <div className="tq">{o.queueNo}</div>
                      <div className="tw">
                        {o.table ? `Meja ${o.table}` : ''}
                        {o.table && o.customerName ? ' · ' : ''}
                        {o.customerName}
                      </div>
                      <span className="t-ch">{isAppOrder(o) ? typeName(o.type) : o.channelName}</span>
                    </div>
                    <div className="tt">
                      <b>{ago(age)}</b>
                      <small>
                        {clock(since, b.timezone)} · {o.status === 'PAID' ? 'lunas' : 'tagihan'}
                      </small>
                    </div>
                  </div>
                  <div className="t-lines">
                    {batches.map((bt, i) => (
                      <Fragment key={bt}>
                        {i > 0 && <div className="t-batch">Tambahan · {clock(bt, b.timezone)}</div>}
                        {lines
                          .filter((l) => l.kAt === bt)
                          .map((l) => {
                            const dn = dm.get(`${o.id}:${l.id}`)?.done;
                            return (
                              <button
                                key={l.id}
                                className={`t-line ${dn ? 'done' : ''} ${l.voided ? 'void' : ''}`}
                                data-ln={`${o.id}:${l.id}`}
                                disabled={!!l.voided}
                                onClick={() => void toggleLine(o, l.id)}
                              >
                                <span className="tq2">{l.qty}×</span>
                                <span>
                                  <b>{l.name}</b>
                                  {l.sum && <small>{l.sum}</small>}
                                  {l.note && <small className="tn">⚑ {l.note}</small>}
                                  {l.voided && <small>DIBATALKAN</small>}
                                  {station === 'all' && <small className="other">{l.station === 'BAR' ? 'Bar' : 'Dapur'}</small>}
                                </span>
                              </button>
                            );
                          })}
                      </Fragment>
                    ))}
                  </div>
                  <div className="t-foot">
                    <button className="btn" data-bump={o.id} onClick={() => void bump(tk)}>
                      <Icon name="check" size="sm" /> Selesai{pending.length < live ? ` (${pending.length})` : ''}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
