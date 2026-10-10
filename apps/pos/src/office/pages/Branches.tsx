/* Cabang: identitas, zona waktu, jam buka, pajak & biaya layanan, struk, layanan pelanggan (PWA). Khusus pemilik. */
import { bpLabel, calcOrder, rp, TIMEZONES, tzLabel, validBranchCode } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { settings } from '../../state';
import { Drawer, openLayer, toast, useLayerClose } from '../../ui/overlay';
import { errText, loadMe, oc, oget } from '../lib';
import { Body, PageHead, Switch, useLoad } from '../ui';

interface Branch {
  id: string; code: string; name: string; address: string | null; phone: string | null; timezone: string; dayStartMinute: number; openTime: string | null; closeTime: string | null;
  taxLabel: string; taxRateBp: number; taxInclusive: boolean; serviceRateBp: number; taxOnService: boolean; receiptPaperMm: number; receiptFooter: string | null;
  acceptsPwa: boolean; acceptsDelivery: boolean; acceptsReservations: boolean; isActive: boolean; orderCount: number; deviceCount: number; staffCount: number; codeLocked: boolean;
}

export default function BranchesPage() {
  const l = useLoad(() => oget<Branch[]>('/office/branches'), []);
  return (
    <>
      <PageHead
        title="Cabang"
        sub={l.data ? `${l.data.filter((b) => b.isActive).length} cabang aktif · menu, promo, & laporan berlaku lintas cabang` : ''}
        actions={
          <button className="btn sm" data-new onClick={() => void editor(null).then((ok) => ok && l.reload())}>
            <Icon name="plus" size="sm" /> Cabang baru
          </button>
        }
      />
      <div className="page">
        <Body l={l}>
          {(list) => (
            <>
              <div className="table-card" id="b-table">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Cabang</th>
                        <th>Zona</th>
                        <th>Pajak</th>
                        <th>Biaya layanan</th>
                        <th>Jam buka</th>
                        <th className="r">Perangkat / staf</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b) => (
                        <tr key={b.id} data-branch-row={b.code}>
                          <td>
                            <span className="tag dark">{b.code}</span>
                          </td>
                          <td>
                            <b>{b.name}</b>
                            <span className="sub">{b.address ?? ''}</span>
                          </td>
                          <td>{tzLabel(b.timezone)}</td>
                          <td>
                            {b.taxLabel} {bpLabel(b.taxRateBp)}
                            <span className="sub">{b.taxInclusive ? 'termasuk harga' : 'ditambahkan'}</span>
                          </td>
                          <td>{b.serviceRateBp ? bpLabel(b.serviceRateBp) : '—'}</td>
                          <td>
                            {b.openTime ?? ''}–{b.closeTime ?? ''}
                          </td>
                          <td className="r">
                            {b.deviceCount} / {b.staffCount}
                          </td>
                          <td>{b.isActive ? <span className="tag green">Aktif</span> : <span className="tag">Nonaktif</span>}</td>
                          <td className="r">
                            <button className="btn ghost xs" data-edit={b.code} onClick={() => void editor(b).then((ok) => ok && l.reload())}>
                              <Icon name="edit" size="xs" /> Ubah
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                Setiap struk memakai kode cabang + nomor terminal, mis. IJN1-261006-0042, sehingga nomor tidak pernah bentrok antarcabang maupun antarperangkat — bahkan saat offline.
                Kode cabang terkunci setelah ada transaksi.
              </p>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

function editor(b: Branch | null): Promise<boolean> {
  return openLayer<boolean>(() => <BranchBody b0={b} />).then((v) => !!v);
}

function BranchBody({ b0 }: { b0: Branch | null }) {
  const close = useLayerClose();
  const [b, setB] = useState({
    code: b0?.code ?? '', name: b0?.name ?? '', address: b0?.address ?? '', phone: b0?.phone ?? '', timezone: b0?.timezone ?? 'Asia/Jakarta', dayStartMinute: b0?.dayStartMinute ?? 0,
    openTime: b0?.openTime ?? '08:00', closeTime: b0?.closeTime ?? '21:00', taxLabel: b0?.taxLabel ?? 'PB1', taxPct: (b0?.taxRateBp ?? 1000) / 100, taxInclusive: b0?.taxInclusive ?? true,
    servicePct: (b0?.serviceRateBp ?? 0) / 100, taxOnService: b0?.taxOnService ?? true, receiptPaperMm: b0?.receiptPaperMm ?? 80, receiptFooter: b0?.receiptFooter ?? '',
    acceptsPwa: b0?.acceptsPwa ?? true, acceptsDelivery: b0?.acceptsDelivery ?? false, acceptsReservations: b0?.acceptsReservations ?? false, isActive: b0?.isActive ?? true,
  });
  const [err, setErr] = useState('');
  const s = settings();
  const ex = (() => {
    const { totals: t } = calcOrder(
      { lines: [{ id: 'x', unitPrice: 35000, quantity: 1 }] },
      { taxRateBp: Math.round(b.taxPct * 100), taxInclusive: b.taxInclusive, serviceRateBp: Math.round(b.servicePct * 100), taxOnService: b.taxOnService, roundingUnit: s?.roundingUnit ?? 100, roundingMode: s?.roundingMode ?? 'DOWN' },
    );
    return `Contoh menu Rp35.000 → pelanggan bayar ${rp(t.total)} (pajak ${rp(t.tax)}${t.service ? `, layanan ${rp(t.service)}` : ''}${t.rounding ? `, pembulatan ${rp(t.rounding)}` : ''}).`;
  })();
  const save = async () => {
    const code = b.code.trim().toUpperCase();
    if (!b0 && !validBranchCode(code)) return setErr('Kode cabang 2–4 karakter, diawali huruf (mis. IJN, CB2).');
    if (!b.name.trim()) return setErr('Isi nama cabang.');
    if (!(b.taxPct >= 0 && b.taxPct <= 100 && b.servicePct >= 0 && b.servicePct <= 100)) return setErr('Tarif pajak/layanan harus 0–100%.');
    const body = {
      ...(b0 && b0.code === code ? {} : { code }), name: b.name.trim(), address: b.address.trim() || null, phone: b.phone.trim() || null, timezone: b.timezone, dayStartMinute: b.dayStartMinute,
      openTime: b.openTime || null, closeTime: b.closeTime || null, taxLabel: b.taxLabel.trim() || 'PB1', taxRateBp: Math.round(b.taxPct * 100), taxInclusive: b.taxInclusive,
      serviceRateBp: Math.round(b.servicePct * 100), taxOnService: b.taxOnService, receiptPaperMm: b.receiptPaperMm, receiptFooter: b.receiptFooter.trim() || null,
      acceptsPwa: b.acceptsPwa, acceptsDelivery: b.acceptsDelivery, acceptsReservations: b.acceptsReservations, isActive: b.isActive,
    };
    try {
      await oc(b0 ? 'PATCH' : 'POST', b0 ? `/office/branches/${b0.id}` : '/office/branches', body);
      await loadMe(true);
      toast('Cabang disimpan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const sw = (k: 'taxInclusive' | 'taxOnService' | 'acceptsPwa' | 'acceptsDelivery' | 'acceptsReservations' | 'isActive', label: string, sub?: string) => (
    <div className="switch-row" style={{ padding: 0 }}>
      <Switch on={b[k]} label={label} data-sw={k} onChange={(v) => setB({ ...b, [k]: v })} />
      <div>
        <b>{label}</b>
        {sub ? <small>{sub}</small> : null}
      </div>
    </div>
  );
  return (
    <Drawer
      title={b0 ? `Ubah ${b0.name}` : 'Cabang baru'}
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-save onClick={() => void save()}>
            Simpan cabang
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>
            Kode <em>(2–4 huruf, untuk nomor struk)</em>
          </span>
          <input
            className="input"
            data-k="code"
            value={b.code}
            maxLength={4}
            placeholder="IJN"
            style={{ textTransform: 'uppercase' }}
            readOnly={!!b0?.codeLocked}
            onChange={(e) => setB({ ...b, code: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="field">
          <span>Nama cabang</span>
          <input className="input" data-k="name" value={b.name} placeholder="Ijen Nirwana" onChange={(e) => setB({ ...b, name: e.target.value })} />
        </label>
        <label className="field full">
          <span>Alamat (tampil di struk)</span>
          <input className="input" value={b.address} onChange={(e) => setB({ ...b, address: e.target.value })} />
        </label>
        <label className="field">
          <span>Telepon</span>
          <input className="input" value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} />
        </label>
        <label className="field">
          <span>Zona waktu</span>
          <select className="select" value={b.timezone} onChange={(e) => setB({ ...b, timezone: e.target.value })}>
            {TIMEZONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.id})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Jam buka</span>
          <input className="input" type="time" value={b.openTime} onChange={(e) => setB({ ...b, openTime: e.target.value })} />
        </label>
        <label className="field">
          <span>Jam tutup</span>
          <input className="input" type="time" value={b.closeTime} onChange={(e) => setB({ ...b, closeTime: e.target.value })} />
        </label>
        <label className="field">
          <span>Pergantian hari bisnis</span>
          <select className="select" value={b.dayStartMinute} onChange={(e) => setB({ ...b, dayStartMinute: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h * 60}>
                {String(h).padStart(2, '0')}.00{h ? '' : ' (tengah malam)'}
              </option>
            ))}
          </select>
          <small>Untuk cabang yang buka lewat tengah malam</small>
        </label>
        <label className="field">
          <span>Lebar kertas struk</span>
          <select className="select" value={b.receiptPaperMm} onChange={(e) => setB({ ...b, receiptPaperMm: Number(e.target.value) })}>
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </select>
        </label>
      </div>
      <div className="section-title">
        <h3>Pajak & biaya layanan</h3>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Nama pajak</span>
          <input className="input" value={b.taxLabel} placeholder="PB1 / PBJT" onChange={(e) => setB({ ...b, taxLabel: e.target.value })} />
        </label>
        <label className="field">
          <span>Tarif pajak (%)</span>
          <input className="input" data-k="taxPct" type="number" min={0} max={100} step={0.5} value={b.taxPct} onChange={(e) => setB({ ...b, taxPct: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Biaya layanan (%)</span>
          <input className="input" data-k="servicePct" type="number" min={0} max={100} step={0.5} value={b.servicePct} onChange={(e) => setB({ ...b, servicePct: Number(e.target.value) })} />
        </label>
        <div className="field">
          <span>&nbsp;</span>
          {sw('taxInclusive', 'Harga menu sudah termasuk pajak')}
        </div>
        <div className="field full">{sw('taxOnService', 'Biaya layanan ikut dikenai pajak')}</div>
        <div className="note full" id="be-ex">
          <Icon name="info" size="sm" />
          <span>{ex}</span>
        </div>
        <p className="hint full">Tarif & aturan pajak restoran (PBJT/PB1) ditetapkan pemerintah daerah. Pastikan tarif tiap cabang sesuai perda setempat.</p>
      </div>
      <div className="section-title">
        <h3>Struk & layanan</h3>
      </div>
      <label className="field">
        <span>
          Catatan kaki struk <em>(kosong = pakai pengaturan pusat)</em>
        </span>
        <input className="input" value={b.receiptFooter} placeholder={s?.receiptFooter ?? ''} onChange={(e) => setB({ ...b, receiptFooter: e.target.value })} />
      </label>
      <div className="col" style={{ marginTop: 10, gap: 10 }}>
        {sw('acceptsPwa', 'Terima pesanan online (aplikasi pelanggan)')}
        {sw('acceptsDelivery', 'Terima pesan antar')}
        {sw('acceptsReservations', 'Terima reservasi meja')}
        {sw('isActive', 'Cabang aktif', 'Cabang nonaktif tidak bisa dipakai berjualan')}
      </div>
      {err ? <p className="err-text">{err}</p> : null}
    </Drawer>
  );
}
