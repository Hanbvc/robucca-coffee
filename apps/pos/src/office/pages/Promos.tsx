/* Promo & diskon yang bisa dipilih kasir (per cabang, periode, perlu persetujuan PIN manajer atau tidak).
   Manajer hanya membuat/mengubah promo cabangnya sendiri; promo semua cabang khusus pemilik. */
import { bpLabel, businessDate, dateShort, rp } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { settings } from '../../state';
import { MoneyInput } from '../../ui/common';
import { confirmBox, Modal, openLayer, toast } from '../../ui/overlay';
import { activeBranches, branchName, errText, me, ms, oc, oget } from '../lib';
import { Body, PageHead, Switch, useLoad } from '../ui';

interface Promo {
  id: string; name: string; type: 'PERCENT' | 'AMOUNT'; value: number; requiresApproval: boolean; allBranches: boolean; branchIds: string[];
  validFrom: string | null; validUntil: string | null; isActive: boolean; usedCount: number;
}
const TZ = 'Asia/Jakarta';
const ymd = (iso: string | null) => (iso ? businessDate(ms(iso), TZ) : '');

export default function PromosPage() {
  const l = useLoad(() => oget<Promo[]>('/office/promos'), []);
  const s = settings();
  return (
    <>
      <PageHead
        title="Promo & diskon"
        sub="Promo muncul di tombol Diskon kasir pada cabang & tanggal yang berlaku"
        actions={
          <button className="btn sm" data-new onClick={() => void editor(null).then((ok) => ok && l.reload())}>
            <Icon name="plus" size="sm" /> Promo baru
          </button>
        }
      />
      <div className="page">
        <div className="note blue" style={{ marginBottom: 14 }}>
          <Icon name="info" size="sm" />
          <span>
            Diskon manual kasir dibatasi {bpLabel(s?.maxCashierDiscountBp ?? 0)} (ubah di Pengaturan). Di atas batas itu, dan untuk promo bertanda “Perlu persetujuan”, kasir harus
            memasukkan PIN manajer — saat perangkat online.
          </span>
        </div>
        <Body l={l}>
          {(list) => (
            <div className="table-card" id="p-table">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Nilai</th>
                      <th>Cabang</th>
                      <th>Periode</th>
                      <th>Persetujuan</th>
                      <th className="r">Dipakai</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.length ? (
                      list.map((d) => {
                        const mine = me().allBranches || (!d.allBranches && d.branchIds.every((b) => activeBranches().some((x) => x.id === b)));
                        return (
                          <tr key={d.id} data-promo={d.name}>
                            <td>
                              <b>{d.name}</b>
                            </td>
                            <td>{d.type === 'PERCENT' ? bpLabel(d.value) : rp(d.value)}</td>
                            <td>{d.allBranches ? 'Semua cabang' : d.branchIds.map(branchName).join(', ')}</td>
                            <td>{d.validFrom || d.validUntil ? `${d.validFrom ? dateShort(ymd(d.validFrom)) : '…'} – ${d.validUntil ? dateShort(ymd(d.validUntil)) : '…'}` : 'Selalu'}</td>
                            <td>{d.requiresApproval ? <span className="tag amber">PIN manajer</span> : <span className="muted">—</span>}</td>
                            <td className="r">{d.usedCount}</td>
                            <td>{d.isActive ? <span className="tag green">Aktif</span> : <span className="tag">Nonaktif</span>}</td>
                            <td className="r">
                              {mine ? (
                                <button className="btn ghost xs" data-edit={d.id} onClick={() => void editor(d).then((ok) => ok && l.reload())}>
                                  <Icon name="edit" size="xs" /> Ubah
                                </button>
                              ) : (
                                <span className="hint">pusat</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                          Belum ada promo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Body>
      </div>
    </>
  );
}

function editor(p: Promo | null): Promise<boolean> {
  return openLayer<boolean>((close) => <PromoBody p={p} close={close} />).then((v) => !!v);
}

function PromoBody({ p, close }: { p: Promo | null; close: (v?: boolean) => void }) {
  const owner = me().allBranches;
  const branches = activeBranches();
  const [d, setD] = useState({
    name: p?.name ?? '', type: p?.type ?? ('PERCENT' as Promo['type']), pct: p && p.type === 'PERCENT' ? p.value / 100 : 10, amount: p && p.type === 'AMOUNT' ? p.value : 0,
    all: p ? p.allBranches : owner, branchIds: p?.branchIds ?? (branches.length === 1 ? [branches[0]!.id] : []), from: ymd(p?.validFrom ?? null), to: ymd(p?.validUntil ?? null),
    approval: p?.requiresApproval ?? false, active: p?.isActive ?? true,
  });
  const [err, setErr] = useState('');
  const save = async () => {
    const value = d.type === 'PERCENT' ? Math.round(Math.min(100, Number(d.pct) || 0) * 100) : d.amount;
    if (!d.name.trim() || value <= 0) return setErr('Isi nama dan nilai promo.');
    if (!d.all && !d.branchIds.length) return setErr('Pilih minimal satu cabang.');
    if (d.from && d.to && d.from > d.to) return setErr('Tanggal mulai melewati tanggal selesai.');
    const body = {
      name: d.name.trim(), type: d.type, value, allBranches: d.all, ...(d.all ? {} : { branchIds: d.branchIds }), validFrom: d.from || null, validUntil: d.to || null,
      requiresApproval: d.approval, isActive: d.active,
    };
    try {
      await oc(p ? 'PATCH' : 'POST', p ? `/office/promos/${p.id}` : '/office/promos', body);
      toast('Promo disimpan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const del = async () => {
    if (!p) return;
    if (!(await confirmBox({ title: `Hapus promo ${p.name}?`, text: 'Promo yang sudah dipakai transaksi hanya dinonaktifkan agar riwayat tetap utuh.', ok: 'Hapus', danger: true }))) return;
    try {
      const r = await oc<{ deleted: boolean }>('DELETE', `/office/promos/${p.id}`);
      toast(r.deleted ? 'Promo dihapus' : 'Promo sudah dipakai — dinonaktifkan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title={p ? `Ubah ${p.name}` : 'Promo baru'}
      size="sm"
      foot={
        <>
          {p ? (
            <button className="btn danger ghost" data-del onClick={() => void del()}>
              Hapus
            </button>
          ) : null}
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-ok onClick={() => void save()}>
            Simpan
          </button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span>Nama promo</span>
          <input className="input" id="p-name" value={d.name} placeholder="mis. Member 10%" autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <div className="row">
          <div className="seg">
            <button data-t="PERCENT" className={d.type === 'PERCENT' ? 'on' : ''} onClick={() => setD({ ...d, type: 'PERCENT' })}>
              Persen
            </button>
            <button data-t="AMOUNT" className={d.type === 'AMOUNT' ? 'on' : ''} onClick={() => setD({ ...d, type: 'AMOUNT' })}>
              Nominal
            </button>
          </div>
          {d.type === 'PERCENT' ? (
            <input className="input" id="p-val" type="number" min={0} max={100} step="0.5" value={d.pct} aria-label="Persen" onChange={(e) => setD({ ...d, pct: Number(e.target.value) })} />
          ) : (
            <MoneyInput className="input" id="p-val" value={d.amount} aria-label="Nominal" onChange={(v) => setD({ ...d, amount: v })} />
          )}
        </div>
        <div className="field">
          <span className="field-label">Berlaku di cabang</span>
          {owner && (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" id="p-all" checked={d.all} onChange={(e) => setD({ ...d, all: e.target.checked })} /> Semua cabang (termasuk cabang baru)
            </label>
          )}
          {!d.all && (
            <div className="col" style={{ gap: 6 }}>
              {branches.map((b) => (
                <label key={b.id} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    data-b={b.code}
                    checked={d.branchIds.includes(b.id)}
                    onChange={(e) => setD({ ...d, branchIds: e.target.checked ? [...d.branchIds, b.id] : d.branchIds.filter((x) => x !== b.id) })}
                  />{' '}
                  {b.name}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="form-grid">
          <label className="field">
            <span>
              Mulai <em>(opsional)</em>
            </span>
            <input className="input" type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Sampai <em>(opsional)</em>
            </span>
            <input className="input" type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} />
          </label>
        </div>
        <div className="switch-row">
          <div className="grow">
            <b>Perlu persetujuan manajer</b>
            <small>Kasir harus memasukkan PIN manajer (perangkat online)</small>
          </div>
          <Switch on={d.approval} label="Perlu persetujuan" data-sw="approval" onChange={(v) => setD({ ...d, approval: v })} />
        </div>
        <div className="switch-row">
          <div className="grow">
            <b>Aktif</b>
          </div>
          <Switch on={d.active} label="Aktif" data-sw="active" onChange={(v) => setD({ ...d, active: v })} />
        </div>
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Modal>
  );
}
