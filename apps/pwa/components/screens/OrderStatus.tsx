'use client';
/* Status pesanan langsung dari kasir cabang (SSE, cadangan: muat ulang berkala): linimasa, antrean & kode, driver,
   rincian, bayar, WhatsApp, "Pesan lagi". Port OrderView prototipe; status tidak lagi disimulasikan dengan jam. */
import { rp } from '@robucca/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { openPay } from '@/components/sheets/PaySheet';
import { api, ApiError, errText } from '@/lib/api';
import { CONTENT } from '@/lib/content';
import { orderKey, refreshActivity, tokenFor, useActivity, useBranches, useOrder } from '@/lib/data';
import { useNav } from '@/lib/nav';
import { isLive, KIND_LABEL, kindOf, kmLabel, orderMsg, payLabel, phase, pickupText, stampLabel } from '@/lib/orders';
import { addrHead } from '@/lib/places';
import { gmapsLink, haptic, telLink, waLink, waNumber } from '@/lib/platform';
import { reorder } from '@/lib/reorder';
import { mutate } from '@/lib/remote';
import { useApp, useHydrated } from '@/lib/store';
import { at } from '@/lib/time';
import type { PublicOrder } from '@/lib/types';
import { toast } from '@/lib/ui';

function Cup({ done }: { done: boolean }) {
  return (
    <svg className={`cup-ill ${done ? 'done' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
      <g className="steam">
        <path d="M47 34c-5-6 5-10 0-17" />
        <path d="M60 34c-5-6 5-10 0-17" />
        <path d="M73 34c-5-6 5-10 0-17" />
      </g>
      <path d="M28 44h62v24a26 26 0 0 1-26 26h-10a26 26 0 0 1-26-26Z" fill="#fff" stroke="#1C1B19" strokeWidth="2.5" />
      <path d="M90 52h5a10 10 0 0 1 0 20h-7" fill="none" stroke="#1C1B19" strokeWidth="2.5" />
      <path d="M20 102h80" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      {done && (
        <>
          <circle cx="86" cy="36" r="13" fill="#4A6538" />
          <path d="m80 36 4.2 4.2L92.5 31.8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      <text x="59" y="74" textAnchor="middle" fontFamily="Poppins, sans-serif" fontWeight="700" fontSize="13" fill="#1C1B19">
        {CONTENT.cupMark}
      </text>
    </svg>
  );
}

const initials = (s: string): string =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

function DriverCard({ o, step }: { o: PublicOrder; step: number }) {
  const d = o.delivery!;
  if (step < 2) {
    return (
      <div className="card driver">
        <span className="dv-av pulse">
          <Icon n="scooter" />
        </span>
        <span className="grow">
          <b>{o.stage === 'ready' ? `Menunggu driver ${d.provider}` : `Driver ${d.provider} dipesan saat pesanan siap`}</b>
          <small>{d.courierName} · dipesan kasir cabang</small>
        </span>
      </div>
    );
  }
  const phone = d.driverPhone ? waNumber({ phone: d.driverPhone }) : null;
  return (
    <div className="card driver">
      <span className="dv-av">{d.driverName ? initials(d.driverName) : <Icon n="scooter" />}</span>
      <span className="grow">
        <b>{d.driverName ?? `Driver ${d.courierName}`}</b>
        {d.vehiclePlate && <small>{d.vehiclePlate}</small>}
        <small>{d.courierName}</small>
      </span>
      {d.trackingUrl && (
        <a className="icon-btn" href={d.trackingUrl} target="_blank" rel="noopener" aria-label="Lacak driver">
          <Icon n="nav" cls="sm" />
        </a>
      )}
      {phone ? (
        <a className="icon-btn" href={waLink(phone)} target="_blank" rel="noopener" aria-label="Hubungi driver">
          <Icon n="chat" cls="sm" />
        </a>
      ) : d.driverPhone ? (
        <a className="icon-btn" href={telLink(d.driverPhone)} aria-label="Telepon driver">
          <Icon n="phone" cls="sm" />
        </a>
      ) : null}
    </div>
  );
}

export function OrderStatus() {
  const q = useSearchParams();
  const id = q.get('id');
  const wantPay = q.get('bayar') === '1';
  const nav = useNav();
  const hydrated = useHydrated();
  const s = useApp();
  const { data: o, error, reload } = useOrder(hydrated && id ? id : null);
  const { data: branches } = useBranches();
  const act = useActivity();
  const retried = useRef(false);
  const asked = useRef(false);
  const prevStep = useRef<number | null>(null);
  const prevPay = useRef<string | null>(null);

  const b = o ? (branches?.find((x) => x.code === o.branch.code) ?? null) : null;
  const tz = b?.timezone ?? 'Asia/Jakarta';
  const ph = o ? phase(o, tz) : null;
  const live = !!o && isLive(o);
  // Token untuk SSE: dari perangkat, atau dari daftar akun (tersedia setelah aktivitas dimuat).
  const token = id && hydrated ? tokenFor('orders', id) : undefined;
  void act.data;

  // Status real-time dari kasir.
  useEffect(() => {
    if (!id || !token || !live || typeof EventSource === 'undefined') return;
    const es = new EventSource(api.orderStreamUrl(id, token));
    es.addEventListener('status', (ev) => {
      try {
        mutate(orderKey(id), JSON.parse((ev as MessageEvent<string>).data) as PublicOrder);
      } catch {
        /* abaikan pesan rusak */
      }
    });
    return () => es.close();
  }, [id, token, live]);

  // Pelanggan masuk tanpa token di perangkat: muat daftar akun dulu, lalu coba sekali lagi.
  useEffect(() => {
    if (!error || o || retried.current || !s.auth) return;
    retried.current = true;
    void refreshActivity().then(() => reload());
  }, [error, o, s.auth, reload]);

  // ?bayar=1 (baru dibuat): buka lembar bayar sekali, lalu hapus dari alamat agar Back/muat ulang tidak membukanya lagi.
  useEffect(() => {
    if (!wantPay || asked.current || !o) return;
    asked.current = true;
    const url = new URL(location.href);
    url.searchParams.delete('bayar');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (o.payment.state === 'pending') setTimeout(() => openPay(o.id), 450);
  }, [wantPay, o]);

  // Kabar perubahan status saat layar terbuka.
  const stepNow = ph?.step ?? null;
  useEffect(() => {
    if (!o || stepNow == null) return;
    if (prevStep.current != null && prevStep.current !== stepNow && stepNow === 2) {
      haptic();
      const k = kindOf(o);
      toast(o.delivery ? 'Pesananmu sedang diantar driver' : k === 'preorder' ? 'Pesananmu siap disajikan' : 'Pesananmu siap diambil!', o.delivery ? 'scooter' : 'coffee');
    }
    if (prevPay.current === 'pending' && o.payment.state === 'paid') toast('Pembayaran diterima kasir');
    prevStep.current = stepNow;
    prevPay.current = o.payment.state;
  }, [o, stepNow]);

  const bar = (
    <header className="appbar">
      <button className="icon-btn" onClick={() => nav.back('/pesanan/')} aria-label="Kembali">
        <Icon n="chevron-left" />
      </button>
      <h1>Status Pesanan</h1>
      <span className="spacer" />
    </header>
  );

  if (!id || (error && !o && (!s.auth || retried.current))) {
    const gone = !id || (error && /tidak ditemukan|forbidden|403|404/i.test(error));
    return (
      <div className="screen">
        {bar}
        <div className="empty">
          <h3>{gone ? 'Pesanan tidak ditemukan' : 'Status belum bisa dimuat'}</h3>
          {!gone && <p>{error}</p>}
          {!gone && (
            <button className="btn" onClick={() => void reload()}>
              Coba lagi
            </button>
          )}
          {gone && (
            <Link className="btn" href="/pesanan/">
              Lihat pesanan
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (!o || !ph) {
    return (
      <div className="screen">
        {bar}
        <div className="pad" style={{ paddingTop: 30 }}>
          <div className="skel" style={{ height: 180 }} />
          <div className="skel" style={{ height: 70, marginTop: 14 }} />
          <div className="skel" style={{ height: 240, marginTop: 14 }} />
        </div>
      </div>
    );
  }

  const k = kindOf(o);
  const d = o.delivery;
  const pu = k === 'pickup';
  const step = ph.step;
  const canReceive = o.stage === 'ready' || o.stage === 'on_delivery';
  const wa = waNumber(b);
  const labels = d
    ? ['Pesanan diterima', 'Sedang disiapkan', 'Diantar driver', 'Tiba di tujuan']
    : ['Pesanan diterima', 'Sedang disiapkan', pu ? 'Siap diambil' : 'Disajikan di meja', 'Selesai'];
  const subs = [
    at(o.paidAt ?? o.createdAt, tz).clock,
    d ? `Barista & dapur · driver ${d.provider} dipesan kasir` : 'Barista & dapur',
    d ? d.courierName : pu ? 'Counter pick-up · tanpa antre' : 'Saat kamu tiba',
    d ? addrHead(d.addressText) : '',
  ];
  const cutlery = !!o.note?.includes('Perlu alat makan');

  const received = async (): Promise<void> => {
    try {
      mutate(orderKey(o.id), await api.received(o.id, tokenFor('orders', o.id)));
      void refreshActivity();
      toast('Selamat menikmati!', 'coffee');
    } catch (e) {
      toast(errText(e), 'info');
      if (e instanceof ApiError) void reload();
    }
  };

  const tail = (
    <>
      {wa && (
        <a className="btn ghost" href={waLink(wa, orderMsg(o, tz))} target="_blank" rel="noopener">
          <Icon n="chat" cls="sm" /> WhatsApp
        </a>
      )}
      <button className="btn soft" onClick={() => reorder(o, nav.go)} style={wa ? undefined : { gridColumn: '1/-1' }}>
        <Icon n="rotate" cls="sm" /> Pesan lagi
      </button>
    </>
  );

  return (
    <div className="screen">
      {bar}
      <div className="track-hero">
        <Cup done={step >= 2} />
        <h1 id="st-title">{ph.title}</h1>
        <p>{ph.sub}</p>
      </div>
      {step === -1 && (
        <div className="pad" style={{ marginTop: 14 }}>
          <button className="btn block" onClick={() => openPay(o.id)}>
            <Icon n="qr" cls="sm" /> Bayar sekarang · {rp(o.total)}
          </button>
        </div>
      )}
      <div className="card queue">
        <div>
          <small>No. antrean</small>
          <b>{o.queueNumber ?? '—'}</b>
        </div>
        <i />
        <div>
          <small>Kode pesanan</small>
          <b className={`code${o.number.length > 10 ? ' long' : ''}`}>{o.number}</b>
        </div>
      </div>
      {d && step >= 1 && step < 3 && <DriverCard o={o} step={step} />}
      {step >= 0 && (
        <div className="card tl">
          {labels.map((l, i) => {
            const done = i < step || step === 3;
            return (
              <div key={l} className={`tl-s ${done ? 'done' : i === step ? 'cur' : ''}`}>
                <span className="dot">{done && <Icon n="check" cls="xs" />}</span>
                <div>
                  <b>{l}</b>
                  {subs[i] && <small>{subs[i]}</small>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="card receipt">
        <div className="rc-h">
          <b>Detail pesanan</b>
          <span className={`tag ${pu || d ? 'olive' : ''}`}>{KIND_LABEL[k]}</span>
        </div>
        <div className="kv">
          <span>Waktu pesan</span>
          <span>{stampLabel(o.createdAt, tz)}</span>
        </div>
        <div className="kv">
          <span>Cabang</span>
          <span>Robucca {o.branch.name}</span>
        </div>
        {d ? (
          <>
            <div className="kv kv-col">
              <span>Alamat</span>
              <span>
                {d.addressText}
                <br />
                <a className="map-l" href={gmapsLink(d.lat, d.lng)} target="_blank" rel="noopener">
                  Lihat di Google Maps
                </a>
              </span>
            </div>
            {d.addressNote && (
              <div className="kv">
                <span>Detail</span>
                <span>{d.addressNote}</span>
              </div>
            )}
            <div className="kv">
              <span>Kurir</span>
              <span>
                {d.courierName} · ±{kmLabel(d.distanceKm)}
              </span>
            </div>
          </>
        ) : pu ? (
          <>
            <div className="kv">
              <span>Ambil</span>
              <span>{pickupText(o, tz)}</span>
            </div>
            {cutlery && (
              <div className="kv">
                <span>Alat makan</span>
                <span>Ya</span>
              </div>
            )}
          </>
        ) : (
          <div className="kv">
            <span>Reservasi</span>
            <span>{o.reservation?.code ?? '—'}</span>
          </div>
        )}
        <div className="kv">
          <span>Nama</span>
          <span>{o.customerName ?? '—'}</span>
        </div>
        <div className="kv">
          <span>Pembayaran</span>
          <span>{payLabel(o)}</span>
        </div>
        <div className="rc-sep" />
        {o.items.map((l) => (
          <div className="rc-line" key={l.id}>
            <span className="q">{l.quantity}x</span>
            <span className="n">
              {l.name}
              {l.summary && <small>{l.summary}</small>}
              {l.note && <small>“{l.note}”</small>}
            </span>
            <span>{rp(l.lineTotal)}</span>
          </div>
        ))}
        <div className="rc-sep" />
        {d && (
          <>
            <div className="kv">
              <span>Subtotal</span>
              <span>{rp(o.total - o.deliveryFee)}</span>
            </div>
            <div className="kv">
              <span>Ongkir {d.courierName}</span>
              <span>{rp(o.deliveryFee)}</span>
            </div>
          </>
        )}
        {o.discountTotal > 0 && (
          <div className="kv">
            <span>Diskon</span>
            <span>−{rp(o.discountTotal)}</span>
          </div>
        )}
        {o.serviceCharge > 0 && (
          <div className="kv">
            <span>Biaya layanan</span>
            <span>{rp(o.serviceCharge)}</span>
          </div>
        )}
        {o.taxTotal > 0 && (
          <div className="kv">
            <span>{o.taxInclusive ? `Termasuk ${o.taxLabel}` : o.taxLabel}</span>
            <span>{rp(o.taxTotal)}</span>
          </div>
        )}
        <div className="kv" style={{ fontSize: 16 }}>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Total</span>
          <span style={{ fontWeight: 700 }}>{rp(o.total)}</span>
        </div>
      </div>
      {canReceive ? (
        <div className="actions" style={{ paddingBottom: 'calc(28px + var(--safe-b))' }}>
          <button className="btn olive block" onClick={() => void received()}>
            <Icon n="check" cls="sm" /> Pesanan sudah {pu ? 'diambil' : 'diterima'}
          </button>
          <div className="actions two" style={{ margin: 0 }}>
            {tail}
          </div>
        </div>
      ) : (
        <div className="actions two" style={{ paddingBottom: 'calc(28px + var(--safe-b))' }}>
          {tail}
        </div>
      )}
    </div>
  );
}
