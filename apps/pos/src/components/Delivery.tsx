/* Pesanan Delivery dari aplikasi pelanggan di kasir: penerima & alamat, kurir, driver, dan langkah pengantaran
   (driver berangkat → tiba). Kasir memesan kurir sendiri lewat aplikasi GoSend/GrabExpress; data driver yang dicatat
   di sini langsung tampil di aplikasi pelanggan (pengganti driver simulasi di prototipe lama). */
import { clock, deliveryEtaMinutes, rp } from '@robucca/core';
import { useState, type ChangeEvent } from 'react';
import type { DispatchInput } from '../data/backend';
import type { Order } from '../data/types';
import { Icon } from '../lib/icons';
import { S, branch } from '../state';
import { Modal, openLayer, toast, type Close } from '../ui/overlay';

export type DeliveryStage = 'prep' | 'ready' | 'out' | 'done';

/** Tahap pengantaran pesanan delivery yang sudah lunas; null untuk pesanan lain (atau yang batal/di-refund). */
export function deliveryStage(o: Order): DeliveryStage | null {
  if (!o.delivery || o.status !== 'PAID' || o.fulfillment === 'CANCELLED') return null;
  if (o.fulfillment === 'COMPLETED' || o.delivery.status === 'DELIVERED') return 'done';
  if (o.fulfillment === 'OUT_FOR_DELIVERY') return 'out';
  if (o.fulfillment === 'READY') return 'ready';
  return 'prep';
}

/** Perlu dicarikan driver (lunas, belum berangkat). */
export const needsDriver = (o: Order): boolean => {
  const s = deliveryStage(o);
  return s === 'prep' || s === 'ready';
};

const STAGE: Record<DeliveryStage, [string, string]> = {
  prep: ['Disiapkan', ''],
  ready: ['Menunggu driver', 'amber'],
  out: ['Sedang diantar', 'blue'],
  done: ['Tiba', 'green'],
};

export function DeliveryTag({ o }: { o: Order }) {
  const s = deliveryStage(o);
  if (!s) return null;
  const [label, cls] = STAGE[s];
  return (
    <span className={`tag ${cls}`}>
      <Icon name="scooter" size="xs" /> {label}
    </span>
  );
}

/** 62812… → 0812… */
const local = (p: string): string => (p.startsWith('62') ? `0${p.slice(2)}` : p);
const wa = (p: string): string => `https://wa.me/${p.replace(/\D/g, '').replace(/^0/, '62')}`;
const km = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

export function DeliveryInfo({ o }: { o: Order }) {
  const d = o.delivery;
  if (!d) return null;
  const tz = branch().timezone;
  const map = `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;
  const times = [
    d.pickedUpAt ? `Berangkat ${clock(d.pickedUpAt, tz)}` : '',
    d.deliveredAt ? `Tiba ${clock(d.deliveredAt, tz)}` : o.fulfillment === 'OUT_FOR_DELIVERY' && d.estimatedAt ? `Perkiraan tiba ${clock(d.estimatedAt, tz)}` : '',
  ].filter(Boolean);
  const copy = (): void => {
    const text = [`${d.recipientName} · ${local(d.recipientPhone)}`, d.addressText, d.addressNote, map].filter(Boolean).join('\n');
    const fail = (): void => toast('Tidak bisa menyalin di perangkat ini', 'warn');
    if (!navigator.clipboard) return fail(); // hanya tersedia di https / localhost
    navigator.clipboard.writeText(text).then(() => toast('Alamat disalin'), fail);
  };
  return (
    <div className="dlv" id="od-delivery">
      <dl className="kv">
        <dt>Penerima</dt>
        <dd>
          {d.recipientName} ·{' '}
          <a href={wa(d.recipientPhone)} target="_blank" rel="noopener">
            {local(d.recipientPhone)}
          </a>
        </dd>
        <dt>Alamat</dt>
        <dd>
          {d.addressText}
          {d.addressNote && <div className="muted">{d.addressNote}</div>}
          <div className="dlv-links">
            <a href={map} target="_blank" rel="noopener">
              Buka di Google Maps
            </a>
            <button className="link" onClick={copy}>
              Salin alamat
            </button>
          </div>
        </dd>
        <dt>Kurir</dt>
        <dd>
          {d.courierName} · ±{km(d.distanceKm)} km · ongkir {rp(d.fee)}
        </dd>
        {d.driverName && (
          <>
            <dt>Driver</dt>
            <dd data-driver>
              {d.driverName}
              {d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}
              {d.driverPhone && (
                <>
                  {' · '}
                  <a href={wa(d.driverPhone)} target="_blank" rel="noopener">
                    {local(d.driverPhone)}
                  </a>
                </>
              )}
              {d.trackingUrl && (
                <div className="dlv-links">
                  <a href={d.trackingUrl} target="_blank" rel="noopener noreferrer">
                    Tautan lacak
                  </a>
                </div>
              )}
            </dd>
          </>
        )}
        {times.length > 0 && (
          <>
            <dt>Waktu</dt>
            <dd>{times.join(' · ')}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function DispatchBody({ o, close }: { o: Order; close: Close<Order> }) {
  const d = o.delivery!;
  const again = o.fulfillment === 'OUT_FOR_DELIVERY';
  const left = again && d.estimatedAt ? Math.ceil((d.estimatedAt - Date.now()) / 60e3) : 0;
  const [f, setF] = useState({
    driverName: d.driverName,
    driverPhone: d.driverPhone ? local(d.driverPhone) : '',
    vehiclePlate: d.vehiclePlate,
    trackingUrl: d.trackingUrl,
    eta: left > 0 ? String(left) : '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (): Promise<void> => {
    const name = f.driverName.trim();
    const url = f.trackingUrl.trim();
    const eta = f.eta.trim() ? Number(f.eta.trim()) : null;
    if (name.length < 2) return setErr('Isi nama driver');
    if (url && !/^https:\/\/\S+$/.test(url)) return setErr('Tautan lacak harus diawali https://');
    if (eta != null && !(Number.isInteger(eta) && eta >= 1 && eta <= 240)) return setErr('Perkiraan tiba 1–240 menit');
    const input: DispatchInput = { driverName: name };
    if (f.driverPhone.trim()) input.driverPhone = f.driverPhone.trim();
    if (f.vehiclePlate.trim()) input.vehiclePlate = f.vehiclePlate.trim();
    if (url) input.trackingUrl = url;
    if (eta != null) input.etaMinutes = eta;
    setErr('');
    setBusy(true);
    try {
      close(await S.be.dispatch(o, input));
    } catch (e) {
      setErr((e as Error).message || 'Gagal menyimpan');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={again ? 'Ubah data driver' : 'Driver berangkat'}
      sub={`${o.number} · ${d.recipientName} · ${d.courierName}`}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(undefined)}>
            Batal
          </button>
          <button className="btn" data-ok disabled={busy} onClick={() => void submit()}>
            {busy ? 'Menyimpan…' : again ? 'Simpan' : 'Driver berangkat'}
          </button>
        </>
      }
    >
      {deliveryStage(o) === 'prep' && (
        <div className="note" style={{ marginBottom: 12 }}>
          <Icon name="info" size="sm" />
          <div>Dapur belum menandai pesanan ini selesai.</div>
        </div>
      )}
      <div className="form-grid">
        <label className="field full">
          <span>Nama driver</span>
          <input className="input" id="dp-name" autoFocus autoComplete="off" maxLength={60} value={f.driverName} onChange={set('driverName')} />
        </label>
        <label className="field">
          <span>
            No. HP <em>(opsional)</em>
          </span>
          <input className="input" id="dp-phone" type="tel" placeholder="08xxxxxxxxxx" autoComplete="off" maxLength={18} value={f.driverPhone} onChange={set('driverPhone')} />
        </label>
        <label className="field">
          <span>
            Plat nomor <em>(opsional)</em>
          </span>
          <input className="input" id="dp-plate" placeholder="N 1234 AB" autoComplete="off" maxLength={15} value={f.vehiclePlate} onChange={set('vehiclePlate')} />
        </label>
        <label className="field full">
          <span>
            Tautan lacak <em>(opsional)</em>
          </span>
          <input className="input" id="dp-url" type="url" placeholder="https://…" autoComplete="off" maxLength={300} value={f.trackingUrl} onChange={set('trackingUrl')} />
        </label>
        <label className="field">
          <span>
            Perkiraan tiba <em>(menit)</em>
          </span>
          <input
            className="input"
            id="dp-eta"
            inputMode="numeric"
            placeholder={again ? 'tetap' : `±${deliveryEtaMinutes(d.distanceKm, 0)}`}
            autoComplete="off"
            maxLength={3}
            value={f.eta}
            onChange={set('eta')}
          />
        </label>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Salin dari aplikasi {d.courierName}. Nama, plat, nomor, dan tautan lacak langsung tampil di aplikasi pelanggan.
      </p>
      {err && (
        <p className="err-text" style={{ marginTop: 8 }}>
          {err}
        </p>
      )}
    </Modal>
  );
}

/** Formulir driver; hasilnya pesanan yang sudah diperbarui (null bila batal). */
export function dispatchDialog(o: Order): Promise<Order | null> {
  return openLayer<Order>((close) => <DispatchBody o={o} close={close} />).then((v) => v ?? null);
}
