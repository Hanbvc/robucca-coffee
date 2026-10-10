/* Shift kasir: buka dengan kas awal, kas masuk/keluar, tutup & hitung kas (pecahan atau total).
   Port dari pos/js/views/shift.js. Kas seharusnya dihitung sama dengan server (closeShiftTotals). */
import { DENOMINATIONS, ago, clock, countDenominations, dateTime, rp, uuidv7 } from '@robucca/core';
import { useEffect, useState } from 'react';
import { printHTML, shiftHTML } from '../components/receipt';
import type { CashMove, Order, Shift } from '../data/types';
import { useBus } from '../lib/bus';
import { Icon } from '../lib/icons';
import { shiftSummary, type ShiftSummary } from '../ops';
import { S, branch, logout, setShift, settings } from '../state';
import { Numpad, keyToNp, npKey, useKeys } from '../ui/common';
import { confirmBox, Modal, openLayer, toast, type Close } from '../ui/overlay';

/* ---------- dialog nominal dengan numpad ---------- */
interface AmountOpts {
  title: string;
  sub?: string;
  ok?: string;
  quick?: number[];
  reason?: boolean;
  reasons?: string[];
  allowZero?: boolean;
}

function AmountBody({ o, close }: { o: AmountOpts; close: Close<{ amount: number; reason: string }> }) {
  const [v, setV] = useState('');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState('');
  const n = v ? parseInt(v, 10) : 0;
  const submit = () => {
    if (o.allowZero === false && n <= 0) return setErr('Nominal harus lebih dari 0.');
    if (o.reason && !why.trim()) return setErr('Isi keterangan.');
    close({ amount: n, reason: why.trim() });
  };
  useKeys(
    (e) => {
      const k = keyToNp(e);
      if (k) setV((x) => npKey(x, k));
      else if (e.key === 'Enter') submit();
    },
    [v, why],
  );
  return (
    <Modal
      title={o.title}
      sub={o.sub}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(undefined)}>
            Batal
          </button>
          <button className="btn" data-ok onClick={submit}>
            {o.ok ?? 'Simpan'}
          </button>
        </>
      }
    >
      <div className="amount-box" style={{ marginTop: 0 }}>
        <label>Nominal</label>
        <div className="big num" id="ad-v">
          {rp(n)}
        </div>
      </div>
      {o.quick?.length ? (
        <div className="quick-cash">
          {o.quick.map((q) => (
            <button key={q} className="chip" data-q={q} onClick={() => setV(String(q || ''))}>
              {rp(q)}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Numpad onKey={(k) => setV((x) => npKey(x, k))} />
      </div>
      {o.reason && (
        <>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Keterangan</span>
            <input className="input" id="ad-r" placeholder="mis. beli es batu" autoComplete="off" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          {o.reasons?.length ? (
            <div className="quick-notes">
              {o.reasons.map((r) => (
                <button key={r} className="chip sm" onClick={() => setWhy(r)}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      {err && <p className="err-text">{err}</p>}
    </Modal>
  );
}

export function amountDialog(o: AmountOpts): Promise<{ amount: number; reason: string } | null> {
  return openLayer<{ amount: number; reason: string }>((close) => <AmountBody o={o} close={close} />).then((v) => v ?? null);
}

/** Buka shift baru di perangkat ini. */
export async function openShiftDialog(): Promise<Shift | null> {
  const b = branch();
  // Mode server: terminal ini mungkin masih punya shift terbuka di server (mis. perangkat dipasang ulang).
  if (S.be.isServer) {
    const open = await S.be.resumeServerShift().catch(() => null);
    if (open) {
      setShift(open);
      toast(`Melanjutkan shift terbuka dari server · dibuka ${open.openedByName}`);
      return open;
    }
  }
  const r = await amountDialog({
    title: 'Buka shift kasir',
    sub: `${b.name} · Terminal ${S.be.device!.terminalNo}. Hitung uang di laci sebagai kas awal.`,
    ok: 'Buka shift',
    quick: [0, 200000, 300000, 500000, 1000000],
  });
  if (!r) return null;
  const now = Date.now();
  const shift: Shift = {
    id: uuidv7(now), branchId: b.id, deviceId: S.be.device!.id, terminalNo: S.be.device!.terminalNo, bizDate: S.be.today(), status: 'OPEN',
    openedAt: now, openedById: S.user!.id, openedByName: S.user!.name, openingCash: r.amount, version: 0, updatedAt: now,
  };
  const [saved] = await S.be.save('shifts', shift);
  setShift(saved!);
  toast(`Shift dibuka · kas awal ${rp(r.amount)}`);
  return saved!;
}

async function summaryOf(shift: Shift): Promise<{ sum: ShiftSummary; moves: CashMove[]; orders: Order[] }> {
  const orders = await S.be.shiftOrders(shift.id);
  const moves = await S.be.cashMovesOf(shift.id);
  return { sum: shiftSummary(shift, orders, moves), moves, orders };
}

/* ---------- tutup shift ---------- */
function CloseBody({ sum, close }: { sum: ShiftSummary; close: Close<{ counted: number; note: string; denoms: Record<string, number> | null }> }) {
  const [mode, setMode] = useState<'count' | 'direct'>('count');
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(DENOMINATIONS.map((d) => [String(d), 0])));
  const [direct, setDirect] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const counted = mode === 'count' ? countDenominations(counts) : direct ? parseInt(direct, 10) : 0;
  const diff = counted - sum.expected;
  const ok = () => {
    if (diff && !note.trim()) return setErr('Jelaskan selisih kas di catatan.');
    close({ counted, note: note.trim(), denoms: mode === 'count' ? Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) : null });
  };
  return (
    <Modal
      title="Tutup shift"
      sub="Hitung uang tunai di laci, lalu bandingkan dengan kas seharusnya."
      size="lg"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(undefined)}>
            Batal
          </button>
          <button className="btn danger" data-ok onClick={ok}>
            Tutup shift
          </button>
        </>
      }
    >
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={mode === 'count' ? 'on' : ''} data-mode="count" onClick={() => setMode('count')}>
          Hitung pecahan
        </button>
        <button className={mode === 'direct' ? 'on' : ''} data-mode="direct" onClick={() => setMode('direct')}>
          Masukkan total
        </button>
      </div>
      <div className="pay-wrap">
        <div>
          {mode === 'count' ? (
            <table className="table">
              <tbody>
                {DENOMINATIONS.map((d) => (
                  <tr key={d}>
                    <td className="n">{rp(d)}</td>
                    <td>
                      <div className="stepper" style={{ padding: 2 }}>
                        <button data-dn={d} data-dd="-1" aria-label="Kurangi" onClick={() => setCounts((c) => ({ ...c, [d]: Math.max(0, (c[d] ?? 0) - 1) }))}>
                          <Icon name="minus" size="sm" />
                        </button>
                        <b>{counts[d]}</b>
                        <button data-dn={d} data-dd="1" aria-label="Tambah" onClick={() => setCounts((c) => ({ ...c, [d]: (c[d] ?? 0) + 1 }))}>
                          <Icon name="plus" size="sm" />
                        </button>
                      </div>
                    </td>
                    <td className="r">{rp(d * (counts[d] ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <div className="amount-box" style={{ marginTop: 0 }}>
                <label>Total uang di laci</label>
                <div className="big num">{rp(counted)}</div>
              </div>
              <div style={{ marginTop: 12 }}>
                <Numpad onKey={(k) => setDirect((x) => npKey(x, k))} />
              </div>
            </>
          )}
        </div>
        <div className="col">
          <div className="mini">
            <small>Kas seharusnya</small>
            <b>{rp(sum.expected)}</b>
          </div>
          <div className="mini">
            <small>Kas dihitung</small>
            <b id="cs-counted">{rp(counted)}</b>
          </div>
          <div className="mini" style={{ background: diff === 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}>
            <small>Selisih</small>
            <b className={diff === 0 ? 'pos' : 'neg'} id="cs-diff">
              {diff > 0 ? '+' : ''}
              {rp(diff)}
            </b>
          </div>
          <label className="field">
            <span>Catatan {diff ? <em>(wajib bila ada selisih)</em> : <em>(opsional)</em>}</span>
            <textarea className="textarea" id="cs-note" rows={3} placeholder="mis. uang kembalian kurang Rp2.000" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {err && <p className="err-text">{err}</p>}
        </div>
      </div>
    </Modal>
  );
}

export function ShiftView() {
  const b = branch();
  const tz = b.timezone;
  const [sh, setSh] = useState<Shift | null>(S.shift);
  const [data, setData] = useState<{ sum: ShiftSummary; moves: CashMove[] } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const cur = await S.be.currentShift();
    setShift(cur);
    setSh(cur);
    setData(cur ? await summaryOf(cur) : null);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);
  useBus(['orders', 'cashMoves', 'shifts'], () => void load());

  const cash = async (type: 'CASH_IN' | 'CASH_OUT') => {
    if (!sh) return;
    const inn = type === 'CASH_IN';
    const r = await amountDialog({
      title: inn ? 'Kas masuk' : 'Kas keluar',
      sub: inn ? 'Uang yang ditambahkan ke laci (mis. tambahan uang kembalian).' : 'Uang yang diambil dari laci (mis. belanja kecil, setor).',
      reason: true,
      reasons: inn ? ['Tambahan uang kembalian', 'Setoran dari manajer'] : ['Beli es batu', 'Beli gas', 'Belanja bahan', 'Setor ke bank'],
      allowZero: false,
    });
    if (!r) return;
    const now = Date.now();
    const doc: CashMove = {
      id: uuidv7(now), branchId: sh.branchId, shiftId: sh.id, type, amount: r.amount, reason: r.reason, createdById: S.user!.id, createdByName: S.user!.name,
      createdAt: now, version: 0, updatedAt: now,
    };
    await S.be.save('cashMoves', doc);
    toast(`${inn ? 'Kas masuk' : 'Kas keluar'} ${rp(r.amount)} dicatat`);
  };

  const closeShift = async () => {
    if (!sh) return;
    const mine = (await S.be.openOrders()).filter((o) => o.deviceId === S.be.device!.id);
    if (
      mine.length &&
      !(await confirmBox({
        title: 'Masih ada tagihan terbuka',
        text: `${mine.length} tagihan dari terminal ini belum dibayar. Tagihan tetap tersimpan dan bisa dibayar di shift berikutnya. Lanjut tutup shift?`,
        ok: 'Lanjut',
      }))
    )
      return;
    const { sum } = await summaryOf(sh);
    const r = await openLayer<{ counted: number; note: string; denoms: Record<string, number> | null }>((close) => <CloseBody sum={sum} close={close} />);
    if (!r) return;
    const now = Date.now();
    const closed: Shift = {
      ...sh, status: 'CLOSED', closedAt: now, closedById: S.user!.id, closedByName: S.user!.name, countedCash: r.counted, countedDenominations: r.denoms,
      expectedCash: sum.expected, ...(r.note ? { differenceNote: r.note } : {}),
    };
    const [saved] = await S.be.save('shifts', closed);
    setShift(null);
    const diff = r.counted - sum.expected;
    await openLayer((close) => (
      <Modal
        title="Shift ditutup"
        size="sm"
        foot={
          <>
            <button className="btn ghost" onClick={() => printHTML(shiftHTML(saved!, sum, { branch: b, settings: settings() }), { paper: b.receiptPaperMm, title: 'Laporan shift' })}>
              <Icon name="printer" size="sm" /> Cetak laporan
            </button>
            <button className="btn" onClick={() => close()}>
              Selesai
            </button>
          </>
        }
      >
        <div className="done-box">
          <div className="ok">
            <Icon name="check" size="lg" />
          </div>
          <b>{diff === 0 ? 'Kas cocok' : `Selisih ${diff > 0 ? '+' : ''}${rp(diff)}`}</b>
          <span className="muted">
            {sum.count} transaksi · {rp(sum.total)}
          </span>
        </div>
      </Modal>
    ));
    logout(true);
  };

  if (!loaded) return null;
  if (!sh || !data) {
    return (
      <>
        <div className="topbar">
          <h1>Shift kasir</h1>
        </div>
        <div className="page">
          <div className="empty">
            <div className="em-ico">
              <Icon name="wallet" size="lg" />
            </div>
            <h3>Belum ada shift terbuka</h3>
            <p>Buka shift dengan menghitung kas awal di laci sebelum mulai berjualan.</p>
            <button
              className="btn"
              data-a="open"
              onClick={async () => {
                if (await openShiftDialog()) void load();
              }}
            >
              <Icon name="plus" size="sm" /> Buka shift
            </button>
          </div>
        </div>
      </>
    );
  }
  const { sum, moves } = data;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Shift kasir</h1>
          <div className="crumb">
            Terminal {sh.terminalNo} · dibuka {dateTime(sh.openedAt, tz)} oleh {sh.openedByName} · berjalan {ago(Date.now() - sh.openedAt)}
            {sh.syncError ? ` · ditolak server: ${sh.syncError}` : ''}
          </div>
        </div>
        <div className="right row">
          <button className="btn ghost sm" data-a="x" onClick={() => printHTML(shiftHTML(sh, sum, { branch: b, settings: settings() }), { paper: b.receiptPaperMm, title: 'Laporan shift' })}>
            <Icon name="printer" size="sm" /> Cetak laporan sementara
          </button>
          <button className="btn danger" data-a="close" onClick={() => void closeShift()}>
            <Icon name="lock" size="sm" /> Tutup shift
          </button>
        </div>
      </div>
      <div className="page">
        <div className="kpis">
          <div className="kpi">
            <div className="k-label">Kas seharusnya di laci</div>
            <div className="k-value" id="sh-expected">
              {rp(sum.expected)}
            </div>
            <div className="k-sub">Kas awal {rp(sh.openingCash)}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Penjualan shift</div>
            <div className="k-value">{rp(sum.total)}</div>
            <div className="k-sub">
              {sum.count} transaksi{sum.refunds ? ` · ${sum.refunds} refund` : ''}
              {sum.voids ? ` · ${sum.voids} void` : ''}
            </div>
          </div>
          <div className="kpi">
            <div className="k-label">Tunai dari penjualan</div>
            <div className="k-value">{rp(sum.cashSales - sum.cashRefunds)}</div>
            <div className="k-sub">{sum.cashRefunds ? `refund ${rp(sum.cashRefunds)}` : 'termasuk kembalian'}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Kas masuk / keluar</div>
            <div className="k-value">{rp(sum.cashIn - sum.cashOut)}</div>
            <div className="k-sub">
              +{rp(sum.cashIn)} / −{rp(sum.cashOut)}
            </div>
          </div>
        </div>
        <div className="two-col">
          <div className="table-card">
            <div className="row" style={{ padding: '14px 16px 6px' }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Kas masuk &amp; keluar</h3>
              <div className="right row">
                <button className="btn soft sm" data-a="in" onClick={() => void cash('CASH_IN')}>
                  <Icon name="plus" size="sm" /> Kas masuk
                </button>
                <button className="btn soft sm" data-a="out" onClick={() => void cash('CASH_OUT')}>
                  <Icon name="minus" size="sm" /> Kas keluar
                </button>
              </div>
            </div>
            {moves.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Keterangan</th>
                    <th>Oleh</th>
                    <th className="r">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {[...moves]
                    .sort((a, x) => x.createdAt - a.createdAt)
                    .map((mv) => (
                      <tr key={mv.id}>
                        <td className="n">{clock(mv.createdAt, tz)}</td>
                        <td>{mv.reason}</td>
                        <td>{mv.createdByName}</td>
                        <td className={`r ${mv.type === 'CASH_IN' ? 'pos' : 'neg'}`}>
                          {mv.type === 'CASH_IN' ? '+' : '−'}
                          {rp(mv.amount)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ padding: '6px 16px 16px', margin: 0 }}>
                Belum ada kas masuk/keluar. Catat setiap uang yang diambil atau ditambahkan ke laci agar hitungan kas cocok.
              </p>
            )}
          </div>
          <div className="card pad">
            <h3 className="card-title">
              <Icon name="wallet" size="sm" /> Per metode pembayaran
            </h3>
            {sum.byMethod.length ? (
              sum.byMethod.map((p) => (
                <div key={p.code} className="sum-row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                  <span>
                    {p.name} <span className="muted">· {p.count}x</span>
                  </span>
                  <b className="num">{rp(p.amount)}</b>
                </div>
              ))
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Belum ada transaksi.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
