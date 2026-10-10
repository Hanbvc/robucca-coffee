/* Login staf dengan PIN. Kasir/dapur diverifikasi di perangkat dengan hash dari master (tetap bisa offline);
   manajer/pemilik (staf penyetuju) di mode server hanya lewat server karena hash PIN-nya tidak dikirim ke perangkat.
   Port dari pos/js/views/login.js. */
import { businessDate, clock, dateLabel, tzLabel } from '@robucca/core';
import { useEffect, useState } from 'react';
import { DEMO_PINS } from '../data/demo-info';
import { roleName } from '../data/master';
import type { MStaff } from '../data/types';
import { Icon } from '../lib/icons';
import { S, homeFor, master, nav, setShift, setUser, useApp } from '../state';
import { Avatar, PinPad, useKeys } from '../ui/common';

export function LoginView() {
  const be = S.be;
  const m = master();
  const b = m.branch;
  const tz = b?.timezone ?? 'Asia/Jakarta';
  useApp(); // status jaringan
  const people = m.staff;
  const offline = be.offline;
  const blocked = (s: MStaff) => offline && be.needsServer(s);
  const [who, setWho] = useState<MStaff | null>(people.length === 1 ? people[0]! : null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!location.hash.startsWith('#/masuk')) history.replaceState(null, '', '#/masuk');
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const submit = async (p: string) => {
    if (!who || busy || p.length < 4) return;
    setBusy(true);
    const res = await be.login(who, p);
    setBusy(false);
    if (!res.ok) {
      setPin('');
      setMsg(res.error ?? (res.locked ? `Terlalu banyak percobaan. Coba lagi dalam ${res.locked} detik.` : 'PIN salah.'));
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    S.shift = b ? await be.currentShift() : null;
    setUser(who);
    setShift(S.shift);
    nav(homeFor());
  };

  const key = (k: string) => {
    if (!who) return;
    if (k === 'ok') return void submit(pin);
    const next = k === 'del' ? pin.slice(0, -1) : /^\d$/.test(k) && pin.length < 6 ? pin + k : pin;
    setPin(next);
    setMsg('');
    if (next.length === 6) void submit(next);
  };
  useKeys(
    (e) => {
      if (!who) return;
      if (/^\d$/.test(e.key)) key(e.key);
      else if (e.key === 'Backspace') key('del');
      else if (e.key === 'Enter') key('ok');
      else if (e.key === 'Escape') setWho(null);
    },
    [who, pin, busy],
  );

  return (
    <div className="split">
      <section className="brand-side">
        <img className="logo" src="assets/brand/wordmark-light.png" alt="Robucca" />
        <div>
          <h1>{b ? b.name : 'Kantor pusat'}</h1>
          <p style={{ marginTop: 8 }}>{b ? `${m.settings.orgName} · Terminal ${be.device!.terminalNo} · ${be.device!.name}` : 'Laporan & pengaturan semua cabang'}</p>
        </div>
        <div className="meta">
          <div className="clock" id="lg-clock">
            {clock(now, tz)}
          </div>
          <div id="lg-date">
            {dateLabel(businessDate(now, tz), true)} · {tzLabel(tz)}
          </div>
          <span className="pill">
            {be.isDemo ? (
              <>
                <Icon name="star" size="xs" /> Mode demo — data contoh
              </>
            ) : (
              <>
                <Icon name="cloud" size="xs" /> Server pusat
              </>
            )}
          </span>
        </div>
      </section>
      <section className="main-side" id="lg-main">
        {!who ? (
          <>
            <h2>Siapa yang bertugas?</h2>
            <p className="lead">Pilih nama Anda, lalu masukkan PIN.</p>
            {people.length ? (
              <div className="staff-grid">
                {people.map((s) => (
                  <button
                    key={s.id}
                    className="staff"
                    data-staff={s.id}
                    onClick={() => {
                      setWho(s);
                      setPin('');
                      setMsg('');
                    }}
                  >
                    <Avatar staff={s} />
                    <b>{s.name}</b>
                    <span className="tag">{roleName(s.role)}</span>
                    {blocked(s) && (
                      <span className="tag" data-online-only style={{ color: 'var(--red)' }}>
                        <Icon name="wifi-off" size="xs" /> butuh koneksi
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="note red">
                <Icon name="alert" size="sm" />
                <span>Belum ada staf aktif untuk {b ? 'cabang ini' : 'kantor pusat'}. Tambahkan staf dari kantor pusat.</span>
              </div>
            )}
            {offline && people.some((s) => be.needsServer(s)) && (
              <div className="note" style={{ marginTop: 14 }} data-offline-note>
                <Icon name="wifi-off" size="sm" />
                <span>
                  Perangkat sedang offline. Kasir & dapur tetap bisa masuk. <b>Manajer & pemilik hanya bisa masuk saat online</b> — PIN mereka diperiksa server pusat.
                </span>
              </div>
            )}
            {be.isDemo && (
              <div className="demo-pins">
                <Icon name="key" size="xs" /> PIN demo — Pemilik <b>{DEMO_PINS.owner}</b> · Manajer <b>{DEMO_PINS.manager}</b> · Kasir <b>{DEMO_PINS.cashier}</b> · Dapur{' '}
                <b>{DEMO_PINS.kitchen}</b>
              </div>
            )}
          </>
        ) : (
          <PinPad
            pin={pin}
            msg={busy ? 'Memeriksa…' : msg || (blocked(who) ? `Tidak ada koneksi. ${who.name} hanya bisa masuk saat perangkat online.` : '')}
            shake={shake}
            onKey={key}
            top={
              <button className="btn ghost sm" data-back style={{ justifySelf: 'start' }} onClick={() => setWho(null)}>
                <Icon name="chevron-left" size="sm" /> Ganti nama
              </button>
            }
            who={
              <div className="pin-who">
                <Avatar staff={who} />
                <div>
                  <b>{who.name}</b>
                  <small>{roleName(who.role)}</small>
                </div>
              </div>
            }
          />
        )}
      </section>
    </div>
  );
}
