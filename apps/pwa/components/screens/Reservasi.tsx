'use client';
/* Reservasi meja: tanggal, jam, jumlah tamu, area, acara, data pemesan → konfirmasi → tiket.
   Port Reservasi + rsvNext() prototipe; reservasi tersimpan di server dan muncul di POS cabang. */
import { normalizePhone, tzLabel } from '@robucca/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { openBranchPicker } from '@/components/sheets/BranchSheet';
import { api, errText } from '@/lib/api';
import { CONTENT } from '@/lib/content';
import { refreshActivity, rsvKey, useBranch } from '@/lib/data';
import { asset } from '@/lib/env';
import { useNav } from '@/lib/nav';
import { haptic } from '@/lib/platform';
import { mutate } from '@/lib/remote';
import { closeSheet, openSheet } from '@/lib/sheets';
import { addRef, getState, setState, useApp, useHydrated, type Profile, type RsvDraft } from '@/lib/store';
import { addDays, dateLong, dateShort, dayParts, dot, nowAt, rsvDates, rsvSlots } from '@/lib/time';
import type { Branch } from '@/lib/types';
import { processing, toast } from '@/lib/ui';

const PARTS: [string, (m: number) => boolean][] = [
  ['Pagi', (m) => m < 11 * 60],
  ['Siang', (m) => m >= 11 * 60 && m < 15 * 60],
  ['Sore', (m) => m >= 15 * 60 && m < 18 * 60],
  ['Malam', (m) => m >= 18 * 60],
];

/** Area cabang (+ "Bebas" selalu ada). */
export function areasOf(b: Branch): string[] {
  const list = b.reservationAreas.length ? b.reservationAreas : ['Indoor', 'Outdoor'];
  return list.includes('Bebas') ? list : [...list, 'Bebas'];
}

/** Draf reservasi yang masih berlaku (tanggal/jam yang sudah lewat dikosongkan). */
function fixDraft(rd: RsvDraft | null, b: Branch, dates: string[], areas: string[]): RsvDraft {
  let d: RsvDraft = rd ?? { date: dates[0] ?? '', time: null, guests: 2, area: areas[0] ?? 'Bebas', occ: '', note: '' };
  if (!dates.includes(d.date)) d = { ...d, date: dates[0] ?? '', time: null };
  if (d.time && (rsvSlots(b, d.date).find((x) => x.v === d.time)?.off ?? true)) d = { ...d, time: null };
  if (!areas.includes(d.area)) d = { ...d, area: areas[0] ?? 'Bebas' };
  if (d.guests > b.maxReservationGuests) d = { ...d, guests: b.maxReservationGuests };
  return d;
}

function ConfirmRsv({ b, rd, p, onDone }: { b: Branch; rd: RsvDraft; p: Profile; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const tz = tzLabel(b.timezone);
  const ok = async (): Promise<void> => {
    if (busy || !rd.time) return;
    setBusy(true);
    const done = processing('Menyimpan reservasi…');
    try {
      const r = await api.createReservation({
        branchCode: b.code,
        date: rd.date,
        time: rd.time,
        guests: rd.guests,
        area: rd.area,
        ...(rd.occ ? { occasion: rd.occ } : {}),
        ...(rd.note.trim() ? { note: rd.note.trim() } : {}),
        name: p.name.trim(),
        phone: p.phone.trim(),
      });
      addRef('rsvs', r.id, r.accessToken ?? '');
      mutate(rsvKey(r.id), r);
      setState((st) => ({ rd: st.rd ? { ...st.rd, time: null, note: '', occ: '' } : null }));
      void refreshActivity();
      done();
      closeSheet(() => {
        onDone(r.id);
        setTimeout(() => toast('Reservasi tercatat!'), 300);
      });
    } catch (e) {
      done();
      setBusy(false);
      toast(errText(e), 'info');
    }
  };
  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>Konfirmasi reservasi</h2>
          <p>Pastikan detail berikut sudah benar.</p>
        </div>
        <div className="sheet-pad">
          <div className="kv">
            <span>Cabang</span>
            <span>Robucca {b.name}</span>
          </div>
          <div className="kv">
            <span>Tanggal</span>
            <span>{dateLong(rd.date)}</span>
          </div>
          <div className="kv">
            <span>Jam</span>
            <span>
              {dot(rd.time)} {tz}
            </span>
          </div>
          <div className="kv">
            <span>Jumlah tamu</span>
            <span>{rd.guests} orang</span>
          </div>
          <div className="kv">
            <span>Area</span>
            <span>{rd.area}</span>
          </div>
          {rd.occ && (
            <div className="kv">
              <span>Acara</span>
              <span>{rd.occ}</span>
            </div>
          )}
          <div className="kv">
            <span>Atas nama</span>
            <span>{p.name.trim()}</span>
          </div>
          <div className="kv">
            <span>WhatsApp</span>
            <span>{p.phone.trim()}</span>
          </div>
          {rd.note.trim() && (
            <div className="kv">
              <span>Catatan</span>
              <span>{rd.note.trim()}</span>
            </div>
          )}
          <div className="note-bar olive" style={{ margin: '16px 0 0' }}>
            <Icon n="info" cls="sm" />
            <span>Setelah ini, kirim konfirmasi via WhatsApp agar tim kami bisa memastikan mejamu.</span>
          </div>
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn soft" onClick={() => closeSheet()}>
          Ubah
        </button>
        <button className="btn grow" disabled={busy} onClick={() => void ok()}>
          Konfirmasi Reservasi
        </button>
      </div>
    </>
  );
}

export function Reservasi() {
  const s = useApp();
  const hydrated = useHydrated();
  const nav = useNav();
  const { branch: b, loading } = useBranch();
  const [errs, setErrs] = useState<{ name?: boolean; phone?: boolean }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const dates = b && hydrated ? rsvDates(b) : [];
  const areas = useMemo(() => (b ? areasOf(b) : []), [b]);
  const rd = b ? fixDraft(s.rd, b, dates, areas) : null;
  const on = rd?.date;

  useEffect(() => {
    const box = datesRef.current;
    const el = box?.querySelector<HTMLElement>('.date.on');
    if (box && el) box.scrollLeft = el.offsetLeft - 16;
  }, [on, hydrated]);

  if (!b || !rd) {
    return (
      <div className="screen">
        <div className="empty" style={{ paddingTop: 90 }}>
          <div className="em-ico">
            <Icon n="calendar" cls="lg" />
          </div>
          <h3>{loading ? 'Memuat cabang…' : 'Pilih cabang dulu'}</h3>
          <p>Reservasi meja berlaku di cabang Robucca yang kamu pilih.</p>
          {!loading && (
            <button className="btn" onClick={() => openBranchPicker()}>
              Pilih cabang
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!b.acceptsReservations) {
    return (
      <div className="screen">
        <div className="empty" style={{ paddingTop: 90 }}>
          <div className="em-ico">
            <Icon n="calendar" cls="lg" />
          </div>
          <h3>Reservasi belum tersedia</h3>
          <p>Robucca {b.name} belum menerima reservasi online. Hubungi cabang atau pilih cabang lain.</p>
          <button className="btn" onClick={() => openBranchPicker()}>
            Ganti cabang
          </button>
        </div>
      </div>
    );
  }

  const upd = (patch: Partial<RsvDraft>): void => setState({ rd: { ...rd, ...patch } });
  const slots = hydrated ? rsvSlots(b, rd.date) : [];
  const today = nowAt(b.timezone).ymd;
  const tmr = addDays(today, 1);
  const p = s.profile;
  const max = b.maxReservationGuests;
  const tz = tzLabel(b.timezone);

  const next = (): void => {
    if (!rd.time) return;
    const cur = getState().profile;
    const e = { name: cur.name.trim().length < 2, phone: !normalizePhone(cur.phone) };
    if (e.name || e.phone) {
      setErrs(e);
      (e.name ? nameRef : phoneRef).current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Lengkapi data pemesan dulu', 'info');
      return;
    }
    openSheet(<ConfirmRsv b={b} rd={rd} p={cur} onDone={(id) => nav.go(`/reservasi/tiket/?id=${id}`)} />);
  };

  return (
    <div className="screen">
      <section className="rsv-hero">
        <Pic src={CONTENT.rsvImg} eager />
        <div className="rh-in">
          <img src={asset('assets/brand/wordmark-light.png')} alt="Robucca" />
          <h1>Reservasi Meja</h1>
          <p>Amankan tempatmu untuk ngobrol panjang, meeting, atau momen spesial.</p>
          <button className="rh-branch" onClick={() => openBranchPicker()} aria-label={`Cabang Robucca ${b.name}, ganti cabang`}>
            <Icon n="store" cls="xs" /> Robucca {b.name} <Icon n="chevron-right" cls="xs" />
          </button>
        </div>
      </section>
      <div className="rsv-body">
        <div className="card">
          <h3>
            <span className="n">1</span> Pilih tanggal
          </h3>
          <div className="hscroll dates" id="dates" ref={datesRef}>
            {dates.map((x) => {
              const dp = dayParts(x);
              return (
                <button
                  key={x}
                  className={`date ${x === rd.date ? 'on' : ''}`}
                  aria-pressed={x === rd.date}
                  onClick={() => {
                    upd({ date: x, time: rd.time && (rsvSlots(b, x).find((y) => y.v === rd.time)?.off ?? true) ? null : rd.time });
                    haptic();
                  }}
                >
                  <small>{x === today ? 'Hari ini' : x === tmr ? 'Besok' : dp.dow}</small>
                  <b>{dp.d}</b>
                  <small>{dp.mon}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="card">
          <h3>
            <span className="n">2</span> Pilih jam{' '}
            <span className="faint" style={{ fontWeight: 400, fontSize: 12.5, marginLeft: 'auto' }}>
              {rd.date ? dateShort(rd.date) : ''}
            </span>
          </h3>
          {PARTS.map(([lbl, f]) => {
            const ss = slots.filter((x) => f(x.m));
            if (!ss.length) return null;
            return (
              <div key={lbl}>
                <div className="slot-lbl">{lbl}</div>
                <div className="slots">
                  {ss.map((x) => (
                    <button key={x.v} className={`chip ${rd.time === x.v ? 'on' : ''}`} disabled={x.off} onClick={() => upd({ time: x.v })}>
                      {dot(x.v)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="card">
          <h3>
            <span className="n">3</span> Jumlah tamu
          </h3>
          <div className="guests">
            <span className="qty lg">
              <button aria-label="Kurangi tamu" onClick={() => upd({ guests: Math.max(1, rd.guests - 1) })}>
                <Icon n="minus" cls="sm" />
              </button>
              <b>{rd.guests}</b>
              <button aria-label="Tambah tamu" onClick={() => upd({ guests: Math.min(max, rd.guests + 1) })}>
                <Icon n="plus" cls="sm" />
              </button>
            </span>
            <div className="g-txt">
              <b>{rd.guests} orang</b>
              <small>{rd.guests >= 12 ? 'Rombongan besar — tim kami akan menghubungi untuk detail.' : `Maksimal ${max} orang per reservasi`}</small>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>
            <span className="n">4</span> Preferensi area
          </h3>
          <div className="areas">
            {areas.map((a) => {
              const look = CONTENT.areas[a];
              return (
                <button key={a} className={`area ${rd.area === a ? 'on' : ''}`} aria-pressed={rd.area === a} onClick={() => upd({ area: a })}>
                  <Pic src={look?.img} name={a} />
                  <span>
                    {a}
                    {look?.sub && <small>{look.sub}</small>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="slot-lbl" style={{ marginTop: 16 }}>
            Acara <span style={{ fontWeight: 400 }}>(opsional)</span>
          </div>
          <div className="occ">
            {CONTENT.occasions.map((o) => (
              <button key={o} className={`chip sm ${rd.occ === o ? 'on' : ''}`} onClick={() => upd({ occ: rd.occ === o ? '' : o })}>
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="card bg-in">
          <h3>
            <span className="n">5</span> Data pemesan
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>Nama lengkap</span>
              <input
                ref={nameRef}
                className={`input ${errs.name ? 'err' : ''}`}
                id="r-name"
                autoComplete="name"
                placeholder="Nama kamu"
                maxLength={60}
                value={p.name}
                onChange={(e) => {
                  setState({ profile: { ...getState().profile, name: e.target.value } });
                  if (errs.name) setErrs({ ...errs, name: false });
                }}
              />
              <span className="err-msg" hidden={!errs.name}>
                Isi nama kamu.
              </span>
            </label>
            <label className="field">
              <span>No. WhatsApp</span>
              <input
                ref={phoneRef}
                className={`input ${errs.phone ? 'err' : ''}`}
                id="r-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="08xxxxxxxxxx"
                maxLength={18}
                value={p.phone}
                onChange={(e) => {
                  setState({ profile: { ...getState().profile, phone: e.target.value } });
                  if (errs.phone) setErrs({ ...errs, phone: false });
                }}
              />
              <span className="err-msg" hidden={!errs.phone}>
                Nomor WhatsApp belum valid.
              </span>
            </label>
            <label className="field">
              <span>
                Catatan <em>(opsional)</em>
              </span>
              <textarea
                className="textarea"
                maxLength={200}
                placeholder="Contoh: dekat stopkontak, kursi bayi, dekorasi ulang tahun"
                value={rd.note}
                onChange={(e) => upd({ note: e.target.value })}
              />
            </label>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '16px 12px 0' }}>
          Reservasi dikonfirmasi oleh tim Robucca {b.name} melalui WhatsApp.
        </p>
      </div>
      <div className="paybar">
        <div className="pb-t grow" style={{ minWidth: 0 }}>
          <small>{rd.time ? `${dateShort(rd.date)} · ${dot(rd.time)} ${tz}` : 'Pilih jam kedatangan'}</small>
          <b style={{ fontSize: 15, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {rd.guests} orang · {rd.area}
          </b>
        </div>
        <button className="btn" style={{ flex: 'none', padding: '0 26px' }} disabled={!rd.time} onClick={next}>
          Lanjut <Icon n="arrow-right" cls="sm" />
        </button>
      </div>
    </div>
  );
}
