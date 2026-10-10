/* Rekap shift kasir semua cabang: kas awal, kas seharusnya, kas dihitung (pecahan), selisih. */
import { clock, dateTime, num, rp } from '@robucca/core';
import { Icon } from '../../lib/icons';
import { Drawer, openLayer, toast, useLayerClose } from '../../ui/overlay';
import { csv, errText, fileRange, ms, oget, periodLabel, rangeQ, scopeLabel, tzOf } from '../lib';
import type { ShiftDetail, ShiftRow } from '../types';
import { Body, FilterBar, PageHead, useLoad } from '../ui';
import { openTx, StatusTag } from './Transactions';

interface ShiftList {
  totals: { shifts: number; open: number; closed: number; withDifference: number; difference: number };
  rows: ShiftRow[];
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${rp(v)}`;

export default function ShiftsPage() {
  const l = useLoad(() => oget<ShiftList>(`/office/shifts${rangeQ()}`), []);
  return (
    <>
      <PageHead
        title="Shift kasir"
        sub={`${scopeLabel()} · ${periodLabel()}`}
        actions={
          <button className="btn ghost sm" data-csv onClick={() => csv(`/office/shifts${rangeQ()}`, `robucca-shift-${fileRange()}`).catch((e: unknown) => toast(errText(e), 'err'))}>
            <Icon name="download" size="sm" /> Ekspor CSV
          </button>
        }
      />
      <div className="page">
        <FilterBar />
        <Body l={l}>
          {(d) => (
            <>
              <div className="kpis">
                <div className="kpi">
                  <div className="k-label">Shift</div>
                  <div className="k-value">{num(d.totals.shifts)}</div>
                  <div className="k-sub">{d.totals.open} masih terbuka</div>
                </div>
                <div className="kpi">
                  <div className="k-label">Shift dengan selisih kas</div>
                  <div className="k-value">{num(d.totals.withDifference)}</div>
                  <div className="k-sub">dari {d.totals.closed} shift ditutup</div>
                </div>
                <div className="kpi">
                  <div className="k-label">Total selisih kas</div>
                  <div className={`k-value ${d.totals.difference < 0 ? 'neg' : ''}`}>{signed(d.totals.difference)}</div>
                  <div className="k-sub">negatif = uang kurang</div>
                </div>
              </div>
              <div className="table-card" id="s-table">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Cabang</th>
                        <th>Terminal</th>
                        <th>Dibuka</th>
                        <th>Ditutup</th>
                        <th className="r">Kas awal</th>
                        <th className="r">Penjualan</th>
                        <th className="r">Kas seharusnya</th>
                        <th className="r">Kas dihitung</th>
                        <th className="r">Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.length ? (
                        d.rows.map((s) => (
                          <tr key={s.id} className="click" data-id={s.id} onClick={() => void openShift(s.id)}>
                            <td>{s.branchName}</td>
                            <td>T{s.terminalNo ?? '-'}</td>
                            <td className="n">
                              {dateTime(ms(s.openedAt), tzOf(s.branchId))}
                              <span className="sub">{s.openedBy.name}</span>
                            </td>
                            <td className="n">
                              {s.closedAt ? (
                                <>
                                  {dateTime(ms(s.closedAt), tzOf(s.branchId))}
                                  <span className="sub">{s.closedBy?.name ?? ''}</span>
                                </>
                              ) : (
                                <span className="tag green">
                                  <span className="dot" />
                                  Terbuka
                                </span>
                              )}
                            </td>
                            <td className="r">{rp(s.openingCash)}</td>
                            <td className="r">{s.summary ? rp(s.summary.total) : '—'}</td>
                            <td className="r">{s.expectedCash != null ? rp(s.expectedCash) : '—'}</td>
                            <td className="r">{s.countedCash != null ? rp(s.countedCash) : '—'}</td>
                            <td className={`r ${(s.difference ?? 0) < 0 ? 'neg' : (s.difference ?? 0) > 0 ? 'pos' : ''}`}>{s.status === 'CLOSED' ? signed(s.difference ?? 0) : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                            Belum ada shift pada periode ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

async function openShift(id: string): Promise<void> {
  let s: ShiftDetail;
  try {
    s = await oget<ShiftDetail>(`/office/shifts/${id}`);
  } catch (e) {
    toast(errText(e), 'err');
    return;
  }
  await openLayer(() => <ShiftDrawer s={s} />);
}

function ShiftDrawer({ s }: { s: ShiftDetail }) {
  const close = useLayerClose();
  const tz = tzOf(s.branchId);
  const sum = s.summary;
  return (
    <Drawer
      title={`Shift T${s.terminalNo ?? '-'} · ${s.branchName}`}
      sub={`${dateTime(ms(s.openedAt), tz)}${s.closedAt ? ` – ${clock(ms(s.closedAt), tz)}` : ' · masih terbuka'} · ${s.openedBy.name}`}
      foot={
        <button className="btn ghost" onClick={() => close()}>
          Tutup
        </button>
      }
    >
      {sum ? (
        <>
          <div className="mini-stats">
            <div className="mini">
              <small>Transaksi</small>
              <b>{num(sum.count)}</b>
            </div>
            <div className="mini">
              <small>Penjualan</small>
              <b>{rp(sum.total)}</b>
            </div>
            <div className="mini">
              <small>Tunai masuk</small>
              <b>{rp(sum.cashSales)}</b>
            </div>
          </div>
          <h3 className="card-title" style={{ marginTop: 16 }}>
            Per metode
          </h3>
          {sum.byMethod.length ? (
            sum.byMethod.map((p) => (
              <div key={p.code} className="sum-row" style={{ padding: '5px 0' }}>
                <span>
                  {p.name} <span className="muted">({p.count}×)</span>
                </span>
                <b>{rp(p.amount)}</b>
              </div>
            ))
          ) : (
            <p className="muted">Belum ada pembayaran.</p>
          )}
        </>
      ) : null}
      <h3 className="card-title" style={{ marginTop: 16 }}>
        Kas laci
      </h3>
      <div className="sum-row" style={{ padding: '4px 0' }}>
        <span>Kas awal</span>
        <span>{rp(s.openingCash)}</span>
      </div>
      {sum ? (
        <>
          <div className="sum-row" style={{ padding: '4px 0' }}>
            <span>+ Penjualan tunai</span>
            <span>{rp(sum.cashSales)}</span>
          </div>
          <div className="sum-row" style={{ padding: '4px 0' }}>
            <span>+ Kas masuk / − kas keluar</span>
            <span>{signed(sum.cashIn - sum.cashOut)}</span>
          </div>
          {sum.cashRefunds ? (
            <div className="sum-row" style={{ padding: '4px 0' }}>
              <span>− Refund</span>
              <span>−{rp(sum.cashRefunds)}</span>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="sum-row" style={{ padding: '4px 0', fontWeight: 700 }} data-expected>
        <span>Kas seharusnya</span>
        <span>{s.expectedCash != null ? rp(s.expectedCash) : '—'}</span>
      </div>
      {s.status === 'CLOSED' && (
        <>
          <div className="sum-row" style={{ padding: '4px 0' }}>
            <span>Kas dihitung{s.closedBy ? ` (${s.closedBy.name})` : ''}</span>
            <span>{s.countedCash != null ? rp(s.countedCash) : '—'}</span>
          </div>
          <div className={`sum-row ${(s.difference ?? 0) < 0 ? 'neg' : (s.difference ?? 0) > 0 ? 'pos' : ''}`} style={{ padding: '4px 0', fontWeight: 700 }} data-diff>
            <span>Selisih</span>
            <span>{signed(s.difference ?? 0)}</span>
          </div>
        </>
      )}
      {s.denominations.length ? (
        <>
          <h3 className="card-title" style={{ marginTop: 16 }}>
            Pecahan dihitung
          </h3>
          <table className="table" data-denoms>
            <thead>
              <tr>
                <th>Pecahan</th>
                <th className="r">Lembar/keping</th>
                <th className="r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {s.denominations.map((x) => (
                <tr key={x.value}>
                  <td>{rp(x.value)}</td>
                  <td className="r">{num(x.count)}</td>
                  <td className="r">{rp(x.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="r">{rp(s.denominationsTotal ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      ) : null}
      {s.differenceNote ? (
        <div className="note" style={{ marginTop: 14 }}>
          <Icon name="note" size="sm" />
          <span>{s.differenceNote}</span>
        </div>
      ) : null}
      <h3 className="card-title" style={{ marginTop: 16 }}>
        Kas masuk & keluar
      </h3>
      {s.cashMovements.length ? (
        s.cashMovements.map((m) => (
          <div key={m.id} className="sum-row" style={{ padding: '5px 0' }}>
            <span>
              {clock(ms(m.createdAt), tz)} · {m.reason} <span className="muted">({m.createdBy?.name ?? ''})</span>
            </span>
            <b className={m.type === 'CASH_IN' ? 'pos' : 'neg'}>
              {m.type === 'CASH_IN' ? '+' : '−'}
              {rp(m.amount)}
            </b>
          </div>
        ))
      ) : (
        <p className="muted">Tidak ada.</p>
      )}
      <h3 className="card-title" style={{ marginTop: 16 }}>
        Transaksi shift ({s.orders.length})
      </h3>
      {s.orders.length ? (
        <table className="table">
          <tbody>
            {s.orders.map((o) => (
              <tr key={o.id} className="click" onClick={() => void openTx(o.id)}>
                <td>
                  <b>{o.number}</b>
                  <span className="sub">{clock(ms(o.paidAt ?? o.createdAt), tz)}</span>
                </td>
                <td className="r">{rp(o.totals.total)}</td>
                <td>
                  <StatusTag s={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Belum ada transaksi.</p>
      )}
    </Drawer>
  );
}
