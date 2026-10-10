/* Daftar transaksi semua cabang dengan detail struk, jejak log, dan refund (cabang perangkat ini). */
import { dateTime, rp } from '@robucca/core';
import { useEffect, useState } from 'react';
import { requireApproval } from '../../components/approve';
import { Icon } from '../../lib/icons';
import { S, can } from '../../state';
import { Drawer, openLayer, promptBox, toast, useLayerClose } from '../../ui/overlay';
import { csv, errText, fileRange, ms, oc, oget, periodLabel, rangeQ, scopeLabel, tzOf } from '../lib';
import type { TxDetail, TxList, TxRow } from '../types';
import { Body, FilterBar, PageHead, useLoad } from '../ui';

const PAGE = 50;
const STATUSES: [string, string][] = [
  ['', 'Semua status'], ['paid', 'Lunas'], ['open', 'Belum dibayar'], ['void', 'Void'], ['refunded', 'Direfund'],
];
const STATUS_TAG: Record<string, [string, string]> = {
  PAID: ['Lunas', 'green'], OPEN: ['Belum dibayar', 'amber'], AWAITING_PAYMENT: ['Menunggu bayar', 'amber'], VOIDED: ['Void', 'red'], REFUNDED: ['Direfund', 'red'],
};
export const StatusTag = ({ s }: { s: string }) => {
  const [l, c] = STATUS_TAG[s] ?? [s, ''];
  return <span className={`tag ${c}`}>{l}</span>;
};
const when = (o: { paidAt: string | null; createdAt: string }) => ms(o.paidAt ?? o.createdAt);

export default function TransactionsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setQd(q);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const l = useLoad(() => oget<TxList>(`/office/transactions${rangeQ({ status, q: qd, limit: PAGE, offset })}`), [status, qd, offset]);
  return (
    <>
      <PageHead
        title="Transaksi"
        sub={`${scopeLabel()} · ${periodLabel()}`}
        actions={
          <button
            className="btn ghost sm"
            data-csv
            onClick={() => csv(`/office/transactions${rangeQ({ status, q: qd })}`, `robucca-transaksi-${fileRange()}`).catch((e: unknown) => toast(errText(e), 'err'))}
          >
            <Icon name="download" size="sm" /> Ekspor CSV
          </button>
        }
      />
      <div className="page">
        <FilterBar
          extra={
            <>
              <span className="sep" />
              <select
                className="select sm"
                data-status
                aria-label="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                {STATUSES.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="input-wrap right" style={{ width: 240 }}>
                <Icon name="search" size="sm" />
                <input className="input sm" data-q type="search" placeholder="Nomor, nama, meja, kasir" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
              </div>
            </>
          }
        />
        <Body l={l}>
          {(d) => (
            <>
              <p className="hint" style={{ margin: '0 0 10px' }}>
                {d.summary.paidCount} transaksi lunas · {rp(d.summary.paidTotal)} (sebelum refund)
              </p>
              <div className="table-card" id="t-table">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Nomor</th>
                        <th>Waktu</th>
                        <th>Cabang</th>
                        <th>Kasir</th>
                        <th>Tipe</th>
                        <th>Pembayaran</th>
                        <th className="r">Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.length ? (
                        d.rows.map((o) => (
                          <tr key={o.id} className="click" data-id={o.id} onClick={() => void openTx(o.id, l.reload)}>
                            <td>
                              <b>{o.number}</b>
                              {o.queueNumber ? <span className="sub">antrean {o.queueNumber}</span> : null}
                            </td>
                            <td className="n">{dateTime(when(o), tzOf(o.branchId))}</td>
                            <td>{o.branchName}</td>
                            <td>{o.cashierName ?? '-'}</td>
                            <td>
                              {o.channelName ?? o.type}
                              {o.tableNumber ? <span className="sub">Meja {o.tableNumber}</span> : null}
                            </td>
                            <td>{o.payments.map((p) => p.name).join(' + ') || '—'}</td>
                            <td className="r">{o.status === 'VOIDED' ? <s className="muted">{rp(o.totals.total)}</s> : rp(o.totals.total)}</td>
                            <td>
                              <StatusTag s={o.status} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                            Tidak ada transaksi.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="pager">
                  <span>{d.total ? `${offset + 1}–${Math.min(offset + PAGE, d.total)} dari ${d.total} transaksi` : ''}</span>
                  <div className="row">
                    <button className="btn ghost sm" data-pg="-1" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                      <Icon name="chevron-left" size="sm" /> Sebelumnya
                    </button>
                    <button className="btn ghost sm" data-pg="1" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>
                      Berikutnya <Icon name="chevron-right" size="sm" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

/** Drawer detail transaksi (dipakai juga dari halaman shift). */
export async function openTx(id: string, after?: () => void): Promise<void> {
  let o: TxDetail;
  try {
    o = await oget<TxDetail>(`/office/transactions/${id}`);
  } catch (e) {
    toast(errText(e), 'err');
    return;
  }
  const changed = await openLayer<boolean>(() => <TxDrawer o={o} />);
  if (changed) after?.();
}

const AUDIT: Record<string, string> = {
  'order.void': 'Void', 'order.refund': 'Refund', 'order.discount': 'Diskon', 'order.line.void': 'Batal item', 'order.create': 'Dibuat', 'order.paid': 'Dibayar',
};

function TxDrawer({ o }: { o: TxDetail }) {
  const close = useLayerClose();
  const tz = o.branch.timezone;
  const t = o.totals;
  const here = S.be.device?.branchId && S.be.branch?.code === o.branch.code;
  const refund = async () => {
    const reason = await promptBox({ title: `Refund ${o.number}?`, text: `Uang ${rp(t.total)} dikembalikan ke pelanggan. Pesanan tercatat sebagai refund.`, label: 'Alasan refund', presets: ['Pesanan salah', 'Pelanggan komplain', 'Dobel bayar'], ok: 'Refund', danger: true, minLength: 3 });
    if (!reason) return;
    const ap = await requireApproval('refund', { title: 'Persetujuan refund', text: `${o.number} · ${rp(t.total)}` });
    if (!ap) return;
    try {
      await oc('POST', `/orders/${o.id}/refund`, { reason, ...(ap.token ? { approval: ap.token } : {}) });
      toast('Refund tercatat');
      close(true);
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  return (
    <Drawer
      title={o.number}
      sub={`${o.branch.name} · ${dateTime(ms(o.paidAt ?? o.createdAt), tz)}`}
      foot={
        <>
          {o.status === 'PAID' && here && can('approve.refund') ? (
            <button className="btn danger ghost" data-od="refund" onClick={() => void refund()}>
              <Icon name="undo" size="sm" /> Refund
            </button>
          ) : o.status === 'PAID' && !here ? (
            <span className="hint">Refund dilakukan dari kasir cabang {o.branch.name}.</span>
          ) : null}
          <button className="btn ghost" onClick={() => close(false)}>
            Tutup
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
        <StatusTag s={o.status} />
        <span className="tag">{o.channel?.name ?? o.type}</span>
        {o.source === 'PWA' && <span className="tag blue">Pesan online</span>}
        {o.tableNumber && <span className="tag">Meja {o.tableNumber}</span>}
        {o.device && <span className="tag">T{o.device.terminalNo}</span>}
      </div>
      <dl className="kv">
        <dt>Kasir</dt>
        <dd>{o.cashier?.name ?? '—'}</dd>
        {o.customerName && (
          <>
            <dt>Pelanggan</dt>
            <dd>
              {o.customerName}
              {o.customerPhone ? ` · ${o.customerPhone}` : ''}
            </dd>
          </>
        )}
        {o.platformOrderRef && (
          <>
            <dt>No. ojol</dt>
            <dd>{o.platformOrderRef}</dd>
          </>
        )}
        {o.note && (
          <>
            <dt>Catatan</dt>
            <dd>{o.note}</dd>
          </>
        )}
      </dl>
      <h3 className="card-title" style={{ marginTop: 16 }}>
        Item
      </h3>
      {o.items.map((it) => (
        <div key={it.id} className="sum-row" style={{ padding: '6px 0', alignItems: 'flex-start' }}>
          <span>
            {it.voidedAt ? <s>{`${it.quantity}× ${it.productName}`}</s> : `${it.quantity}× ${it.productName}`}
            {it.modifiers.length ? <span className="sub muted" style={{ display: 'block', fontSize: 12 }}>{it.modifiers.map((m) => m.optionName).join(', ')}</span> : null}
            {it.note ? <span className="sub muted" style={{ display: 'block', fontSize: 12 }}>“{it.note}”</span> : null}
            {it.voidedAt ? <span className="sub neg" style={{ display: 'block', fontSize: 12 }}>dibatalkan: {it.voidReason}</span> : null}
          </span>
          <b>{rp(it.lineTotal)}</b>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
        <div className="sum-row">
          <span>Subtotal</span>
          <span>{rp(t.gross)}</span>
        </div>
        {t.discount ? (
          <div className="sum-row">
            <span>Diskon{o.promotion ? ` · ${o.promotion.name}` : o.discountNote ? ` · ${o.discountNote}` : ''}{o.discountApprovedBy ? ` (disetujui ${o.discountApprovedBy.name})` : ''}</span>
            <span>−{rp(t.discount)}</span>
          </div>
        ) : null}
        {t.service ? (
          <div className="sum-row">
            <span>Biaya layanan</span>
            <span>{rp(t.service)}</span>
          </div>
        ) : null}
        <div className="sum-row">
          <span>Pajak</span>
          <span>{rp(t.tax)}</span>
        </div>
        {t.rounding ? (
          <div className="sum-row">
            <span>Pembulatan</span>
            <span>{rp(t.rounding)}</span>
          </div>
        ) : null}
        <div className="sum-row" style={{ fontWeight: 700 }}>
          <span>Total</span>
          <span>{rp(t.total)}</span>
        </div>
      </div>
      <h3 className="card-title" style={{ marginTop: 16 }}>
        Pembayaran
      </h3>
      {o.payments.length ? (
        o.payments.map((p) => (
          <div key={p.id} className="sum-row" style={{ padding: '4px 0' }}>
            <span>
              {p.method}
              {p.reference ? ` · ref ${p.reference}` : ''}
              {p.changeAmount ? ` · kembali ${rp(p.changeAmount)}` : ''}
            </span>
            <b>{rp(p.amount)}</b>
          </div>
        ))
      ) : (
        <p className="muted">Belum dibayar.</p>
      )}
      {o.voidedAt && (
        <div className="note red" style={{ marginTop: 14 }}>
          <Icon name="alert" size="sm" />
          <span>
            Void oleh {o.voidedBy?.name ?? '—'}: “{o.voidReason}”
          </span>
        </div>
      )}
      {o.refund && (
        <div className="note red" style={{ marginTop: 14 }} data-refund>
          <Icon name="undo" size="sm" />
          <span>
            Refund {rp(o.refund.amount)} · {dateTime(ms(o.refund.createdAt), tz)} · disetujui {o.refund.approvedBy.name}: “{o.refund.reason}”
          </span>
        </div>
      )}
      {o.audit.length ? (
        <>
          <h3 className="card-title" style={{ marginTop: 16 }}>
            Jejak
          </h3>
          {o.audit.map((a) => (
            <div key={a.id} className="sum-row" style={{ padding: '4px 0', fontSize: 12.5 }}>
              <span>
                {dateTime(ms(a.createdAt), tz)} · {AUDIT[a.action] ?? a.action}
              </span>
              <span className="muted">{a.actor?.name ?? 'Sistem'}</span>
            </div>
          ))}
        </>
      ) : null}
    </Drawer>
  );
}

export type { TxRow };
