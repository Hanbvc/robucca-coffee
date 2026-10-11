'use client';
/* Kerangka aplikasi: splash, tab bar, bar keranjang, lembar bawah, toast, layar memproses,
   pilih cabang, tautan lama (#/…), service worker, dan penyesuaian keyboard iPhone. Port dari index.html + js/app.js. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { SheetHost } from '@/components/Sheets';
import { chooseBranch, openBranchPicker } from '@/components/sheets/BranchSheet';
import { rp } from '@robucca/core';
import { SAMPLE } from '@/lib/content';
import { BASE_PATH, DEMO } from '@/lib/env';
import { useActivity, useBranch, useMenu } from '@/lib/data';
import { captureInstall } from '@/lib/install';
import { cartCount, cartTotals, viewCart } from '@/lib/menu';
import { noteNavigation } from '@/lib/nav';
import { isLive, rsvPhase } from '@/lib/orders';
import { closeSheet, installSheetHistory, sheetOpen } from '@/lib/sheets';
import { getState, setState, useApp, useHydrated } from '@/lib/store';
import { useProcessing, useToast } from '@/lib/ui';

/** "/menu/" → "/menu" */
export const normPath = (p: string | null): string => (p ?? '/').replace(/\/+$/, '') || '/';

const TABS = [
  { tab: 'home', href: '/', icon: 'home', label: 'Beranda' },
  { tab: 'menu', href: '/menu/', icon: 'coffee', label: 'Menu' },
  { tab: 'reservasi', href: '/reservasi/', icon: 'calendar', label: 'Reservasi' },
  { tab: 'pesanan', href: '/pesanan/', icon: 'receipt', label: 'Pesanan' },
  { tab: 'akun', href: '/akun/', icon: 'user', label: 'Akun' },
] as const;
const TAB_OF: Record<string, string> = { '/': 'home', '/menu': 'menu', '/reservasi': 'reservasi', '/pesanan': 'pesanan', '/akun': 'akun' };

/** Tautan prototipe lama (#/menu?cat=…, #/pesanan?tab=rsv) → alamat baru. Pesanan lama hanya ada di perangkat lama. */
function legacyHash(h: string): string | null {
  if (!h.startsWith('#/')) return null;
  const [path = '/', qs = ''] = h.slice(1).split('?');
  const q = qs ? `?${qs}` : '';
  if (path === '/' || path === '') return `/${q}`;
  if (path === '/menu') return `/menu/${q}`;
  if (path === '/checkout') return '/checkout/';
  if (path === '/reservasi') return '/reservasi/';
  if (path === '/akun') return '/akun/';
  if (path === '/pesanan') return `/pesanan/${q}`;
  if (path.startsWith('/rsv/')) return '/pesanan/?tab=rsv';
  if (path.startsWith('/order/')) return '/pesanan/';
  return '/';
}

function Toast() {
  const t = useToast();
  return (
    <div id="toast" className={`toast ${t.on ? 'in' : ''}`} role="status" aria-live="polite">
      {t.msg && (
        <>
          <Icon n={t.icon} cls="sm" />
          <span>{t.msg}</span>
        </>
      )}
    </div>
  );
}

function Processing() {
  const text = useProcessing();
  if (!text) return null;
  return (
    <div className="processing">
      <div className="pc">
        <div className="spinner" />
        <p>{text}</p>
      </div>
    </div>
  );
}

function CartBar({ show }: { show: boolean }) {
  const s = useApp();
  const { menu, idx } = useMenu(show ? s.cartBranch ?? s.branch : null);
  const views = useMemo(() => viewCart(s.cart, idx), [s.cart, idx]);
  const count = cartCount(s.cart);
  const total = idx ? cartTotals(views, menu?.taxConfig).total : null;
  const pre = s.preRsv && s.preRsv.branch === s.branch ? s.preRsv : null;
  const ctx = pre ? `Pre-order · ${pre.code}` : s.mode === 'delivery' ? 'Delivery' : 'Pick Up';
  return (
    <Link
      href="/checkout/"
      id="cartbar"
      className="cartbar"
      hidden={!show}
      aria-label={`Buka keranjang, ${count} item${total != null ? `, ${rp(total)}` : ''}`}
    >
      <span className="cb-ico">
        <Icon n="bag" />
        <span className="cb-count">{count}</span>
      </span>
      <span className="cb-text">
        <b>{total != null ? rp(total) : '…'}</b>
        <span>
          {ctx} · {count} item
        </span>
      </span>
      <span className="cb-go">
        Keranjang <Icon n="chevron-right" cls="xs" />
      </span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = normPath(usePathname());
  const router = useRouter();
  const tab = TAB_OF[path];
  const hydrated = useHydrated();
  const s = useApp();
  const { branches } = useBranch();
  const act = useActivity();
  const asked = useRef(false);
  const first = useRef(true);

  const showCart = hydrated && s.cart.length > 0 && (path === '/' || path === '/menu');
  const dot =
    !!act.data && (act.data.orders.some(isLive) || act.data.rsvs.some((r) => rsvPhase(r) === 'upcoming'));

  // Pemasangan sekali: riwayat lembar, event pasang, keyboard, splash, service worker.
  useEffect(() => {
    installSheetHistory();
    captureInstall();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"][tabindex]')) {
        e.preventDefault();
        t.click();
      }
      if (e.key === 'Escape' && sheetOpen()) closeSheet();
    };
    document.addEventListener('keydown', onKey);
    const noop = (): void => {};
    document.addEventListener('touchstart', noop, { passive: true }); // :active di Safari iOS

    // iPhone: tinggi layar saat keyboard terbuka (--kb, --vvh, html.kb)
    const vv = window.visualViewport;
    const root = document.documentElement;
    const syncVV = (): void => {
      if (!vv) return;
      const zoomed = vv.scale > 1.01;
      const kb = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', `${kb}px`);
      root.style.setProperty('--vvh', `${Math.round(zoomed ? window.innerHeight : vv.height)}px`);
      root.classList.toggle('kb', kb > 120);
    };
    vv?.addEventListener('resize', syncVV);
    vv?.addEventListener('scroll', syncVV);
    syncVV();

    // Splash hanya sekali per sesi (kelas no-splash dipasang skrip di <head> bila sudah pernah).
    const splash = document.getElementById('splash');
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (splash && !root.classList.contains('no-splash')) {
      t1 = setTimeout(() => {
        splash.classList.add('out');
        t2 = setTimeout(() => root.classList.add('no-splash'), 600);
      }, 1100);
    }

    // Service worker didaftarkan setelah halaman selesai dimuat, supaya simpanan offline-nya tidak berebut jaringan
    // dengan kunjungan pertama.
    const regSW = (): void => void navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
    const swOn = 'serviceWorker' in navigator && process.env.NODE_ENV === 'production';
    if (swOn && document.readyState === 'complete') regSW();
    else if (swOn) window.addEventListener('load', regSW, { once: true });

    // Tautan lama prototipe (#/…)
    const mapped = legacyHash(location.hash);
    if (mapped) router.replace(mapped);

    return () => {
      window.removeEventListener('load', regSW);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('touchstart', noop);
      vv?.removeEventListener('resize', syncVV);
      vv?.removeEventListener('scroll', syncVV);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [router]);

  // Kelas body: layar tanpa tab bar, ruang untuk bar keranjang.
  useEffect(() => {
    document.body.classList.toggle('sub', !tab);
  }, [tab]);
  useEffect(() => {
    document.body.classList.toggle('has-cart', showCart);
  }, [showCart]);

  // Hitung kedalaman navigasi (tombol kembali di app bar).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    noteNavigation();
  }, [path]);

  // Cabang: ?cabang=KODE, cabang hilang/nonaktif, satu-satunya cabang, atau tanya pelanggan.
  useEffect(() => {
    if (!hydrated || !branches) return;
    const url = new URL(location.href);
    const want = url.searchParams.get('cabang')?.toUpperCase();
    if (want) {
      url.searchParams.delete('cabang');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      const b = branches.find((x) => x.code === want);
      if (b) {
        if (b.code !== getState().branch) chooseBranch(b);
        return;
      }
    }
    const cur = getState().branch;
    if (cur && !branches.some((b) => b.code === cur)) setState({ branch: null });
    if (getState().branch) return;
    const pool = branches.filter((b) => b.acceptsPwa).length ? branches.filter((b) => b.acceptsPwa) : branches;
    if (pool.length === 1) setState({ branch: pool[0]!.code });
    else if (pool.length > 1 && !asked.current && (path === '/' || path === '/menu' || path === '/reservasi')) {
      asked.current = true;
      openBranchPicker();
    }
  }, [hydrated, branches, path]);

  // Mode demo: alamat & penerima contoh selama pelanggan belum mengisi sendiri (seperti prototipe lama).
  useEffect(() => {
    if (!DEMO || !hydrated) return;
    const st = getState();
    if (!st.addr.text.trim() && st.addr.lat == null)
      setState({ addr: { name: SAMPLE.name, text: SAMPLE.text, note: SAMPLE.note, lat: SAMPLE.lat, lng: SAMPLE.lng, savedId: null } });
    if (!st.profile.name.trim() && !st.profile.phone.trim()) setState({ profile: { name: SAMPLE.recipient, phone: SAMPLE.phone } });
  }, [hydrated]);

  // Pre-order yang reservasinya sudah lewat/batal tidak berlaku lagi.
  useEffect(() => {
    const pre = getState().preRsv;
    if (!pre || !act.data) return;
    const r = act.data.rsvs.find((x) => x.id === pre.id);
    if (r && rsvPhase(r) !== 'upcoming') setState({ preRsv: null });
  }, [act.data]);

  return (
    <div id="app" className="app">
      <main id="view" className="view" tabIndex={-1}>
        {children}
      </main>
      <CartBar show={showCart} />
      <nav className="tabbar" aria-label="Navigasi utama">
        {TABS.map((t) => (
          <Link key={t.tab} href={t.href} className={tab === t.tab ? 'on' : undefined} aria-current={tab === t.tab ? 'page' : undefined}>
            <span className="ti">
              <Icon n={t.icon} />
            </span>
            <span>{t.label}</span>
            {t.tab === 'pesanan' && <i className="tab-dot" hidden={!dot} />}
          </Link>
        ))}
      </nav>
      <SheetHost />
      <Toast />
      <Processing />
    </div>
  );
}
