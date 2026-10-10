/* Pengaturan pusat: struk, aturan kasir & pembulatan, tipe pesanan & markup ojol, metode bayar, kurir & banner
   aplikasi pelanggan, serta data perangkat ini. Berlaku untuk semua cabang (khusus pemilik). */
import { channelPrice, rp } from '@robucca/core';
import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { S } from '../../state';
import { MoneyInput } from '../../ui/common';
import { busy, confirmBox, promptBox, toast } from '../../ui/overlay';
import { errText, oc, oget } from '../lib';
import { Body, PageHead, Switch, useLoad } from '../ui';

interface Org {
  orgName: string; tagline: string | null; instagram: string | null; roundingUnit: number; roundingMode: 'DOWN' | 'NEAREST' | 'UP'; maxCashierDiscountBp: number;
  autoLockMinutes: number; autoPrintReceipt: boolean; blockSaleWhenOutOfStock: boolean; kdsWarnMinutes: number; kdsLateMinutes: number; receiptFooter: string | null;
}
interface Channel { id: string; code: string; name: string; type: 'DINE_IN' | 'TAKEAWAY' | 'FOOD_PLATFORM'; markupBp: number; isActive: boolean }
interface PayOpt { id: string; code: string; name: string; method: string; provider: string | null; requiresReference: boolean; isActive: boolean }
interface Courier { id: string; code: string; name: string; provider: string | null; baseFee: number; perKmFee: number; minFee: number; isActive: boolean }
interface Banner { id: string; imageUrl: string; label: string | null; isActive: boolean; sortOrder: number; category: { name: string } | null }
interface Data { settings: Org; channels: Channel[]; paymentOptions: PayOpt[]; couriers: Courier[]; banners: Banner[] }

const CH_TYPE: Record<Channel['type'], string> = { FOOD_PLATFORM: 'Ojol / aplikasi', DINE_IN: 'Makan di tempat', TAKEAWAY: 'Dibawa pulang' };

export default function SettingsPage() {
  const l = useLoad(() => oget<Data>('/office/settings'), []);
  return (
    <>
      <PageHead title="Pengaturan" sub="Berlaku untuk semua cabang" />
      <div className="page" style={{ maxWidth: 980 }}>
        <Body l={l}>{(d) => <Form d={d} reload={l.reload} />}</Body>
      </div>
    </>
  );
}

function Form({ d, reload }: { d: Data; reload: () => void }) {
  const [s, setS] = useState<Org>(d.settings);
  const [chs, setChs] = useState(d.channels);
  const [pms, setPms] = useState(d.paymentOptions);
  const [crs, setCrs] = useState(d.couriers);
  useEffect(() => {
    setS(d.settings);
    setChs(d.channels);
    setPms(d.paymentOptions);
    setCrs(d.couriers);
  }, [d]);
  const set = <K extends keyof Org>(k: K, v: Org[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    if (!(s.maxCashierDiscountBp >= 0 && s.maxCashierDiscountBp <= 10000)) return toast('Batas diskon harus 0–100%', 'warn');
    if (s.kdsLateMinutes <= s.kdsWarnMinutes) return toast('Batas merah dapur harus lebih lama dari batas kuning', 'warn');
    const bz = busy('Menyimpan…');
    try {
      const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => k in d.settings && (d.settings as unknown as Record<string, unknown>)[k] !== v && !['id', 'updatedAt'].includes(k)));
      if (Object.keys(changed).length) await oc('PATCH', '/office/settings', changed);
      for (const c of chs) {
        const o = d.channels.find((x) => x.id === c.id)!;
        if (c.name !== o.name || c.markupBp !== o.markupBp || c.isActive !== o.isActive) await oc('PATCH', `/office/channels/${c.id}`, { name: c.name.trim() || o.name, markupBp: c.markupBp, isActive: c.isActive });
      }
      for (const p of pms) {
        const o = d.paymentOptions.find((x) => x.id === p.id)!;
        if (p.name !== o.name || p.isActive !== o.isActive || p.requiresReference !== o.requiresReference) {
          await oc('PATCH', `/office/payment-options/${p.id}`, { name: p.name.trim() || o.name, isActive: p.isActive, requiresReference: p.requiresReference });
        }
      }
      for (const c of crs) {
        const o = d.couriers.find((x) => x.id === c.id)!;
        if (c.baseFee !== o.baseFee || c.perKmFee !== o.perKmFee || c.minFee !== o.minFee || c.isActive !== o.isActive || c.name !== o.name) {
          await oc('PATCH', `/office/couriers/${c.id}`, { name: c.name.trim() || o.name, baseFee: c.baseFee, perKmFee: c.perKmFee, minFee: c.minFee, isActive: c.isActive });
        }
      }
      if (!chs.some((c) => c.isActive)) toast('Minimal satu tipe pesanan harus aktif', 'warn');
      else toast('Pengaturan disimpan');
      reload();
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      bz.done();
    }
  };

  const banner = async (act: 'add' | 'toggle' | 'del', b?: Banner) => {
    try {
      if (act === 'add') {
        const url = await promptBox({ title: 'Banner baru', label: 'Alamat gambar', placeholder: 'assets/img/promo.jpg atau https://…', ok: 'Tambah' });
        if (!url) return;
        await oc('POST', '/office/banners', { imageUrl: url, sortOrder: d.banners.length + 1 });
      }
      if (act === 'toggle' && b) await oc('PATCH', `/office/banners/${b.id}`, { isActive: !b.isActive });
      if (act === 'del' && b) {
        if (!(await confirmBox({ title: 'Hapus banner ini?', ok: 'Hapus', danger: true }))) return;
        await oc('DELETE', `/office/banners/${b.id}`);
      }
      reload();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  return (
    <>
      <div className="card pad">
        <h3 className="card-title">
          <Icon name="store" size="sm" /> Umum & struk
        </h3>
        <div className="form-grid">
          <label className="field">
            <span>Nama usaha (di struk)</span>
            <input className="input" data-s="orgName" value={s.orgName} onChange={(e) => set('orgName', e.target.value)} />
          </label>
          <label className="field">
            <span>Instagram</span>
            <input className="input" value={s.instagram ?? ''} placeholder="@robucca.id" onChange={(e) => set('instagram', e.target.value || null)} />
          </label>
          <label className="field">
            <span>Tagline</span>
            <input className="input" value={s.tagline ?? ''} onChange={(e) => set('tagline', e.target.value || null)} />
          </label>
          <label className="field full">
            <span>Catatan kaki struk</span>
            <input className="input" value={s.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value || null)} />
          </label>
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <h3 className="card-title">
          <Icon name="grid" size="sm" /> Aturan kasir
        </h3>
        <div className="form-grid">
          <label className="field">
            <span>Pembulatan total</span>
            <select className="select" value={s.roundingUnit} onChange={(e) => set('roundingUnit', Number(e.target.value))}>
              {[[1, 'Tanpa pembulatan'], [100, 'Ke Rp100'], [500, 'Ke Rp500'], [1000, 'Ke Rp1.000']].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Arah pembulatan</span>
            <select className="select" value={s.roundingMode} onChange={(e) => set('roundingMode', e.target.value as Org['roundingMode'])}>
              <option value="DOWN">Ke bawah (menguntungkan pelanggan)</option>
              <option value="NEAREST">Terdekat</option>
              <option value="UP">Ke atas</option>
            </select>
          </label>
          <label className="field">
            <span>Batas diskon manual kasir (%)</span>
            <input className="input" type="number" min={0} max={100} data-s="maxDisc" value={s.maxCashierDiscountBp / 100} onChange={(e) => set('maxCashierDiscountBp', Math.round(Number(e.target.value) * 100))} />
            <small>Di atas ini perlu PIN manajer (perangkat online)</small>
          </label>
          <label className="field">
            <span>Kunci layar otomatis</span>
            <select className="select" value={s.autoLockMinutes} onChange={(e) => set('autoLockMinutes', Number(e.target.value))}>
              {[[0, 'Tidak'], [2, '2 menit'], [5, '5 menit'], [10, '10 menit'], [30, '30 menit']].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tiket dapur kuning setelah (menit)</span>
            <input className="input" type="number" min={1} data-s="kdsWarn" value={s.kdsWarnMinutes} onChange={(e) => set('kdsWarnMinutes', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Tiket dapur merah setelah (menit)</span>
            <input className="input" type="number" min={1} value={s.kdsLateMinutes} onChange={(e) => set('kdsLateMinutes', Number(e.target.value))} />
          </label>
          <div className="full row wrap" style={{ gap: 22 }}>
            <div className="switch-row">
              <Switch on={s.autoPrintReceipt} label="Cetak struk otomatis" onChange={(v) => set('autoPrintReceipt', v)} />
              <div>
                <b>Cetak struk otomatis</b>
                <small>Setelah pembayaran</small>
              </div>
            </div>
            <div className="switch-row">
              <Switch on={s.blockSaleWhenOutOfStock} label="Tolak jual saat stok habis" onChange={(v) => set('blockSaleWhenOutOfStock', v)} />
              <div>
                <b>Tolak jual saat stok 0</b>
                <small>Untuk menu yang bahannya dilacak</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <h3 className="card-title">
          <Icon name="scooter" size="sm" /> Tipe pesanan & harga ojol
        </h3>
        <p className="hint" style={{ margin: '-4px 0 10px' }}>
          Markup menaikkan harga semua menu di kanal itu (dibulatkan ke atas ke Rp500), mis. untuk menutup komisi aplikasi. Contoh Rp35.000 dengan markup 20% → {rp(channelPrice(35000, 2000))}.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Tipe</th>
              <th>Jenis</th>
              <th style={{ width: 150 }}>Markup harga (%)</th>
              <th>Aktif</th>
            </tr>
          </thead>
          <tbody>
            {chs.map((c, i) => (
              <tr key={c.id} data-channel={c.code}>
                <td>
                  <input className="input sm" value={c.name} aria-label="Nama tipe" onChange={(e) => setChs(chs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </td>
                <td>{CH_TYPE[c.type]}</td>
                <td>
                  <input
                    className="input sm"
                    type="number"
                    min={0}
                    max={100}
                    data-markup={c.code}
                    value={c.markupBp / 100}
                    disabled={c.type !== 'FOOD_PLATFORM'}
                    aria-label="Markup"
                    onChange={(e) => setChs(chs.map((x, j) => (j === i ? { ...x, markupBp: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) * 100))) } : x)))}
                  />
                </td>
                <td>
                  <Switch on={c.isActive} label="Aktif" onChange={(v) => setChs(chs.map((x, j) => (j === i ? { ...x, isActive: v } : x)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <h3 className="card-title">
          <Icon name="wallet" size="sm" /> Metode pembayaran
        </h3>
        <table className="table">
          <thead>
            <tr>
              <th>Metode</th>
              <th>Jenis</th>
              <th>Minta no. referensi</th>
              <th>Aktif</th>
            </tr>
          </thead>
          <tbody>
            {pms.map((p, i) => (
              <tr key={p.id}>
                <td>
                  <input className="input sm" value={p.name} aria-label="Nama metode" onChange={(e) => setPms(pms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </td>
                <td>{p.method === 'CASH' ? 'Tunai (masuk laci)' : `Non-tunai${p.provider ? ` · ${p.provider}` : ''}`}</td>
                <td>
                  <Switch
                    on={p.requiresReference}
                    label="Minta referensi"
                    disabled={p.method === 'CASH'}
                    onChange={(v) => setPms(pms.map((x, j) => (j === i ? { ...x, requiresReference: v } : x)))}
                  />
                </td>
                <td>
                  <Switch on={p.isActive} label="Aktif" disabled={p.method === 'CASH'} onChange={(v) => setPms(pms.map((x, j) => (j === i ? { ...x, isActive: v } : x)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {crs.length ? (
        <div className="card pad" style={{ marginTop: 14 }}>
          <h3 className="card-title">
            <Icon name="scooter" size="sm" /> Kurir pesan antar (aplikasi pelanggan)
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th>Kurir</th>
                <th className="r">Tarif dasar</th>
                <th className="r">Per km</th>
                <th className="r">Minimal</th>
                <th>Aktif</th>
              </tr>
            </thead>
            <tbody>
              {crs.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <input className="input sm" value={c.name} aria-label="Nama kurir" onChange={(e) => setCrs(crs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </td>
                  {(['baseFee', 'perKmFee', 'minFee'] as const).map((k) => (
                    <td key={k} className="r">
                      <MoneyInput className="input sm" style={{ width: 110 }} value={c[k]} onChange={(v) => setCrs(crs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))} />
                    </td>
                  ))}
                  <td>
                    <Switch on={c.isActive} label="Aktif" onChange={(v) => setCrs(crs.map((x, j) => (j === i ? { ...x, isActive: v } : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn lg" data-save onClick={() => void save()}>
          <Icon name="check" size="sm" /> Simpan pengaturan
        </button>
      </div>

      <div className="card pad" style={{ marginTop: 22 }}>
        <h3 className="card-title">
          <Icon name="star" size="sm" /> Banner aplikasi pelanggan
        </h3>
        <p className="hint" style={{ margin: '-4px 0 10px' }}>
          Tampil di beranda aplikasi pelanggan. Perubahan banner langsung tersimpan.
        </p>
        {d.banners.length ? (
          <table className="table">
            <tbody>
              {d.banners.map((b) => (
                <tr key={b.id}>
                  <td style={{ width: 90 }}>
                    <span className="thumb" style={{ width: 72, height: 40, display: 'block', borderRadius: 8, overflow: 'hidden' }}>
                      <img src={b.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </span>
                  </td>
                  <td>
                    {b.label ?? b.imageUrl}
                    {b.category ? <span className="sub">ke kategori {b.category.name}</span> : null}
                  </td>
                  <td>
                    <Switch on={b.isActive} label="Aktif" onChange={() => void banner('toggle', b)} />
                  </td>
                  <td className="r">
                    <button className="btn danger ghost xs" onClick={() => void banner('del', b)}>
                      <Icon name="trash" size="xs" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Belum ada banner.</p>
        )}
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => void banner('add')}>
          <Icon name="plus" size="sm" /> Banner
        </button>
      </div>

      <div className="card pad" style={{ marginTop: 22 }}>
        <h3 className="card-title">
          <Icon name="tablet" size="sm" /> Data perangkat ini
        </h3>
        <dl className="kv" style={{ maxWidth: 520 }}>
          <dt>Server</dt>
          <dd style={{ wordBreak: 'break-all' }}>{S.be.device?.serverUrl ?? '—'}</dd>
          <dt>Perangkat</dt>
          <dd>
            {S.be.device?.name} · {S.be.device?.branchName ?? 'Kantor pusat'}
            {S.be.device?.branchId ? ` · Terminal ${S.be.device.terminalNo}` : ''}
          </dd>
        </dl>
        <p className="hint" style={{ margin: '10px 0 0' }}>
          Cadangan database dibuat di server pusat. Untuk melepas perangkat ini, cabut aksesnya dari Kantor › Perangkat di perangkat lain.
        </p>
      </div>
    </>
  );
}
