/* Karyawan: peran, cabang, PIN (dan email/password untuk dasbor web). Manajer hanya mengelola kasir & dapur di cabangnya. */
import { dateTime } from '@robucca/core';
import { useState } from 'react';
import { roleName } from '../../data/master';
import { Icon } from '../../lib/icons';
import { S } from '../../state';
import { Avatar } from '../../ui/common';
import { Drawer, openLayer, toast, useLayerClose } from '../../ui/overlay';
import { activeBranches, errText, me, ms, oc, oget } from '../lib';
import { Body, PageHead, Switch, useLoad } from '../ui';

interface StaffRow {
  id: string; name: string; email: string | null; isActive: boolean; lastLoginAt: string | null; role: { code: string; name: string };
  hasPin: boolean; hasPassword: boolean; branches: { id: string; code: string; name: string }[]; editable: boolean;
}
interface Role { code: string; name: string; permissions: string[]; assignable: boolean }

export default function StaffPage() {
  const [inactive, setInactive] = useState(false);
  const l = useLoad(() => Promise.all([oget<StaffRow[]>(`/office/staff${inactive ? '?includeInactive=true' : ''}`), oget<Role[]>('/office/roles')]), [inactive]);
  return (
    <>
      <PageHead
        title="Karyawan"
        sub="PIN dipakai untuk masuk & menyetujui void/diskon · setiap aksi tercatat atas nama karyawan"
        actions={
          <>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Tampilkan nonaktif
            </label>
            <button className="btn sm" data-new disabled={!l.data} onClick={() => void editor(null, l.data![1]).then((ok) => ok && l.reload())}>
              <Icon name="user-plus" size="sm" /> Karyawan baru
            </button>
          </>
        }
      />
      <div className="page">
        <Body l={l}>
          {([list, roles]) => (
            <>
              <div className="table-card" id="k-table">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th>Peran</th>
                        <th>Cabang</th>
                        <th>Masuk dengan</th>
                        <th>Terakhir masuk</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => (
                        <tr key={s.id} data-staff-row={s.name}>
                          <td>
                            <div className="cell-row">
                              <Avatar staff={s} size="sm" />
                              <b>{s.name}</b>
                            </div>
                          </td>
                          <td>{s.role.name || roleName(s.role.code)}</td>
                          <td>{s.role.code === 'SUPER_ADMIN' ? 'Semua cabang' : s.branches.map((b) => b.name).join(', ') || '—'}</td>
                          <td>
                            {[s.hasPin ? 'PIN' : null, s.hasPassword ? 'email' : null].filter(Boolean).join(' + ') || <span className="muted">—</span>}
                          </td>
                          <td className="n">{s.lastLoginAt ? dateTime(ms(s.lastLoginAt)) : <span className="muted">—</span>}</td>
                          <td>{s.isActive ? <span className="tag green">Aktif</span> : <span className="tag">Nonaktif</span>}</td>
                          <td className="r">
                            {s.editable ? (
                              <button className="btn ghost xs" data-edit={s.id} onClick={() => void editor(s, roles).then((ok) => ok && l.reload())}>
                                <Icon name="edit" size="xs" /> Ubah
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="note blue" style={{ marginTop: 14 }}>
                <Icon name="info" size="sm" />
                <span>
                  <b>Pemilik</b>: semua cabang & pengaturan. <b>Manajer</b>: kantor cabangnya, menyetujui void/refund/diskon, kelola kasir & dapur. <b>Kasir</b>: penjualan & shift.{' '}
                  <b>Dapur/Bar</b>: layar dapur. Manajer & pemilik hanya bisa masuk dan menyetujui saat perangkat online — PIN mereka tidak disimpan di perangkat kasir.
                </span>
              </div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

function editor(s: StaffRow | null, roles: Role[]): Promise<boolean> {
  return openLayer<boolean>(() => <StaffBody s0={s} roles={roles} />).then((v) => !!v);
}

function StaffBody({ s0, roles }: { s0: StaffRow | null; roles: Role[] }) {
  const close = useLayerClose();
  const owner = me().allBranches;
  const assignable = roles.filter((r) => r.assignable);
  const mine = activeBranches();
  const [s, setS] = useState({
    name: s0?.name ?? '', role: s0?.role.code ?? (assignable.some((r) => r.code === 'CASHIER') ? 'CASHIER' : (assignable[0]?.code ?? 'CASHIER')),
    branchIds: s0?.branches.map((b) => b.id) ?? (mine.length === 1 ? [mine[0]!.id] : []), isActive: s0?.isActive ?? true, email: s0?.email ?? '', pin: '', password: '',
  });
  const [err, setErr] = useState('');
  const save = async () => {
    const name = s.name.trim();
    if (!name) return setErr('Isi nama.');
    if (s.role !== 'SUPER_ADMIN' && !s.branchIds.length) return setErr('Pilih minimal satu cabang.');
    if ((!s0 || s.pin) && !/^\d{4,6}$/.test(s.pin)) return setErr('PIN harus 4–6 angka.');
    if (s0 && s0.id === S.user?.id && !s.isActive) return setErr('Tidak bisa menonaktifkan akun sendiri.');
    if (s.password && s.password.length < 8) return setErr('Password minimal 8 karakter.');
    const email = s.email.trim() || null;
    try {
      if (!s0) {
        await oc('POST', '/office/staff', {
          name, role: s.role, branchIds: s.role === 'SUPER_ADMIN' ? [] : s.branchIds, pin: s.pin, isActive: s.isActive, ...(email ? { email } : {}), ...(s.password ? { password: s.password } : {}),
        });
      } else {
        await oc('PATCH', `/office/staff/${s0.id}`, { name, role: s.role, branchIds: s.role === 'SUPER_ADMIN' ? [] : s.branchIds, isActive: s.isActive, ...(owner ? { email } : {}) });
        if (s.pin) await oc('PUT', `/office/staff/${s0.id}/pin`, { pin: s.pin });
        if (s.password) await oc('PUT', `/office/staff/${s0.id}/password`, { password: s.password });
      }
      toast('Karyawan disimpan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Drawer
      title={s0 ? `Ubah ${s0.name}` : 'Karyawan baru'}
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-save onClick={() => void save()}>
            Simpan
          </button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span>Nama</span>
          <input className="input" id="s-name" value={s.name} autoComplete="off" autoFocus onChange={(e) => setS({ ...s, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Peran</span>
          <select className="select" id="s-role" value={s.role} onChange={(e) => setS({ ...s, role: e.target.value })}>
            {assignable.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {s.role === 'SUPER_ADMIN' ? (
          <p className="hint">Pemilik otomatis punya akses ke semua cabang.</p>
        ) : (
          <div className="field">
            <span className="field-label">Cabang</span>
            {mine.map((b) => (
              <label key={b.id} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  data-b={b.code}
                  checked={s.branchIds.includes(b.id)}
                  onChange={(e) => setS({ ...s, branchIds: e.target.checked ? [...s.branchIds, b.id] : s.branchIds.filter((x) => x !== b.id) })}
                />{' '}
                {b.name}
              </label>
            ))}
            <small>Manajer area bisa diberi beberapa cabang.</small>
          </div>
        )}
        <label className="field">
          <span>
            {s0 ? (
              <>
                PIN baru <em>(kosongkan bila tidak diganti)</em>
              </>
            ) : (
              'PIN (4–6 angka)'
            )}
          </span>
          <input
            className="input"
            id="s-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            placeholder="••••"
            value={s.pin}
            onChange={(e) => setS({ ...s, pin: e.target.value.replace(/\D/g, '') })}
          />
          <small>PIN harus unik di cabangnya.</small>
        </label>
        {owner && (
          <>
            <label className="field">
              <span>
                Email <em>(opsional, untuk masuk dasbor web)</em>
              </span>
              <input className="input" type="email" value={s.email} autoComplete="off" onChange={(e) => setS({ ...s, email: e.target.value })} />
            </label>
            <label className="field">
              <span>
                {s0?.hasPassword ? 'Password baru' : 'Password'} <em>(opsional, min. 8 karakter)</em>
              </span>
              <input className="input" type="password" value={s.password} autoComplete="new-password" onChange={(e) => setS({ ...s, password: e.target.value })} />
            </label>
          </>
        )}
        <div className="switch-row">
          <Switch on={s.isActive} label="Aktif" onChange={(v) => setS({ ...s, isActive: v })} />
          <div>
            <b>Aktif</b>
            <small>Karyawan nonaktif tidak bisa masuk</small>
          </div>
        </div>
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Drawer>
  );
}
