'use client';
/* Beranda: sapaan, kartu cabang, Pick Up / Delivery / Reservasi, pesanan berjalan, banner, signature, kategori,
   cerita, lokasi. Port Home prototipe; data cabang, menu, dan banner dari API. */
import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { Pic } from '@/components/Pic';
import { SigCard, qtyMap } from '@/components/MenuParts';
import { openBranchPicker } from '@/components/sheets/BranchSheet';
import { openSearch } from '@/components/sheets/SearchSheet';
import { openRoute, openStore } from '@/components/sheets/StoreSheet';
import { setMode } from '@/lib/cart';
import { CONTENT } from '@/lib/content';
import { branchOf, useActivity, useBanners, useBranch, useConfig, useMenu } from '@/lib/data';
import { asset, DEMO } from '@/lib/env';
import { catKey } from '@/lib/menu';
import { useNav } from '@/lib/nav';
import { isLive, KIND_LABEL, kindOf, phase, rsvPhase, rsvWhen } from '@/lib/orders';
import { canDeliver } from '@/lib/places';
import { branchMaps, handleOf, isIOS, isStandalone, shortAddress, socialUrl, telLink } from '@/lib/platform';
import { sheetOpen } from '@/lib/sheets';
import { getState, setState, useApp, useHydrated } from '@/lib/store';
import { closeOf, dateShort, dot, greeting, isOpen, openOf } from '@/lib/time';
import type { Banner } from '@/lib/types';
import { toast } from '@/lib/ui';

function Carousel({ banners, hrefOf }: { banners: Banner[]; hrefOf: (b: Banner) => string }) {
  const car = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);
  const nav = useNav();
  useEffect(() => {
    const el = car.current;
    if (!el) return;
    const slides = [...el.querySelectorAll<HTMLElement>('.slide')];
    if (!slides.length) return;
    let idx = 0;
    let paused = false;
    let resume: ReturnType<typeof setTimeout> | undefined;
    const onScroll = (): void => {
      const w = slides[0]!.offsetWidth + 12;
      idx = Math.round(el.scrollLeft / w);
      dots.current?.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === idx));
    };
    const onStart = (): void => {
      paused = true;
      clearTimeout(resume);
    };
    const onEnd = (): void => {
      resume = setTimeout(() => {
        paused = false;
      }, 4000);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd);
    const t = setInterval(() => {
      if (paused || document.hidden || sheetOpen()) return;
      const next = slides[(idx + 1) % slides.length]!;
      el.scrollTo({ left: next.offsetLeft - 16, behavior: 'smooth' });
    }, 5000);
    return () => {
      clearInterval(t);
      clearTimeout(resume);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [banners]);
  return (
    <>
      <div className="hscroll carousel" ref={car}>
        {banners.map((b) => (
          <button key={b.id} className="slide" aria-label={b.label} onClick={() => nav.go(hrefOf(b))}>
            <Pic src={b.imageUrl} imgStyle={b.objectPosition ? { objectPosition: b.objectPosition } : undefined} />
            <span className="go">
              {b.label} <Icon n="arrow-right" cls="xs" />
            </span>
          </button>
        ))}
      </div>
      <div className="dots" ref={dots}>
        {banners.map((b, i) => (
          <i key={b.id} className={i ? undefined : 'on'} />
        ))}
      </div>
    </>
  );
}

export function Home() {
  const s = useApp();
  const hydrated = useHydrated();
  const nav = useNav();
  const { branch: b, loading: bLoading } = useBranch();
  const { data: cfg } = useConfig();
  const { menu, idx } = useMenu(b?.code);
  const { data: banners } = useBanners();
  const act = useActivity();
  const qty = useMemo(() => qtyMap(s.cart), [s.cart]);

  const org = cfg?.org;
  const first = s.profile.name.trim().split(/\s+/)[0] || s.auth?.name?.trim().split(/\s+/)[0] || '';
  const open = hydrated && b ? isOpen(b) : false;
  const live = act.data?.orders.find(isLive);
  const nextR = act.data?.rsvs
    .filter((r) => rsvPhase(r) === 'upcoming')
    .sort((x, y) => Date.parse(x.reservedFor) - Date.parse(y.reservedFor))[0];
  const sigs = useMemo(() => (menu ? menu.categories.flatMap((c) => c.products.filter((p) => p.isSignature)) : []), [menu]);
  const sigCat = menu?.categories.find((c) => c.isSignature && c.products.length);
  const homeCats = menu?.categories.filter((c) => c.imageUrl) ?? [];
  const maps = b ? branchMaps(b) : null;
  const insta = socialUrl('instagram', org?.instagram);

  const start = (m: 'pickup' | 'delivery'): void => {
    const cur = branchOf(getState().branch);
    if (!cur) {
      openBranchPicker(() => start(m));
      return;
    }
    if (m === 'delivery' && !canDeliver(cur)) {
      toast(`Delivery belum tersedia di ${cur.name}`, 'info');
      return;
    }
    setMode(m);
    nav.go('/menu/');
  };
  const bannerHref = (x: Banner): string => {
    const c = x.categoryId ? idx?.byId.get(x.categoryId) : undefined;
    return c ? `/menu/?cat=${encodeURIComponent(catKey(c))}` : '/menu/';
  };

  return (
    <div className="screen">
      <div className="home-top">
        <div className="home-bar">
          <span className="row" style={{ gap: 8 }}>
            <img className="logo" src={asset('assets/brand/wordmark-dark.png')} alt="Robucca" />
            {DEMO && (
              <span className="proto-tag" title="Mode demo: alamat & penerima contoh terisi otomatis">
                Demo
              </span>
            )}
          </span>
          <button className="icon-btn" onClick={() => (b ? openSearch() : openBranchPicker(openSearch))} aria-label="Cari menu">
            <Icon n="search" />
          </button>
        </div>
        <div className="greet">
          <small>
            {hydrated ? greeting(b?.timezone) : 'Halo'}
            {hydrated && first ? `, ${first}` : ''}
          </small>
          <h1>{CONTENT.welcome}</h1>
        </div>
        <button className="store-card" onClick={() => (b ? openStore() : openBranchPicker())} aria-label="Info toko" style={{ display: 'block', width: '100%', textAlign: 'left' }}>
          <Pic src={CONTENT.heroImg} eager />
          {b && hydrated && (
            <span className="sc-tag">
              <span className={`tag ${open ? 'olive' : 'red'}`}>
                <i className="dot" />
                {open ? `Buka · tutup ${dot(closeOf(b))}` : `Tutup · buka ${dot(openOf(b))}`}
              </span>
            </span>
          )}
          <span className="sc-go">
            <Icon n={b ? 'info' : 'store'} cls="sm" />
          </span>
          <span className="sc-in">
            <b className="sc-t">{b ? `Robucca ${b.name}` : bLoading ? 'Robucca' : 'Pilih cabang Robucca'}</b>
            <span className="sc-a">
              <Icon n="map-pin" cls="xs" /> {b ? shortAddress(b.address) || 'Lihat info cabang' : 'Ketuk untuk memilih cabang terdekat'}
            </span>
          </span>
        </button>
        <div className="modes">
          <button className="mode" onClick={() => start('pickup')}>
            <span className="mi">
              <Icon n="bag" />
            </span>
            <span>
              <b>Pick Up</b>
              <small>Pesan &amp; ambil tanpa antre</small>
            </span>
          </button>
          <button className="mode" onClick={() => start('delivery')}>
            <span className="mi">
              <Icon n="scooter" />
            </span>
            <span>
              <b>Delivery</b>
              <small>{b && !canDeliver(b) ? 'Belum tersedia di cabang ini' : 'Diantar GoSend / GrabExpress'}</small>
            </span>
          </button>
          <Link className="mode" href="/reservasi/">
            <span className="mi">
              <Icon n="calendar" />
            </span>
            <span>
              <b>Reservasi</b>
              <small>Booking meja</small>
            </span>
          </Link>
        </div>
      </div>

      {hydrated && isIOS() && !isStandalone() && !s.iosTipOff && (
        <div className="card ios-tip">
          <img src={asset('assets/brand/apple-touch-icon.png')} alt="" />
          <span className="grow">
            <b>Pasang Robucca di iPhone</b>
            <small>
              Ketuk <Icon n="share" /> lalu <b style={{ display: 'inline', fontSize: 12 }}>Tambah ke Layar Utama</b>
            </small>
          </span>
          <button className="icon-btn" onClick={() => setState({ iosTipOff: true })} aria-label="Tutup">
            <Icon n="x" cls="sm" />
          </button>
        </div>
      )}
      {live && (
        <Link className="live" href={`/pesanan/status/?id=${live.id}`}>
          <span className="lv-ico pulse">
            <Icon n={live.type === 'DELIVERY' ? 'scooter' : 'coffee'} />
          </span>
          <span className="grow">
            <b>{phase(live).title}</b>
            <small>
              {live.number} · {KIND_LABEL[kindOf(live)]}
              {b && live.branch.code !== b.code ? ` · ${live.branch.name}` : ''}
            </small>
          </span>
          <Icon n="chevron-right" cls="sm" />
        </Link>
      )}
      {nextR && (
        <Link className="live" href={`/reservasi/tiket/?id=${nextR.id}`}>
          <span className="lv-ico" style={{ background: 'var(--sand)', color: 'var(--ink)' }}>
            <Icon n="calendar" />
          </span>
          <span className="grow">
            <b>
              Reservasi {dateShort(rsvWhen(nextR).ymd)}, {dot(rsvWhen(nextR).time)}
            </b>
            <small>
              {nextR.guests} orang · {nextR.area ?? 'Bebas'} · {nextR.code}
            </small>
          </span>
          <Icon n="chevron-right" cls="sm" />
        </Link>
      )}

      {!!banners?.length && (
        <>
          <div className="sec-h">
            <h2>What&apos;s new</h2>
          </div>
          <Carousel banners={banners} hrefOf={bannerHref} />
        </>
      )}

      {sigs.length > 0 && (
        <>
          <div className="sec-h">
            <h2>Signature</h2>
            <Link className="link" href={sigCat ? `/menu/?cat=${encodeURIComponent(catKey(sigCat))}` : '/menu/'}>
              Lihat menu <Icon n="chevron-right" cls="xs" />
            </Link>
          </div>
          <div className="hscroll sig-list">
            {sigs.map((p) => (
              <SigCard key={p.id} p={p} n={qty.get(p.id) ?? 0} />
            ))}
          </div>
        </>
      )}

      {homeCats.length > 0 && (
        <>
          <div className="sec-h">
            <h2>Kategori</h2>
            <Link className="link" href="/menu/">
              Semua menu <Icon n="chevron-right" cls="xs" />
            </Link>
          </div>
          <div className="cats">
            {homeCats.map((c) => (
              <Link key={c.id} className="cat" href={`/menu/?cat=${encodeURIComponent(catKey(c))}`}>
                <Pic src={c.imageUrl} />
                <span>{c.name}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <section className="story">
        <img className="logo" src={asset('assets/brand/wordmark-light.png')} alt="Robucca" />
        <h2>{CONTENT.story.title}</h2>
        <p>{CONTENT.story.text.replace('{cabang}', b?.name ?? '')}</p>
        <div className="hscroll">
          {CONTENT.storyImgs.map(([img, w]) => (
            <div key={img} className="ph-v" style={{ width: w }}>
              <Pic src={img} style={{ height: '100%' }} />
            </div>
          ))}
        </div>
        <Link className="btn block" href="/reservasi/">
          <Icon n="calendar" cls="sm" /> Reservasi Meja
        </Link>
      </section>

      {b && maps && (
        <>
          <div className="sec-h">
            <h2>Kunjungi kami</h2>
          </div>
          <div className="card visit">
            <iframe src={maps.embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title={`Peta lokasi Robucca ${b.name}`} />
            <div className="vi">
              {b.address && (
                <div className="info-row">
                  <Icon n="map-pin" cls="sm" />
                  <span>{b.address}</span>
                </div>
              )}
              <div className="info-row">
                <Icon n="clock" cls="sm" />
                <span>
                  <b>Setiap hari</b> · {dot(openOf(b))} – {dot(closeOf(b))} WIB
                </span>
              </div>
              <div className="btn-row">
                <button className="btn soft" onClick={() => openRoute(b)}>
                  <Icon n="nav" cls="sm" /> Rute
                </button>
                {b.phone && (
                  <a className="btn soft" href={telLink(b.phone)}>
                    <Icon n="phone" cls="sm" /> Telepon
                  </a>
                )}
                {insta && (
                  <a className="btn soft" href={insta} target="_blank" rel="noopener">
                    <Icon n="instagram" cls="sm" /> Insta
                  </a>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <div className="foot">
        <img src={asset('assets/brand/lockup-dark.png')} alt="Robucca" />
        {org?.instagram ? handleOf(org.instagram) : ''}
      </div>
    </div>
  );
}
