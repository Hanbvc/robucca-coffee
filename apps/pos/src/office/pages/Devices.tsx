/* Perangkat kasir/dapur/kantor yang terhubung ke server pusat: pasangkan (kode 6 digit), kode ulang, cabut akses. */
import { ago, dateTime } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { S } from '../../state';
import { confirmBox, Modal, openLayer, toast } from '../../ui/overlay';
import { activeBranches, errText, me, ms, oc, oget } from '../lib';
import { Body, PageHead, useLoad } from '../ui';

interface Dev {
  id: string; name: string; branchId: string | null; terminalNo: number; lastSeenAt: string | null; revokedAt: string | null; createdAt: string;
  pairingExpiresAt: string | null; branch: { code: string; name: string } | null; paired: boolean; status: 'ONLINE' | 'OFFLINE' | 'PENDING' | 'REVOKED';
}

export default function DevicesPage() {
  const l = useLoad(() => oget<Dev[]>('/office/devices'), []);
  const revoke = async (d: Dev) => {
    if (!(await confirmBox({ title: `Cabut akses ${d.name}?`, text: 'Perangkat tidak bisa lagi mengirim/menarik data. Data yang belum terkirim di perangkat itu tidak akan masuk ke server.', ok: 'Cabut akses', danger: true }))) return;
    try {
      await oc('DELETE', `/office/devices/${d.id}`);
      toast('Akses perangkat dicabut', 'warn');
      l.reload();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  const recode = async (d: Dev) => {
    if (d.paired && !(await confirmBox({ title: `Buat kode pasang baru untuk ${d.name}?`, text: 'Perangkat lama di terminal ini akan terputus dan harus dipasangkan ulang dengan kode baru.', ok: 'Buat kode' }))) return;
    try {
      const r = await oc<{ code: string; expiresAt: string }>('POST', `/office/devices/${d.id}/pairing-code`);
      await showCode(r.code, r.expiresAt, d.name, d.branch?.name ?? null, d.terminalNo);
      l.reload();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  return (
    <>
      <PageHead
        title="Perangkat"
        sub="Kasir, tablet dapur, dan komputer kantor yang terhubung ke server"
        actions={
          <button className="btn sm" data-new disabled={!l.data} onClick={() => void pairDialog(l.data ?? []).then((ok) => ok && l.reload())}>
            <Icon name="plus" size="sm" /> Pasangkan perangkat
          </button>
        }
      />
      <div className="page">
        <Body l={l}>
          {(rows) => (
            <>
              <div className="table-card" id="dv-table">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Perangkat</th>
                        <th>Cabang</th>
                        <th>Terminal</th>
                        <th>Dibuat</th>
                        <th>Terakhir online</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length ? (
                        rows.map((d) => (
                          <tr key={d.id} data-device={d.name}>
                            <td>
                              <b>{d.name}</b>
                              {d.id === S.be.device?.id && <span className="tag blue"> perangkat ini</span>}
                            </td>
                            <td>{d.branch ? d.branch.name : <span className="tag dark">Kantor pusat</span>}</td>
                            <td>{d.branchId ? `T${d.terminalNo}` : '—'}</td>
                            <td className="n">{dateTime(ms(d.createdAt))}</td>
                            <td>{d.lastSeenAt ? `${ago(Date.now() - ms(d.lastSeenAt))} lalu` : '—'}</td>
                            <td>
                              {d.status === 'REVOKED' ? (
                                <span className="tag red">Dicabut</span>
                              ) : d.status === 'PENDING' ? (
                                <span className="tag amber">Menunggu dipasang</span>
                              ) : d.status === 'ONLINE' ? (
                                <span className="tag green">
                                  <span className="dot" />
                                  Online
                                </span>
                              ) : (
                                <span className="tag">Offline</span>
                              )}
                            </td>
                            <td className="r nowrap">
                              {d.id !== S.be.device?.id && (
                                <button className="btn ghost xs" data-recode={d.id} onClick={() => void recode(d)}>
                                  <Icon name="key" size="xs" /> Kode pasang
                                </button>
                              )}{' '}
                              {d.status !== 'REVOKED' && d.id !== S.be.device?.id && (
                                <button className="btn danger ghost xs" data-revoke={d.id} onClick={() => void revoke(d)}>
                                  Cabut akses
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                            Belum ada perangkat.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                Nomor terminal dipakai di nomor struk (mis. IJN<b>2</b>-…) agar tiap kasir di cabang yang sama punya urutan sendiri.
              </p>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

function pairDialog(rows: Dev[]): Promise<boolean> {
  return openLayer<boolean>((close) => <PairBody rows={rows} close={close} />).then((v) => !!v);
}
function PairBody({ rows, close }: { rows: Dev[]; close: (v?: boolean) => void }) {
  const opts = [...(me().allBranches ? [{ id: '', name: 'Kantor pusat (laporan & pengaturan saja)' }] : []), ...activeBranches()];
  const nextNo = (bid: string) => Math.max(0, ...rows.filter((d) => (d.branchId ?? '') === bid && d.status !== 'REVOKED').map((d) => d.terminalNo || 0)) + 1;
  const first = opts.find((o) => o.id === S.be.device?.branchId)?.id ?? opts[0]?.id ?? '';
  const [bid, setBid] = useState(first);
  const [name, setName] = useState('Kasir');
  const [no, setNo] = useState(nextNo(first));
  const [err, setErr] = useState('');
  const go = async () => {
    try {
      const r = await oc<{ device: { id: string }; code: string; expiresAt: string }>('POST', '/office/devices', { branchId: bid || null, name: name.trim() || 'Kasir', terminalNo: bid ? no : 0 });
      close(true);
      await showCode(r.code, r.expiresAt, name.trim() || 'Kasir', opts.find((o) => o.id === bid)?.name ?? null, bid ? no : 0);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title="Pasangkan perangkat baru"
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-ok onClick={() => void go()}>
            Buat kode pasang
          </button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span>Untuk</span>
          <select
            className="select"
            id="d-b"
            value={bid}
            onChange={(e) => {
              setBid(e.target.value);
              setNo(nextNo(e.target.value));
            }}
          >
            {opts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nama perangkat</span>
          <input className="input" id="d-n" value={name} placeholder="mis. Kasir depan, Tablet bar" onChange={(e) => setName(e.target.value)} />
        </label>
        {bid && (
          <label className="field">
            <span>Nomor terminal</span>
            <input className="input" id="d-t" type="number" min={1} max={99} value={no} onChange={(e) => setNo(Number(e.target.value) || 1)} />
          </label>
        )}
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Modal>
  );
}

function showCode(code: string, expiresAt: string, name: string, branch: string | null, terminalNo: number): Promise<unknown> {
  return openLayer((close) => (
    <Modal
      title="Kode pasang"
      sub={`${name} · ${branch ? `${branch} · Terminal ${terminalNo}` : 'Kantor pusat'}`}
      size="sm"
      foot={
        <button className="btn" onClick={() => close()}>
          Selesai
        </button>
      }
    >
      <div className="code-box" data-code>
        {code}
      </div>
      <ol style={{ margin: '14px 0 0', paddingLeft: 20, lineHeight: 1.7, color: 'var(--ink-2)' }}>
        <li>Di perangkat baru, buka aplikasi kasir Robucca</li>
        <li>
          Pilih <b>Hubungkan ke server pusat</b>
        </li>
        <li>Masukkan kode di atas</li>
      </ol>
      <p className="hint" style={{ marginTop: 10 }}>
        Kode berlaku sampai {dateTime(ms(expiresAt))} dan hanya bisa dipakai sekali.
      </p>
    </Modal>
  ));
}
