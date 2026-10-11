'use client';
/* Aktivitas: pesanan (sedang berjalan & riwayat) dan reservasi (akan datang & riwayat) milik perangkat ini
   atau akun yang masuk. Port Pesanan prototipe; status langsung dari server. */
import { rp } from '@robucca/core';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MouseEvent } from 'react';
import { Icon } from '@/components/Icon';
import { openLogin } from '@/components/sheets/AccountSheets';
import { useActivity, useBranches, useConfig } from '@/lib/data';
import { useNav } from '@/lib/nav';
import { isLive, KIND_ICON, KIND_LABEL, kindOf, phase, pickupText, rsvPhase, rsvShort, rsvTag, stampLabel } from '@/lib/orders';
import { reorder } from '@/lib/reorder';
import { useApp, useHydrated } from '@/lib/store';
import type { Branch, PublicOrder, Reservation } from '@/lib/types';

function OrderCard({ o, branches, mine }: { o: PublicOrder; branches: Branch[] | undefined; mine: string | null }) {
  const nav = useNav();
  const tz = branches?.find((b) => b.code === o.branch.code)?.timezone;
  const ph = phase(o, tz);
  const k = kindOf(o);
  const tag =
    ph.step === 3 ? (
      <span className="tag">Selesai</span>
    ) : ph.step === -2 ? (
      <span className="tag red">Dibatalkan</span>
    ) : ph.step === -1 ? (
      <span className="tag warn">Menunggu bayar</span>
    ) : (
      <span className="tag olive">
        <i className="dot" />
        {ph.title}
      </span>
    );
  const where = o.delivery ? o.delivery.courierName : k === 'pickup' ? pickupText(o, tz) : (o.reservation?.code ?? '');
  const again = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    reorder(o, nav.go);
  };
  return (
    <Link className="card oc" href={`/pesanan/status/?id=${o.id}`}>
      <div className="oc-h">
        <span className="ic">
          <Icon n={KIND_ICON[k]} cls="sm" />
        </span>
        <span className="grow">
          <b>
            {KIND_LABEL[k]} · {where}
          </b>
          <small>
            {o.number}
            {o.branch.code !== mine ? ` · ${o.branch.name}` : ''} · {stampLabel(o.createdAt, tz)}
          </small>
        </span>
        {tag}
      </div>
      <div className="oc-items">{o.items.map((l) => `${l.quantity}x ${l.name}`).join(', ')}</div>
      <div className="oc-f">
        <span>{rp(o.total)}</span>
        {isLive(o) ? (
          <span className="faint" style={{ fontWeight: 500, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            Lacak <Icon n="chevron-right" cls="xs" />
          </span>
        ) : (
          <span className="btn sm soft" role="button" onClick={again}>
            <Icon n="rotate" cls="xs" /> Pesan lagi
          </span>
        )}
      </div>
    </Link>
  );
}

function RsvCard({ r, mine }: { r: Reservation; mine: string | null }) {
  const tag = rsvTag(r);
  return (
    <Link className="card oc" href={`/reservasi/tiket/?id=${r.id}`}>
      <div className="oc-h">
        <span className="ic">
          <Icon n="calendar" cls="sm" />
        </span>
        <span className="grow">
          <b>{rsvShort(r)}</b>
          <small>
            {r.code} · {r.guests} orang · {r.area ?? 'Bebas'}
            {r.branch.code !== mine ? ` · ${r.branch.name}` : ''}
          </small>
        </span>
        <span className={`tag ${tag.cls}`}>{tag.text}</span>
      </div>
    </Link>
  );
}

export function Pesanan() {
  const q = useSearchParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const s = useApp();
  const { data, error, reload } = useActivity();
  const { data: branches } = useBranches();
  const { data: cfg } = useConfig();
  const tab = q.get('tab') === 'rsv' ? 'rsv' : 'orders';
  const setTab = (t: 'orders' | 'rsv'): void => router.replace(t === 'rsv' ? '/pesanan/?tab=rsv' : '/pesanan/', { scroll: false });

  const seg = (
    <div className="seg" data-v={tab} role="tablist">
      <button role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'on' : undefined} onClick={() => setTab('orders')}>
        <Icon n="receipt" cls="sm" /> Pesanan
      </button>
      <button role="tab" aria-selected={tab === 'rsv'} className={tab === 'rsv' ? 'on' : undefined} onClick={() => setTab('rsv')}>
        <Icon n="calendar" cls="sm" /> Reservasi
      </button>
    </div>
  );

  let body;
  if (!hydrated || (!data && !error)) {
    body = [0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 112, marginTop: 12 }} />);
  } else if (!data) {
    body = (
      <div className="empty">
        <h3>Aktivitas belum bisa dimuat</h3>
        <p>{error}</p>
        <button className="btn" onClick={() => void reload()}>
          Coba lagi
        </button>
      </div>
    );
  } else if (tab === 'orders') {
    const live = data.orders.filter(isLive);
    const done = data.orders.filter((o) => !isLive(o));
    body = data.orders.length ? (
      <>
        {live.length > 0 && <div className="list-sub">Sedang berjalan</div>}
        {live.map((o) => (
          <OrderCard key={o.id} o={o} branches={branches} mine={s.branch} />
        ))}
        {done.length > 0 && <div className="list-sub">Riwayat</div>}
        {done.slice(0, 30).map((o) => (
          <OrderCard key={o.id} o={o} branches={branches} mine={s.branch} />
        ))}
      </>
    ) : (
      <div className="empty">
        <div className="em-ico">
          <Icon n="receipt" cls="lg" />
        </div>
        <h3>Belum ada pesanan</h3>
        <p>Pesan pick up atau delivery langsung dari ponselmu.</p>
        <Link className="btn" href="/menu/">
          Mulai Pesan
        </Link>
      </div>
    );
  } else {
    const up = data.rsvs.filter((r) => rsvPhase(r) === 'upcoming').sort((a, b) => Date.parse(a.reservedFor) - Date.parse(b.reservedFor));
    const old = data.rsvs.filter((r) => rsvPhase(r) !== 'upcoming');
    body = data.rsvs.length ? (
      <>
        {up.length > 0 && <div className="list-sub">Akan datang</div>}
        {up.map((r) => (
          <RsvCard key={r.id} r={r} mine={s.branch} />
        ))}
        {old.length > 0 && <div className="list-sub">Riwayat</div>}
        {old.slice(0, 30).map((r) => (
          <RsvCard key={r.id} r={r} mine={s.branch} />
        ))}
        <Link className="btn block soft" style={{ marginTop: 16 }} href="/reservasi/">
          <Icon n="plus" cls="sm" /> Reservasi baru
        </Link>
      </>
    ) : (
      <div className="empty">
        <div className="em-ico">
          <Icon n="calendar" cls="lg" />
        </div>
        <h3>Belum ada reservasi</h3>
        <p>Booking meja untuk nongkrong, meeting, atau momen spesial.</p>
        <Link className="btn" href="/reservasi/">
          Reservasi Meja
        </Link>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="list-head">
        <h1>Aktivitas</h1>
        {seg}
      </div>
      <div className="olist">
        {data && error && (
          <div className="note-bar" style={{ marginTop: 12 }}>
            <Icon n="info" cls="sm" />
            <span>Status terakhir belum diperbarui: {error}</span>
          </div>
        )}
        {body}
        {hydrated && !s.auth && cfg?.otpLogin && data && (data.orders.length > 0 || data.rsvs.length > 0) && (
          <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '18px 8px 0' }}>
            Riwayat ini tersimpan di perangkat ini.{' '}
            <button className="text-btn" onClick={() => openLogin()}>
              Masuk dengan WhatsApp
            </button>{' '}
            agar bisa dibuka di perangkat lain.
          </p>
        )}
      </div>
    </div>
  );
}
