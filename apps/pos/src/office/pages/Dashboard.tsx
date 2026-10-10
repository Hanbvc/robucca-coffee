/* Dasbor kantor: ringkasan penjualan, tren, cabang, jam ramai, metode bayar, menu terlaris, kondisi cabang. */
import { ago, clock, dateLabel, dateShort, dayDiff, num, rp, short } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { branchSel, ms, oget, periodLabel, rangeQ, scopeLabel, tzOf } from '../lib';
import type { Dashboard } from '../types';
import { Body, ColumnChart, FilterBar, HBars, PageHead, SimpleTable, useLoad, type Pt } from '../ui';

/** Nilai kartu KPI: lengkap bila muat, ringkas (Rp281,4 jt) bila panjang; nilai lengkap di tooltip. */
function Money({ v }: { v: number }) {
  const full = rp(v);
  return full.length <= 12 ? <>{full}</> : <span title={full}>{`${v < 0 ? '-' : ''}Rp${short(Math.abs(v))}`}</span>;
}

function Delta({ pct, upGood = true, vs }: { pct: number | null; upGood?: boolean; vs: string }) {
  if (pct == null) {
    return (
      <div className="k-delta flat">
        <span>tanpa data pembanding</span>
      </div>
    );
  }
  if (Math.abs(pct) < 0.1) {
    return (
      <div className="k-delta flat">
        0% <span>{vs}</span>
      </div>
    );
  }
  const good = pct > 0 === upGood;
  return (
    <div className={`k-delta ${good ? 'up' : 'down'}`}>
      <Icon name={pct > 0 ? 'arrow-up' : 'arrow-down'} size="xs" />
      {Math.abs(pct).toLocaleString('id-ID')}% <span>{vs}</span>
    </div>
  );
}

export default function DashboardPage() {
  const l = useLoad(() => oget<Dashboard>(`/office/dashboard${rangeQ()}`), []);
  const [tbl, setTbl] = useState<{ trend?: boolean; hours?: boolean }>({});
  return (
    <>
      <PageHead
        title="Dasbor"
        sub={`${scopeLabel()} · ${periodLabel()}`}
        actions={
          <button className="btn ghost sm" data-refresh onClick={l.reload}>
            <Icon name="rotate" size="sm" /> Muat ulang
          </button>
        }
      />
      <div className="page" id="d-page">
        <FilterBar />
        <Body l={l}>
          {(d) => {
            const cur = d.current;
            const k = cur.kpi;
            const dp = d.comparison.deltaPct;
            const vs = d.compareLabel;
            const single = d.range.from === d.range.to;
            const multi = cur.branches.length > 1 || (!branchSel() && d.branchStatus.length > 1);
            let series: Pt[];
            if (single) {
              const used = cur.hours.map((h, i) => (h.total || d.previous.hours[i]?.total ? i : -1)).filter((i) => i >= 0);
              const lo = Math.min(7, ...used);
              const hi = Math.max(21, ...used);
              series = cur.hours.slice(lo, hi + 1).map((h) => {
                const hh = String(h.hour).padStart(2, '0');
                return { label: hh, full: `Pukul ${hh}.00–${hh}.59`, value: h.total, prev: d.previous.hours[h.hour]?.total ?? 0 };
              });
            } else {
              series = cur.days.map((x, i) => ({ label: dateShort(x.date), full: dateLabel(x.date), value: x.total, prev: d.previous.days[i]?.total ?? 0 }));
            }
            const hourSeries: Pt[] = cur.hours.filter((h) => h.hour >= 6 && h.hour <= 23).map((h) => ({ label: String(h.hour).padStart(2, '0'), full: `Pukul ${String(h.hour).padStart(2, '0')}.00`, value: h.total }));
            const days = dayDiff(d.range.from, d.range.to) + 1;
            return (
              <>
                <div className="kpis">
                  <div className="kpi hero" data-kpi="total">
                    <div className="k-label">Omzet{multi ? ' semua cabang' : ''}</div>
                    <div className="k-value">{rp(k.total)}</div>
                    <Delta pct={dp.total} vs={vs} />
                    <div className="k-sub">
                      Bersih {rp(k.net)} (tanpa pajak & servis){k.refundTotal ? ` · refund ${rp(k.refundTotal)}` : ''}
                    </div>
                  </div>
                  <div className="kpi" data-kpi="orders">
                    <div className="k-label">Transaksi</div>
                    <div className="k-value">{num(k.orders)}</div>
                    <Delta pct={dp.orders} vs={vs} />
                  </div>
                  <div className="kpi">
                    <div className="k-label">Rata-rata per transaksi</div>
                    <div className="k-value">
                      <Money v={k.avg} />
                    </div>
                    <Delta pct={dp.avg} vs={vs} />
                  </div>
                  <div className="kpi">
                    <div className="k-label">Item terjual</div>
                    <div className="k-value">{num(k.items)}</div>
                    <Delta pct={dp.items} vs={vs} />
                  </div>
                </div>
                <div className="kpis">
                  <div className="kpi">
                    <div className="k-label">Diskon diberikan</div>
                    <div className="k-value">
                      <Money v={k.discount} />
                    </div>
                    <Delta pct={dp.discount} upGood={false} vs={vs} />
                  </div>
                  <div className="kpi">
                    <div className="k-label">Pajak (PB1)</div>
                    <div className="k-value">
                      <Money v={k.tax} />
                    </div>
                    <div className="k-sub">{k.service ? `Biaya layanan ${rp(k.service)}` : 'tanpa biaya layanan'}</div>
                  </div>
                  <div className="kpi">
                    <div className="k-label">Void</div>
                    <div className="k-value">{num(k.voids)}</div>
                    <div className="k-sub">{rp(k.voidTotal)} dibatalkan</div>
                  </div>
                  <div className="kpi">
                    <div className="k-label">Rata-rata omzet harian</div>
                    <div className="k-value">
                      <Money v={d.dailyAverage} />
                    </div>
                    <div className="k-sub">{days} hari</div>
                  </div>
                </div>
                <div className="dash-grid">
                  <section className={`chart-card ${multi ? 'span-8' : 'span-12'}`}>
                    <header>
                      <div>
                        <h3>Tren omzet {single ? 'per jam' : 'per hari'}</h3>
                        <p>Batang = periode ini · garis abu = periode sebelumnya</p>
                      </div>
                      <div className="right">
                        <div className="legend">
                          <span>
                            <i className="box" style={{ background: 'var(--viz-accent)' }} />
                            Periode ini
                          </span>
                          <span>
                            <i style={{ background: 'var(--viz-muted)' }} />
                            Sebelumnya
                          </span>
                        </div>
                        <button className="btn ghost xs" data-tbl="trend" onClick={() => setTbl({ ...tbl, trend: !tbl.trend })}>
                          {tbl.trend ? 'Grafik' : 'Tabel'}
                        </button>
                      </div>
                    </header>
                    {tbl.trend ? (
                      <SimpleTable
                        cols={[
                          { label: single ? 'Jam' : 'Tanggal', get: (x: Pt) => x.full ?? x.label },
                          { label: 'Periode ini', r: true, get: (x: Pt) => rp(x.value) },
                          { label: 'Sebelumnya', r: true, get: (x: Pt) => rp(x.prev ?? 0) },
                        ]}
                        rows={series}
                      />
                    ) : (
                      <ColumnChart data={series} fmt={rp} />
                    )}
                  </section>
                  {multi && (
                    <section className="chart-card span-4">
                      <header>
                        <div>
                          <h3>Omzet per cabang</h3>
                          <p>{periodLabel()}</p>
                        </div>
                      </header>
                      <HBars rows={cur.branches.map((b) => ({ label: b.name, value: b.total }))} fmt={rp} />
                    </section>
                  )}
                  <section className="chart-card span-6">
                    <header>
                      <div>
                        <h3>Jam ramai</h3>
                        <p>Total omzet per jam selama periode — untuk mengatur jadwal staf</p>
                      </div>
                      <div className="right">
                        <button className="btn ghost xs" data-tbl="hours" onClick={() => setTbl({ ...tbl, hours: !tbl.hours })}>
                          {tbl.hours ? 'Grafik' : 'Tabel'}
                        </button>
                      </div>
                    </header>
                    {tbl.hours ? (
                      <SimpleTable
                        cols={[
                          { label: 'Jam', get: (x: Pt) => x.full ?? x.label },
                          { label: 'Omzet', r: true, get: (x: Pt) => rp(x.value) },
                          { label: 'Transaksi', r: true, get: (x: Pt) => num(cur.hours[+x.label]?.orders ?? 0) },
                        ]}
                        rows={hourSeries}
                      />
                    ) : (
                      <ColumnChart data={hourSeries} fmt={rp} height={200} />
                    )}
                  </section>
                  <section className="chart-card span-6">
                    <header>
                      <div>
                        <h3>Metode pembayaran</h3>
                        <p>Nominal & porsi</p>
                      </div>
                    </header>
                    <HBars rows={cur.payments.filter((x) => x.amount > 0).map((x) => ({ label: x.name, value: x.amount }))} fmt={rp} />
                  </section>
                  <section className="chart-card span-6" data-top-items>
                    <header>
                      <div>
                        <h3>Menu terlaris</h3>
                        <p>Berdasarkan omzet</p>
                      </div>
                      <div className="right">
                        <a className="btn ghost xs" href="#/kantor/laporan">
                          Semua menu
                        </a>
                      </div>
                    </header>
                    {d.topItems.length ? (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Menu</th>
                            <th className="r">Terjual</th>
                            <th className="r">Omzet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.topItems.map((it, i) => (
                            <tr key={it.id}>
                              <td className="n muted">{i + 1}</td>
                              <td>
                                {it.name}
                                <span className="sub">{it.categoryName}</span>
                              </td>
                              <td className="r">{num(it.qty)}</td>
                              <td className="r">{rp(it.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted">Belum ada penjualan.</p>
                    )}
                  </section>
                  <section className="chart-card span-6">
                    <header>
                      <div>
                        <h3>Tipe pesanan</h3>
                        <p>Dine in, take away, & ojol</p>
                      </div>
                    </header>
                    <HBars rows={cur.channels.filter((x) => x.total > 0).map((x) => ({ label: x.name, value: x.total }))} fmt={rp} />
                    <h3 style={{ margin: '18px 0 10px', fontSize: 14.5 }}>Kategori</h3>
                    <HBars rows={cur.categories.filter((x) => x.amount > 0).slice(0, 8).map((x) => ({ label: x.name, value: x.amount }))} fmt={rp} />
                  </section>
                  {d.branchStatus.length > 1 && (
                    <section className="table-card span-12" data-branch-status>
                      <div className="row" style={{ padding: '14px 16px 8px' }}>
                        <h3 style={{ margin: 0, fontSize: 14.5 }}>Kondisi cabang hari ini</h3>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {dateLabel(d.today, true)}
                        </span>
                      </div>
                      <div className="table-scroll">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Cabang</th>
                              <th className="r">Omzet hari ini</th>
                              <th className="r">Transaksi</th>
                              <th className="r">Tagihan terbuka</th>
                              <th>Shift kasir</th>
                              <th>Aktivitas terakhir</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.branchStatus.map((s) => (
                              <tr key={s.branchId}>
                                <td>
                                  <b>{s.name}</b>
                                </td>
                                <td className="r">{rp(s.total)}</td>
                                <td className="r">{num(s.orders)}</td>
                                <td className="r">{num(s.openBills)}</td>
                                <td>
                                  {s.openShifts ? (
                                    <span className="tag green">
                                      <span className="dot" />
                                      {s.openShifts} terbuka
                                    </span>
                                  ) : (
                                    <span className="tag">Tutup</span>
                                  )}
                                </td>
                                <td>
                                  {s.lastActivity ? `${clock(ms(s.lastActivity), tzOf(s.branchId))} · ${ago(Date.now() - ms(s.lastActivity))} lalu` : <span className="muted">—</span>}
                                  {s.lastSeen ? <span className="sub">perangkat terakhir online {ago(Date.now() - ms(s.lastSeen))} lalu</span> : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              </>
            );
          }}
        </Body>
      </div>
    </>
  );
}
