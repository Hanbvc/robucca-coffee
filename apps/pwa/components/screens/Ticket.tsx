'use client';
/* Tiket reservasi: status dari server (dikonfirmasi kasir di POS), kode, WhatsApp, pre-order, kalender, bagikan, batal.
   Port RsvView prototipe. */
import { rp, tzLabel } from '@robucca/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { confirmSheet } from '@/components/Sheets';
import { chooseBranch } from '@/components/sheets/BranchSheet';
import { api, errText } from '@/lib/api';
import { CONTENT } from '@/lib/content';
import { branchOf, refreshActivity, rsvKey, tokenFor, useActivity, useBranches, useReservation } from '@/lib/data';
import { asset } from '@/lib/env';
import { useNav } from '@/lib/nav';
import { rsvMsg, rsvPhase, rsvTag, rsvWhen } from '@/lib/orders';
import { branchMaps, copyText, downloadICS, waLink, waNumber } from '@/lib/platform';
import { mutate } from '@/lib/remote';
import { getState, setState, useApp, useHydrated } from '@/lib/store';
import { dateLong, dot } from '@/lib/time';
import type { Reservation } from '@/lib/types';
import { toast } from '@/lib/ui';

export function Ticket() {
  const q = useSearchParams();
  const id = q.get('id');
  const hydrated = useHydrated();
  const nav = useNav();
  const s = useApp();
  const { data: r, error, reload } = useReservation(hydrated && id ? id : null);
  const { data: branches } = useBranches();
  const act = useActivity();
  const retried = useRef(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && !!navigator.share), []);

  // Pelanggan masuk tanpa token di perangkat: muat daftar akun dulu, lalu coba sekali lagi.
  useEffect(() => {
    if (!error || r || retried.current || !s.auth) return;
    retried.current = true;
    void refreshActivity().then(() => reload());
  }, [error, r, s.auth, reload]);

  const bar = (
    <header className="appbar">
      <button className="icon-btn" onClick={() => nav.back('/pesanan/?tab=rsv')} aria-label="Kembali">
        <Icon n="chevron-left" />
      </button>
      <h1>Reservasi</h1>
      <span className="spacer" />
    </header>
  );

  if (!id || (error && !r && (!s.auth || retried.current))) {
    const gone = !id || (error && /tidak ditemukan|forbidden|403|404/i.test(error));
    return (
      <div className="screen">
        {bar}
        <div className="empty">
          <h3>{gone ? 'Reservasi tidak ditemukan' : 'Reservasi belum bisa dimuat'}</h3>
          {!gone && <p>{error}</p>}
          {gone ? (
            <Link className="btn" href="/reservasi/">
              Buat reservasi
            </Link>
          ) : (
            <button className="btn" onClick={() => void reload()}>
              Coba lagi
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!r) {
    return (
      <div className="screen">
        {bar}
        <div className="pad" style={{ paddingTop: 20 }}>
          <div className="skel" style={{ height: 300 }} />
        </div>
      </div>
    );
  }

  const b = branches?.find((x) => x.code === r.branch.code) ?? null;
  const tz = r.branch.timezone;
  const w = rsvWhen(r);
  const ph = rsvPhase(r);
  const tag = rsvTag(r);
  const wa = waNumber(b);
  const pre = r.preOrders.find((o) => o.status !== 'VOIDED' && o.status !== 'REFUNDED') ?? null;
  const preOrder = pre ? act.data?.orders.find((o) => o.id === pre.id) : undefined;
  const area = r.area ?? 'Bebas';
  const address = r.branch.address ?? b?.address ?? '';

  const startPre = (): void => {
    const go = (): void => {
      setState({ preRsv: { id: r.id, token: tokenFor('rsvs', r.id) ?? '', code: r.code, reservedFor: r.reservedFor, guests: r.guests, branch: r.branch.code } });
      nav.go('/menu/');
      setTimeout(() => toast(`Pre-order untuk ${r.code}`, 'calendar'), 300);
    };
    if (getState().branch === r.branch.code) {
      go();
      return;
    }
    const target = branchOf(r.branch.code);
    if (!target) {
      toast('Cabang reservasi ini sudah tidak aktif', 'info');
      return;
    }
    chooseBranch(target, go);
  };

  const cancel = (): void =>
    confirmSheet({
      title: 'Batalkan reservasi?',
      text: pre
        ? 'Reservasi ini akan dibatalkan, termasuk pre-order yang belum dibayar. Kabari kami via WhatsApp jika sudah sempat dikonfirmasi.'
        : 'Reservasi ini akan ditandai batal. Kabari kami via WhatsApp jika sudah sempat dikonfirmasi.',
      ok: 'Ya, batalkan',
      danger: true,
      onOk: () => {
        void (async () => {
          try {
            const x: Reservation = await api.cancelReservation(r.id, tokenFor('rsvs', r.id));
            mutate(rsvKey(r.id), x);
            if (getState().preRsv?.id === r.id) setState({ preRsv: null });
            void refreshActivity();
            toast('Reservasi dibatalkan', 'info');
          } catch (e) {
            toast(errText(e), 'info');
            void reload();
          }
        })();
      },
    });

  const ics = (): void =>
    downloadICS({
      uid: r.id,
      start: Date.parse(r.reservedFor),
      minutes: 120,
      title: `Reservasi Robucca ${r.branch.name} (${r.guests} orang)`,
      location: address || `Robucca ${r.branch.name}`,
      description: `Kode reservasi ${r.code} · Area ${area}`,
      alarm: `Reservasi Robucca ${r.branch.name}`,
      file: `reservasi-robucca-${r.code}.ics`,
      domain: CONTENT.icsDomain,
    });

  const share = (): void => {
    const maps = b ? branchMaps(b).url : '';
    const text = [`Reservasi di Robucca ${r.branch.name}`, `${dateLong(w.ymd)}, ${dot(w.time)} ${tzLabel(tz)} · ${r.guests} orang`, address, maps].filter(Boolean).join('\n');
    navigator.share({ title: 'Reservasi Robucca', text }).catch(() => {});
  };

  return (
    <div className="screen">
      {bar}
      <div className="ticket">
        <div className="tk-top">
          <img src={asset('assets/brand/wordmark-light.png')} alt="Robucca" />
          <span className={`tag ${tag.cls}`}>{tag.text}</span>
          <h2>{dateLong(w.ymd).replace(/ \d{4}$/, '')}</h2>
          <p>
            {dot(w.time)} {tzLabel(tz)} · {r.guests} orang · {area}
          </p>
        </div>
        <div className="tk-cut">
          <i />
        </div>
        <div className="tk-grid">
          <div>
            <small>Atas nama</small>
            <b>{r.name}</b>
          </div>
          <div>
            <small>WhatsApp</small>
            <b>{r.phone}</b>
          </div>
          <div>
            <small>Cabang</small>
            <b>{r.branch.name}</b>
          </div>
          <div>
            <small>Acara</small>
            <b>{r.occasion || '—'}</b>
          </div>
          {r.note && (
            <div style={{ gridColumn: '1/-1' }}>
              <small>Catatan</small>
              <b style={{ fontWeight: 500 }}>{r.note}</b>
            </div>
          )}
        </div>
        <div className="tk-code">
          <span>
            <small className="faint" style={{ display: 'block', fontSize: 11.5 }}>
              Kode reservasi
            </small>
            <b>{r.code}</b>
          </span>
          <button
            className="icon-btn"
            aria-label="Salin kode"
            onClick={() => void copyText(r.code).then((ok) => toast(ok ? 'Kode disalin' : `Kode: ${r.code}`, 'copy'))}
          >
            <Icon n="copy" cls="sm" />
          </button>
        </div>
      </div>
      {ph === 'upcoming' ? (
        <>
          {wa && (
            <div className="actions" style={{ marginTop: 14 }}>
              <a className="btn block olive" href={waLink(wa, rsvMsg(r))} target="_blank" rel="noopener">
                <Icon n="chat" cls="sm" /> Konfirmasi via WhatsApp
              </a>
            </div>
          )}
          {pre && (
            <Link className="live" href={`/pesanan/status/?id=${pre.id}`}>
              <span className="lv-ico">
                <Icon n="receipt" />
              </span>
              <span className="grow">
                <b>Pre-order {pre.number}</b>
                <small>
                  {preOrder ? `${preOrder.items.reduce((a, l) => a + l.quantity, 0)} item · ` : ''}
                  {rp(pre.total)}
                </small>
              </span>
              <Icon n="chevron-right" cls="sm" />
            </Link>
          )}
          <div className="actions two">
            {!pre && (
              <button className="btn soft" onClick={startPre}>
                <Icon n="coffee" cls="sm" /> Pre-order
              </button>
            )}
            <button className="btn soft" onClick={ics} style={pre ? { gridColumn: '1/-1' } : undefined}>
              <Icon n="calendar-plus" cls="sm" /> Kalender
            </button>
            {canShare && (
              <button className="btn soft" onClick={share} style={{ gridColumn: '1/-1' }}>
                <Icon n="share" cls="sm" /> Bagikan ke teman
              </button>
            )}
          </div>
          <div className="pad" style={{ marginTop: 6, paddingBottom: 'calc(28px + var(--safe-b))' }}>
            <button className="btn block" style={{ background: 'transparent', color: 'var(--danger)', height: 46 }} onClick={cancel}>
              Batalkan reservasi
            </button>
          </div>
        </>
      ) : (
        <div className="actions" style={{ paddingBottom: 28 }}>
          <Link className="btn" href="/reservasi/">
            <Icon n="calendar" cls="sm" /> Buat reservasi baru
          </Link>
        </div>
      )}
    </div>
  );
}
