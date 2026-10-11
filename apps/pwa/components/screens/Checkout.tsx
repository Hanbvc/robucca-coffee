'use client';
/* Keranjang & checkout: tipe pesanan (Pick Up + jadwal ambil, Delivery + alamat & kurir, Pre-order reservasi),
   data pemesan, isi keranjang, metode bayar, dan ringkasan. Port Checkout + placeOrder() prototipe.
   Total dihitung dengan @robucca/core (sama dengan server); server menghitung ulang dan menolak bila berbeda. */
import { deliveryEtaMinutes, deliveryFee, normalizePhone, rp, tzLabel, uuidv7 } from '@robucca/core';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { RouteCard } from '@/components/RouteCard';
import { confirmSheet } from '@/components/Sheets';
import { openAddress } from '@/components/sheets/AddressSheet';
import { openItem } from '@/components/sheets/ItemSheet';
import { ModeSeg, pickMode } from '@/components/screens/MenuScreen';
import { api, ApiError, errText } from '@/lib/api';
import { clearCart, setLineQty } from '@/lib/cart';
import { courierLook, payLook } from '@/lib/content';
import { orderKey, refreshActivity, useBranches, useCouriers, useMenu, usePayments } from '@/lib/data';
import { cartCount, cartTotals, viewCart } from '@/lib/menu';
import { useNav } from '@/lib/nav';
import { kmLabel, type Kind } from '@/lib/orders';
import { addrKm, addrLines, canDeliver, hasAddr, isFar, located } from '@/lib/places';
import { haptic } from '@/lib/platform';
import { mutate } from '@/lib/remote';
import { addRef, getState, setState, useApp, useHydrated } from '@/lib/store';
import { at, closeOf, dateShort, dot, isOpen, openOf, pickupSlots, PREP_MINUTES } from '@/lib/time';
import { processing, toast, useTick } from '@/lib/ui';

const CLOSED_NOTE: Record<Kind, string> = {
  pickup: 'Pilih jadwal ambil di bawah.',
  delivery: 'Pesanan delivery dikirim begitu kami buka.',
  preorder: 'Pre-order disiapkan menjelang jam reservasi.',
};

export function Checkout() {
  const s = useApp();
  const hydrated = useHydrated();
  const nav = useNav();
  useTick(30_000);
  const code = s.cart.length ? (s.cartBranch ?? s.branch) : s.branch;
  const { data: branches } = useBranches();
  const b = useMemo(() => branches?.find((x) => x.code === code) ?? null, [branches, code]);
  const { menu, idx, error: menuErr, reload } = useMenu(code);
  const { data: couriers } = useCouriers();
  const { data: payOpts, error: payErr, reload: reloadPays } = usePayments();
  const views = useMemo(() => viewCart(s.cart, idx), [s.cart, idx]);

  const [slot, setSlot] = useState('asap');
  const [cutlery, setCutlery] = useState(false);
  const [errs, setErrs] = useState<{ name?: boolean; phone?: boolean }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  /** Satu id per percobaan: kirim ulang (koneksi putus) tidak membuat pesanan ganda. */
  const attempt = useRef<{ id: string; sig: string } | null>(null);

  const pre = s.preRsv && s.preRsv.branch === code ? s.preRsv : null;
  const kind: Kind = pre ? 'preorder' : s.mode === 'delivery' && canDeliver(b) ? 'delivery' : 'pickup';
  const dlv = kind === 'delivery';
  const tz = b?.timezone ?? 'Asia/Jakarta';

  const slots = b && hydrated ? pickupSlots(b) : [];
  const pickup = slots.some((x) => x.v === slot) ? slot : (slots[0]?.v ?? 'asap');

  const pays = (payOpts ?? []).filter((m) => !dlv || m.online);
  const pay = pays.some((m) => m.code === s.pay) ? s.pay : (pays[0]?.code ?? s.pay);
  const payOnline = pays.find((m) => m.code === pay)?.online ?? true;

  const cs = couriers ?? [];
  const courier = cs.find((c) => c.code === s.courier) ?? cs[0] ?? null;
  const km = dlv ? addrKm(b, s.addr) : null;
  const far = dlv && isFar(b, km);
  const fee = dlv && courier && km != null ? deliveryFee(courier, km) : 0;
  const t = cartTotals(views, menu?.taxConfig, fee);
  const count = cartCount(s.cart);
  const open = !hydrated || !b || isOpen(b);
  const problems = views.filter((v) => v.problem);
  const taxPct = (menu?.taxConfig.taxRateBp ?? 0) / 100;
  const taxLabel = menu?.branch.taxLabel || b?.taxLabel || 'Pajak';

  const back = (
    <header className="appbar">
      <button className="icon-btn" onClick={() => nav.back('/menu/')} aria-label="Kembali">
        <Icon n="chevron-left" />
      </button>
      <h1>Keranjang</h1>
      {s.cart.length ? (
        <button
          className="icon-btn"
          aria-label="Kosongkan keranjang"
          onClick={() =>
            confirmSheet({ title: 'Kosongkan keranjang?', text: 'Semua menu di keranjang akan dihapus.', ok: 'Kosongkan', danger: true, onOk: clearCart })
          }
        >
          <Icon n="trash" cls="sm" />
        </button>
      ) : (
        <span className="spacer" />
      )}
    </header>
  );

  if (!hydrated || !s.cart.length) {
    return (
      <div className="screen">
        {back}
        {hydrated && (
          <div className="empty" style={{ paddingTop: 70 }}>
            <div className="em-ico">
              <Icon n="bag" cls="lg" />
            </div>
            <h3>Keranjang masih kosong</h3>
            <p>Yuk pilih kopi atau makanan favoritmu.</p>
            <Link className="btn" href="/menu/">
              Lihat Menu
            </Link>
          </div>
        )}
      </div>
    );
  }

  const lineDec = (key: string, qty: number, name: string): void => {
    setLineQty(key, qty - 1);
    if (qty <= 1) toast(`${name} dihapus`, 'trash');
  };

  const place = async (): Promise<void> => {
    if (busy.current || !b) return;
    if (!idx || !menu) {
      toast('Menu cabang masih dimuat, tunggu sebentar', 'info');
      return;
    }
    if (!b.acceptsPwa) {
      toast(`${b.name} belum menerima pesanan online`, 'info');
      return;
    }
    if (problems.length) {
      document.querySelector('.ci .warn-t')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Ubah atau hapus menu yang bertanda merah dulu', 'info');
      return;
    }
    if (dlv && !hasAddr(s.addr)) {
      toast('Pilih alamat pengiriman dulu', 'map-pin');
      openAddress();
      return;
    }
    if (dlv && !located(s.addr)) {
      toast('Tandai titik lokasimu dulu agar ongkir bisa dihitung', 'map-pin');
      openAddress();
      return;
    }
    const p = getState().profile;
    const e = { name: p.name.trim().length < 2, phone: !normalizePhone(p.phone) };
    if (e.name || e.phone) {
      setErrs(e);
      (e.name ? nameRef : phoneRef).current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Lengkapi data dulu, ya', 'info');
      return;
    }
    if (far) {
      toast(`Di luar jangkauan pengantaran (maks ${b.deliveryMaxKm} km)`, 'info');
      return;
    }
    if (dlv && !courier) {
      toast('Kurir belum tersedia, coba lagi sebentar', 'info');
      return;
    }
    if (!pays.length) {
      toast(payErr ?? 'Metode pembayaran belum dimuat', 'info');
      void reloadPays();
      return;
    }
    const a = s.addr;
    // Hanya delivery: titik lokasi sudah dipastikan ada di atas (located), alamat teks boleh kosong.
    const addrText = dlv && a.lat != null && a.lng != null ? (a.text.trim() || `${addrLines(a).title} (${a.lat.toFixed(5)}, ${a.lng.toFixed(5)})`).slice(0, 300) : '';
    const body: Record<string, unknown> = {
      branchCode: b.code,
      type: dlv ? 'DELIVERY' : 'CLICK_COLLECT',
      name: p.name.trim(),
      phone: p.phone.trim(),
      payment: pay,
      ...(kind === 'pickup' && pickup !== 'asap' ? { pickupAt: new Date(Number(pickup)).toISOString() } : {}),
      ...(kind === 'pickup' ? { cutlery } : {}),
      ...(pre ? { reservationId: pre.id, ...(pre.token ? { reservationToken: pre.token } : {}) } : {}),
      items: views.map((v) => ({
        productId: v.line.productId,
        optionIds: Object.values(v.line.sel).flat(),
        quantity: v.line.qty,
        unitPrice: v.unit,
        ...(v.line.note ? { note: v.line.note } : {}),
      })),
      ...(dlv && courier
        ? {
            delivery: {
              courierCode: courier.code,
              addressText: addrText,
              ...(a.note.trim() ? { addressNote: a.note.trim().slice(0, 200) } : {}),
              lat: a.lat,
              lng: a.lng,
              saveAddress: !!s.auth && !a.savedId,
            },
          }
        : {}),
      expectedTotal: t.total,
    };
    const sig = JSON.stringify(body);
    if (attempt.current?.sig !== sig) attempt.current = { id: uuidv7(), sig };
    busy.current = true;
    const done = processing('Mengirim pesanan…');
    try {
      const r = await api.createOrder({ id: attempt.current.id, ...body });
      attempt.current = null;
      addRef('orders', r.order.id, r.accessToken);
      mutate(orderKey(r.order.id), r.order);
      setState({ cart: [], cartBranch: null, ...(pre ? { preRsv: null } : {}) });
      void refreshActivity();
      done();
      const waiting = r.order.payment.state === 'pending';
      nav.replace(`/pesanan/status/?id=${r.order.id}${waiting ? '&bayar=1' : ''}`);
      if (!waiting) setTimeout(() => toast('Pesanan terkirim!'), 350);
    } catch (err) {
      done();
      toast(errText(err), 'info');
      // Harga, stok, atau total berubah: muat ulang menu agar keranjang menampilkan angka terbaru.
      if (err instanceof ApiError && err.status === 409) void reload();
    } finally {
      busy.current = false;
    }
  };

  let typeBody;
  let afterType = null;
  if (pre) {
    const w = at(pre.reservedFor, tz);
    typeBody = (
      <div className="switch-row" style={{ border: 0, marginTop: 0, padding: 0 }}>
        <span className="lv-ico" style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--sand)', display: 'grid', placeItems: 'center' }}>
          <Icon n="calendar" />
        </span>
        <div className="grow">
          <b>Pre-order reservasi {pre.code}</b>
          <small>
            {dateShort(w.ymd)}, {dot(w.time)} · {pre.guests} orang — disiapkan saat kamu tiba
          </small>
        </div>
        <button
          className="btn sm soft"
          onClick={() => {
            setState({ preRsv: null });
            toast('Pre-order dibatalkan', 'info');
          }}
        >
          Batal
        </button>
      </div>
    );
  } else if (dlv) {
    typeBody = <ModeSeg b={b} />;
    afterType = (
      <>
        <div className="co-route">
          <RouteCard onPickup={() => pickMode('pickup', b)} />
        </div>
        {!far && (
          <div className="card">
            <h3>
              <Icon n="scooter" cls="sm" /> Kurir
            </h3>
            {cs.map((c) => {
              const look = courierLook(c.code, c.name);
              const on = courier?.code === c.code;
              return (
                <button
                  key={c.code}
                  className={`pay ${on ? 'on' : ''}`}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setState({ courier: c.code });
                    haptic();
                  }}
                >
                  <span className="pl" style={{ background: look.bg, fontSize: 9.5 }}>
                    {look.mark}
                  </span>
                  <span className="grow">
                    <b>{c.name}</b>
                    <small>
                      {c.provider}
                      {km != null ? ` · tiba ±${deliveryEtaMinutes(km, PREP_MINUTES)} menit` : ''}
                    </small>
                  </span>
                  <span className="cf">{km != null ? rp(deliveryFee(c, km)) : '—'}</span>
                  <span className="mark" />
                </button>
              );
            })}
            {!cs.length && <p className="faint">Memuat kurir…</p>}
            <div className="note-bar olive" style={{ margin: '12px 0 0' }}>
              <Icon n="info" cls="sm" />
              <span>
                Driver {courier?.provider ?? 'kurir'} dipesan kasir begitu pesananmu siap.{' '}
                {km == null ? 'Tandai titik lokasimu agar ongkir sesuai jarak.' : 'Ongkir mengikuti tarif kurir saat pesanan dibuat.'}
              </span>
            </div>
          </div>
        )}
      </>
    );
  } else {
    typeBody = (
      <>
        <ModeSeg b={b} />
        <div className="slot-lbl" style={{ marginTop: 16 }}>
          Waktu ambil di counter pick-up
        </div>
        <div className="hscroll times">
          {slots.map((x) => (
            <button key={x.v} className={`chip ${pickup === x.v ? 'on' : ''}`} onClick={() => setSlot(x.v)}>
              <span>{x.t}</span>
              <small>{x.s}</small>
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Tanpa antre: pesananmu langsung disiapkan, tinggal ambil di counter dengan menyebut nama atau kode pesanan.
        </p>
        <div className="switch-row">
          <div className="grow">
            <b>Perlu alat makan?</b>
            <small>Sendok, garpu &amp; tisu</small>
          </div>
          <button className={`switch ${cutlery ? 'on' : ''}`} role="switch" aria-checked={cutlery} aria-label="Alat makan" onClick={() => setCutlery(!cutlery)} />
        </div>
      </>
    );
  }

  return (
    <div className="screen">
      {back}
      <div className="co">
        {b && !b.acceptsPwa && (
          <div className="note-bar">
            <Icon n="info" cls="sm" />
            <span>{b.name} belum menerima pesanan online. Pesan langsung di kasir atau pilih cabang lain.</span>
          </div>
        )}
        {b && !open && (
          <div className="note-bar">
            <Icon n="clock" cls="sm" />
            <span>
              Kami sedang tutup (buka {dot(openOf(b))}–{dot(closeOf(b))} {tzLabel(tz)}). {CLOSED_NOTE[kind]}
            </span>
          </div>
        )}
        <div className="card">{typeBody}</div>
        {afterType}

        <div className="card bg-in">
          <h3>
            <Icon n="user" cls="sm" /> {dlv ? 'Data penerima' : 'Data pemesan'}
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>
                {dlv ? (
                  'Nama penerima'
                ) : (
                  <>
                    Nama <em>— dipanggil saat pesanan siap</em>
                  </>
                )}
              </span>
              <input
                ref={nameRef}
                className={`input ${errs.name ? 'err' : ''}`}
                id="f-name"
                autoComplete="name"
                placeholder="Nama kamu"
                maxLength={60}
                value={s.profile.name}
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
              <span>
                No. WhatsApp {dlv ? <em>— dihubungi driver</em> : pre ? <em>— dihubungi bila perlu</em> : null}
              </span>
              <input
                ref={phoneRef}
                className={`input ${errs.phone ? 'err' : ''}`}
                id="f-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="08xxxxxxxxxx"
                maxLength={18}
                value={s.profile.phone}
                onChange={(e) => {
                  setState({ profile: { ...getState().profile, phone: e.target.value } });
                  if (errs.phone) setErrs({ ...errs, phone: false });
                }}
              />
              <span className="err-msg" hidden={!errs.phone}>
                Nomor WhatsApp belum valid.
              </span>
            </label>
          </div>
        </div>

        <div className="card">
          <h3>
            <Icon n="receipt" cls="sm" /> Pesanan <span className="tag">{count} item</span>
          </h3>
          {!idx && menuErr && (
            <div className="load-err">
              <span>Menu cabang belum bisa dimuat. {menuErr}</span>
              <button className="btn sm soft" onClick={() => void reload()}>
                Coba lagi
              </button>
            </div>
          )}
          {!idx && !menuErr && s.cart.map((l) => <div key={l.key} className="skel" style={{ height: 62, marginTop: 12 }} />)}
          {idx &&
            views.map((v) => (
              <div className="ci" key={v.line.key}>
                <Pic src={v.image} name={v.name} />
                <div>
                  <b>{v.name}</b>
                  {v.summary && <small>{v.summary}</small>}
                  {v.line.note && <small>“{v.line.note}”</small>}
                  {v.problem && <small className="warn-t">{v.problem}</small>}
                  {v.p && (
                    <button className="edit-l" onClick={() => openItem(v.p!.id, v.line.key)}>
                      Ubah
                    </button>
                  )}
                </div>
                <div className="ci-r">
                  <span className="pr">{v.p ? rp(v.total) : ''}</span>
                  <span className="qty">
                    <button aria-label={v.line.qty > 1 ? 'Kurangi' : 'Hapus'} onClick={() => lineDec(v.line.key, v.line.qty, v.name)}>
                      {v.line.qty > 1 ? <Icon n="minus" cls="sm" /> : <Icon n="trash" cls="xs" />}
                    </button>
                    <b>{v.line.qty}</b>
                    <button aria-label="Tambah" disabled={!v.p || !!v.problem} onClick={() => setLineQty(v.line.key, v.line.qty + 1)}>
                      <Icon n="plus" cls="sm" />
                    </button>
                  </span>
                </div>
              </div>
            ))}
          <Link className="add-more" href="/menu/">
            <Icon n="plus" cls="sm" /> Tambah menu lain
          </Link>
        </div>

        <div className="card">
          <h3>
            <Icon n="wallet" cls="sm" /> Metode pembayaran
          </h3>
          {!payOpts && payErr && (
            <div className="load-err">
              <span>{payErr}</span>
              <button className="btn sm soft" onClick={() => void reloadPays()}>
                Coba lagi
              </button>
            </div>
          )}
          {pays.map((m) => {
            const look = payLook(m.code, m.name);
            const on = pay === m.code;
            return (
              <button
                key={m.code}
                className={`pay ${on ? 'on' : ''}`}
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setState({ pay: m.code });
                  haptic();
                }}
              >
                <span className="pl" style={{ background: look.bg }}>
                  {look.mark}
                </span>
                <span className="grow">
                  <b>{m.name}</b>
                  {look.sub && <small>{look.sub}</small>}
                </span>
                <span className="mark" />
              </button>
            );
          })}
          {dlv && (
            <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Delivery dibayar online, termasuk ongkir.
            </p>
          )}
          {payOnline && pays.length > 0 && (
            <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Pembayaran online dicek kasir cabang; pesanan disiapkan setelah pembayaran diterima.
            </p>
          )}
        </div>

        <div className="card">
          <h3>Ringkasan pembayaran</h3>
          <div className="sum-row">
            <span>Harga ({count} item)</span>
            <span>{rp(t.sales)}</span>
          </div>
          {t.service > 0 && (
            <div className="sum-row">
              <span>Biaya layanan</span>
              <span>{rp(t.service)}</span>
            </div>
          )}
          {t.tax > 0 && (
            <div className="sum-row">
              <span>{menu?.taxConfig.taxInclusive ? `Termasuk ${taxLabel}` : `${taxLabel} ${taxPct}%`}</span>
              <span>{rp(t.tax)}</span>
            </div>
          )}
          {dlv && (
            <div className="sum-row">
              <span>
                Ongkir {courier?.name ?? ''}
                {km != null ? ` (±${kmLabel(km)})` : ''}
              </span>
              <span>{km != null ? rp(fee) : '—'}</span>
            </div>
          )}
          {t.rounding !== 0 && (
            <div className="sum-row">
              <span>Pembulatan</span>
              <span>{rp(t.rounding)}</span>
            </div>
          )}
          <div className="sum-row total">
            <span>Total</span>
            <span>{rp(t.total)}</span>
          </div>
        </div>
      </div>
      <div className="paybar">
        <div className="pb-t">
          <small>Total bayar</small>
          <b>{rp(t.total)}</b>
        </div>
        <button className={`btn ${far || (b && !b.acceptsPwa) ? 'dis' : ''}`} onClick={() => void place()}>
          {payOnline ? 'Pesan & Bayar' : 'Pesan Sekarang'}
        </button>
      </div>
    </div>
  );
}
