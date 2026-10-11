/* Kantor: laporan & pengaturan lewat API pusat /office/* (per cabang untuk manajer, semua cabang untuk pemilik).
   Port dari pos/js/views/office/*. Selalu online: data diambil langsung dari server, tidak disimpan di perangkat.
   Bagian bersama: klien & filter (office/lib.ts), komponen tabel/grafik (office/ui.tsx), overlay & toast (ui/overlay.tsx). */
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { IconName } from '../lib/icons';
import { Icon } from '../lib/icons';
import { can as canPerm } from '../data/master';
import { S, can, nav, useApp } from '../state';
import { Empty } from '../ui/common';
import { errText, loadMe, NeedPinError } from './lib';

type Page = [id: string, icon: IconName, label: string, perms: string[], load: () => Promise<{ default: () => ReactNode }>];
const PAGES: Page[] = [
  ['dasbor', 'chart', 'Dasbor', ['report.view'], () => import('./pages/Dashboard')],
  ['transaksi', 'receipt', 'Transaksi', ['report.view'], () => import('./pages/Transactions')],
  ['laporan', 'trend', 'Laporan', ['report.view'], () => import('./pages/Reports')],
  ['shift', 'wallet', 'Shift kasir', ['report.view'], () => import('./pages/Shifts')],
  ['menu', 'coffee', 'Menu & harga', ['menu.manage', 'menu.availability', 'price.manage'], () => import('./pages/Menu')],
  ['stok', 'box', 'Stok', ['stock.manage', 'inventory.manage'], () => import('./pages/Stock')],
  ['promo', 'tag', 'Promo', ['promo.manage'], () => import('./pages/Promos')],
  ['cabang', 'store', 'Cabang', ['branch.manage'], () => import('./pages/Branches')],
  ['karyawan', 'users', 'Karyawan', ['staff.manage'], () => import('./pages/Staff')],
  ['perangkat', 'tablet', 'Perangkat', ['device.manage'], () => import('./pages/Devices')],
  ['pengaturan', 'settings', 'Pengaturan', ['settings.manage'], () => import('./pages/Settings')],
  ['log', 'activity', 'Log aktivitas', ['audit.view'], () => import('./pages/Audit')],
];
const LAZY = new Map(PAGES.map((p) => [p[0], lazy(p[4])]));
const allowed = (p: Page) => p[3].some((x) => canPerm(S.user, x));

export function OfficeHome({ params }: { params: string[] }) {
  useApp();
  const pages = PAGES.filter(allowed);
  const id = params[0] && pages.some((p) => p[0] === params[0]) ? params[0] : pages[0]?.[0];
  useEffect(() => {
    if (id && params[0] !== id) history.replaceState(null, '', `#/kantor/${id}`);
  }, [id, params]);
  return (
    <div className="office">
      <nav className="subnav" aria-label="Menu kantor">
        <h3>Kantor</h3>
        {pages.map(([pid, ic, label]) => (
          <a key={pid} href={`#/kantor/${pid}`} className={pid === id ? 'on' : ''} data-page={pid}>
            <Icon name={ic} size="sm" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="office-main" id="om">
        {!S.be.isServer ? <DemoOnly /> : id ? <Ready key={`${id}:${S.user?.id ?? ''}`} id={id} /> : null}
      </div>
    </div>
  );
}

/** Pastikan sesi server & daftar cabang siap sebelum halaman dimuat. */
function Ready({ id }: { id: string }) {
  const [state, setState] = useState<'wait' | 'ok' | 'pin' | { err: unknown }>('wait');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState('wait');
    loadMe(tick > 0).then(
      () => live && setState('ok'),
      (e: unknown) => live && setState(e instanceof NeedPinError ? 'pin' : { err: e }),
    );
    return () => {
      live = false;
    };
  }, [tick]);
  if (state === 'wait') {
    return (
      <div className="page">
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }
  if (state === 'pin') return <PinCard onDone={() => setTick((n) => n + 1)} />;
  if (typeof state === 'object') return <Offline err={state.err} retry={() => setTick((n) => n + 1)} />;
  const Page = LAZY.get(id)!;
  return (
    <PageBoundary key={id} onPin={() => setState('pin')}>
      <Suspense
        fallback={
          <div className="page">
            <div className="empty">
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          </div>
        }
      >
        <Page />
      </Suspense>
    </PageBoundary>
  );
}

class PageBoundary extends Component<{ children: ReactNode; onPin: () => void }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override componentDidCatch(err: Error) {
    if (err instanceof NeedPinError) this.props.onPin();
    else console.error(err);
  }
  override render() {
    const e = this.state.err;
    if (!e || e instanceof NeedPinError) return e ? null : this.props.children;
    return <Offline err={e} retry={() => this.setState({ err: null })} />;
  }
}

function Offline({ err, retry }: { err: unknown; retry: () => void }) {
  return (
    <div className="page">
      <Empty icon="wifi-off" title="Perlu koneksi ke server">
        <p>{errText(err)}</p>
        <button className="btn" data-retry onClick={retry}>
          <Icon name="rotate" size="sm" /> Coba lagi
        </button>
      </Empty>
    </div>
  );
}

/** Sesi server habis (mis. setelah muat ulang halaman): masukkan PIN sekali lagi. */
function PinCard({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!S.user || busy) return;
    setBusy(true);
    const r = await S.be.login(S.user, pin);
    setBusy(false);
    if (r.ok && (await S.be.ensureSession())) return onDone();
    setErr(r.error ?? (r.locked ? `Terlalu banyak percobaan. Coba lagi dalam ${r.locked} detik.` : r.ok ? 'Server tidak bisa dihubungi. Periksa koneksi internet.' : 'PIN salah.'));
  };
  return (
    <>
      <div className="topbar">
        <h1>Kantor</h1>
      </div>
      <div className="page">
        <div className="card pad" style={{ maxWidth: 420 }}>
          <h3 className="card-title">
            <Icon name="lock" size="sm" /> Verifikasi ke server
          </h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            Masukkan PIN Anda sekali lagi untuk membuka data kantor dari server pusat.
          </p>
          <div className="row">
            <input
              className="input"
              id="op-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="PIN"
              autoComplete="off"
              value={pin}
              autoFocus
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setErr('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void go();
              }}
            />
            <button className="btn" id="op-go" disabled={busy || pin.length < 4} onClick={() => void go()}>
              Buka
            </button>
          </div>
          {err ? <p className="err-text">{err}</p> : null}
        </div>
      </div>
    </>
  );
}

/** Mode demo: tidak ada server pusat, jadi tidak ada data kantor. */
function DemoOnly() {
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Kantor</h1>
          <div className="crumb">Laporan & pengaturan semua cabang</div>
        </div>
      </div>
      <div className="page">
        <div className="card pad" style={{ maxWidth: 720 }} data-office="demo">
          <h3 className="card-title">
            <Icon name="cloud" size="sm" /> Kantor memakai server pusat
          </h3>
          <p style={{ margin: '0 0 10px', color: 'var(--ink-2)' }}>
            Perangkat ini dalam mode demo: transaksi hanya tersimpan di browser ini. Dasbor, laporan, menu, stok, promo, karyawan, perangkat, dan pengaturan dibaca langsung dari
            server pusat, jadi selalu butuh koneksi.
          </p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 20, color: 'var(--ink-2)', lineHeight: 1.7 }}>
            <li>Jalankan API pusat (apps/api) dan buat kode pasang dengan <code>pnpm --filter @robucca/api pair</code>.</li>
            <li>Di perangkat ini pilih <b>Hubungkan ke server pusat</b> lalu masukkan kodenya.</li>
            <li>Masuk sebagai pemilik atau manajer, lalu buka Kantor.</li>
          </ol>
          {can('sell') && S.be.branch && (
            <button className="btn" onClick={() => nav('kasir')}>
              <Icon name="grid" size="sm" /> Ke kasir
            </button>
          )}
        </div>
      </div>
    </>
  );
}
