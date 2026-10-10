/* =========================================================
   Kerangka aplikasi: penyiapan perangkat, login, router hash, rail navigasi.
   Port dari pos/js/app.js.
   ========================================================= */
import { tzLabel } from '@robucca/core';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { roleName } from './data/master';
import { bus, useBus, useBusTick } from './lib/bus';
import { Icon, type IconName } from './lib/icons';
import { OfficeHome } from './office/OfficeHome';
import { S, can, homeFor, logout, nav, setShift, useApp, useRoute } from './state';
import { Avatar } from './ui/common';
import { busy, closeAllModals, confirmBox, Modal, openLayer, OverlayHost, toast } from './ui/overlay';
import { BillsView } from './views/Bills';
import { HistoryView } from './views/History';
import { KdsView } from './views/Kds';
import { LoginView } from './views/Login';
import { QueueView } from './views/Queue';
import { SellView } from './views/Sell';
import { SetupView } from './views/Setup';
import { ShiftView } from './views/Shift';

type ViewName = 'kasir' | 'tagihan' | 'riwayat' | 'shift' | 'dapur' | 'antrean' | 'kantor';
const PERM: Record<ViewName, string> = { kasir: 'sell', tagihan: 'sell', riwayat: 'sell', shift: 'sell', dapur: 'kds', antrean: 'kds', kantor: 'office' };
const NEED_BRANCH = new Set<ViewName>(['kasir', 'tagihan', 'riwayat', 'shift', 'dapur', 'antrean']);

export function App() {
  useApp();
  const route = useRoute();
  useIdleLock();
  useRevoked();

  let content: ReactNode;
  if (!S.be.device) content = <Full><SetupView /></Full>;
  else if (!S.user) {
    content = <Full><LoginView /></Full>;
  } else {
    const name = route.parts[0] as ViewName | undefined;
    content = <Routed name={name} params={route.parts.slice(1)} query={route.query} />;
  }
  return (
    <>
      {content}
      <OverlayHost />
    </>
  );
}

/** Halaman layar penuh (penyiapan, login, antrean). */
function Full({ children }: { children: ReactNode }) {
  return <div className="fullview">{children}</div>;
}

function Routed({ name, params, query }: { name: ViewName | undefined; params: string[]; query: Record<string, string> }) {
  const redirect = (): string | null => {
    if (!name || !(name in PERM)) return homeFor();
    if (NEED_BRANCH.has(name) && !S.be.branch) return 'kantor';
    if (!can(PERM[name])) return homeFor() !== name ? homeFor() : null;
    return null;
  };
  const to = redirect();
  useEffect(() => {
    if (!to) return;
    if (name && name in PERM && !can(PERM[name])) toast('Anda tidak punya akses ke halaman itu', 'warn');
    closeAllModals();
    nav(to, true);
  }, [to, name]);
  useEffect(() => closeAllModals(), [name]);
  if (to || !name) return null;
  if (!can(PERM[name])) {
    return (
      <Full>
        <div className="empty">
          <div className="em-ico">
            <Icon name="lock" size="lg" />
          </div>
          <h3>Tidak ada akses</h3>
          <p>Akun ini belum punya hak untuk kasir, dapur, atau kantor.</p>
          <button className="btn" onClick={() => logout(false)}>
            Keluar
          </button>
        </div>
      </Full>
    );
  }
  const view = (() => {
    switch (name) {
      case 'kasir':
        return <SellView key={query.bill ?? 'kasir'} bill={query.bill} />;
      case 'tagihan':
        return <BillsView />;
      case 'riwayat':
        return <HistoryView />;
      case 'shift':
        return <ShiftView />;
      case 'dapur':
        return <KdsView />;
      case 'antrean':
        return <QueueView />;
      case 'kantor':
        return <OfficeHome params={params} />;
    }
  })();
  if (name === 'antrean') return <Full><Boundary key={name}>{view}</Boundary></Full>;
  return (
    <div className="shell">
      <Rail active={name} />
      <main className={`main ${name === 'kasir' ? 'fixed' : ''}`} id="view" tabIndex={-1}>
        <Boundary key={name}>{view}</Boundary>
      </main>
    </div>
  );
}

/* ---------- penangkap galat per halaman ---------- */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override componentDidCatch(err: Error) {
    console.error(err);
  }
  override render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="empty">
        <div className="em-ico">
          <Icon name="alert" size="lg" />
        </div>
        <h3>Halaman gagal dimuat</h3>
        <p>{this.state.err.message}</p>
        <button className="btn" onClick={() => location.reload()}>
          Muat ulang
        </button>
      </div>
    );
  }
}

/* ---------- rail navigasi ---------- */
function Rail({ active }: { active: ViewName }) {
  const be = S.be;
  const b = be.branch;
  useBusTick(['net', 'sync', 'master', 'app']);
  const [bills, setBills] = useState(0);
  const [pending, setPending] = useState(0);
  const refresh = () => {
    if (b) void be.openOrders().then((l) => setBills(l.length));
    if (be.isServer) void be.syncState().then((s) => setPending(s.pending));
  };
  useEffect(refresh, []);
  useBus(['orders', 'sync'], refresh);

  const items: [ViewName, IconName, string][] = [];
  if (b && can('sell')) items.push(['kasir', 'grid', 'Kasir'], ['tagihan', 'note', 'Tagihan'], ['riwayat', 'receipt', 'Riwayat'], ['shift', 'wallet', 'Shift']);
  if (b && can('kds')) items.push(['dapur', 'chef', 'Dapur']);
  if (can('office')) items.push(['kantor', 'chart', 'Kantor']);
  const netCls = be.isDemo ? 'demo' : be.online === false ? 'off' : '';
  const netText = be.isDemo ? 'Demo' : be.online === false ? 'Offline' : 'Online';
  return (
    <nav className="rail" id="rail" aria-label="Navigasi utama">
      <div className="r-logo">
        <img src="assets/brand/wordmark-light.png" alt="Robucca" />
      </div>
      {items.map(([r, ic, label]) => (
        <a key={r} href={`#/${r}`} className={active === r ? 'on' : ''} data-r={r}>
          <Icon name={ic} />
          <span>{label}</span>
          {r === 'tagihan' && bills > 0 && (
            <i className="badge" data-badge="bills">
              {bills}
            </i>
          )}
        </a>
      ))}
      <div className="r-space" />
      <button className={`r-net ${netCls}`} data-act="net" title="Status sinkronisasi" onClick={() => void netInfo()}>
        <i />
        <span>{netText}</span>
        <span data-pending>{be.isServer && pending ? `${pending} antre` : ''}</span>
      </button>
      <button className="r-user" data-act="user" aria-label="Menu pengguna" onClick={() => void userMenu()}>
        <Avatar staff={S.user} size="sm" />
        <span className="clamp1" style={{ maxWidth: 70 }}>
          {(S.user?.name ?? '').split(' ')[0]}
        </span>
      </button>
    </nav>
  );
}

async function userMenu() {
  const be = S.be;
  const b = be.branch;
  const u = S.user!;
  const act = await openLayer<string>((close) => (
    <Modal title={u.name} sub={`${roleName(u.role)}${b ? ` · ${b.name}` : ' · Kantor pusat'}`} size="sm">
      <div className="col">
        <dl className="kv">
          <dt>Perangkat</dt>
          <dd>
            {be.device!.name}
            {b ? ` · Terminal ${be.device!.terminalNo}` : ''}
          </dd>
          <dt>Mode</dt>
          <dd>{be.isDemo ? 'Demo (data di perangkat ini)' : 'Terhubung ke server'}</dd>
          {b && (
            <>
              <dt>Zona waktu</dt>
              <dd>{tzLabel(b.timezone)}</dd>
            </>
          )}
        </dl>
        <hr className="divider" />
        <button className="btn ghost block" data-u="lock" onClick={() => close('lock')}>
          <Icon name="lock" size="sm" /> Kunci layar / ganti kasir
        </button>
        {b && can('kds') && (
          <button className="btn ghost block" data-u="queue" onClick={() => close('queue')}>
            <Icon name="tv" size="sm" /> Layar antrean pelanggan
          </button>
        )}
        {be.isDemo && can('office') && (
          <button className="btn ghost block" data-u="branch" onClick={() => close('branch')}>
            <Icon name="store" size="sm" /> Ganti cabang perangkat ini (demo)
          </button>
        )}
        <button className="btn ghost block" data-u="logout" onClick={() => close('logout')}>
          <Icon name="logout" size="sm" /> Keluar
        </button>
      </div>
    </Modal>
  ));
  if (act === 'lock') logout(true);
  if (act === 'logout') logout(false);
  if (act === 'queue') nav('antrean');
  if (act === 'branch') await switchBranchDemo();
}

async function switchBranchDemo() {
  const be = S.be;
  if (await be.currentShift()) {
    toast('Tutup shift kasir dulu sebelum ganti cabang', 'warn');
    return;
  }
  const { DEMO_BRANCHES } = await import('./data/demo-info');
  const code = await openLayer<string>((close) => (
    <Modal title="Ganti cabang perangkat" sub="Mode demo: perangkat ini berperan sebagai kasir cabang yang dipilih." size="sm">
      <div className="branch-pick">
        {DEMO_BRANCHES.map((x) => (
          <button key={x.code} className={`branch-opt ${x.code === be.device!.branchCode ? 'on' : ''}`} onClick={() => close(x.code)}>
            <b>{x.name}</b>
            <small>{x.code}</small>
          </button>
        ))}
      </div>
    </Modal>
  ));
  if (!code) return;
  await be.switchBranch(code);
  setShift(null);
  toast(`Perangkat kini kasir ${be.branch?.name ?? code}`);
  logout(true);
}

async function netInfo() {
  const be = S.be;
  if (be.isDemo) {
    await openLayer((close) => (
      <Modal title="Mode demo" size="sm">
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          Semua data tersimpan di browser perangkat ini saja. Untuk dipakai bersama oleh semua cabang, jalankan server pusat (apps/api) lalu pasangkan tiap perangkat dengan kode
          pasang 6 digit.
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={() => close()}>
            Tutup
          </button>
        </div>
      </Modal>
    ));
    return;
  }
  const st = await be.syncState();
  const go = await openLayer<boolean>((close) => (
    <Modal
      title="Sinkronisasi"
      size="sm"
      foot={
        <button className="btn" data-sync onClick={() => close(true)}>
          Sinkronkan sekarang
        </button>
      }
    >
      <dl className="kv">
        <dt>Status</dt>
        <dd>{st.online === false ? <span className="neg">Offline</span> : <span className="pos">Online</span>}</dd>
        <dt>Menunggu dikirim</dt>
        <dd>{st.pending} data</dd>
        <dt>Terakhir sinkron</dt>
        <dd>{st.lastSync ? new Date(st.lastSync).toLocaleString('id-ID') : '—'}</dd>
        <dt>Server</dt>
        <dd style={{ wordBreak: 'break-all' }}>{be.device!.serverUrl}</dd>
        <dt>Ditolak server</dt>
        <dd>{st.errors}</dd>
      </dl>
      {be.syncErrors.length > 0 && (
        <div className="note red" style={{ marginTop: 12 }}>
          <Icon name="alert" size="sm" />
          <div>
            {be.syncErrors.slice(0, 5).map((x, i) => (
              <div key={i}>
                {x.label}: {x.errors.join(', ')}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Saat offline, transaksi tetap tersimpan di perangkat ini dan dikirim otomatis begitu koneksi kembali.
      </p>
    </Modal>
  ));
  if (!go) return;
  const bz = busy('Menyinkronkan…');
  await be.syncOnce();
  bz.done();
  const s2 = await be.syncState();
  toast(s2.online === false ? 'Server belum bisa dihubungi' : 'Sinkron selesai', s2.online === false ? 'warn' : 'ok');
}

/* ---------- kunci otomatis saat tidak dipakai ---------- */
function useIdleLock() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (t) clearTimeout(t);
      const min = Number(S.be.master?.settings.autoLockMinutes) || 0;
      if (!min || !S.user) return;
      t = setTimeout(() => {
        if (S.user && !location.hash.includes('antrean') && !location.hash.includes('dapur')) {
          toast('Layar dikunci otomatis', 'warn');
          logout(true);
        }
      }, min * 60e3);
    };
    const evs = ['pointerdown', 'keydown'] as const;
    evs.forEach((ev) => document.addEventListener(ev, arm, { passive: true }));
    const off = bus.on('app', arm);
    arm();
    return () => {
      evs.forEach((ev) => document.removeEventListener(ev, arm));
      off();
      if (t) clearTimeout(t);
    };
  }, []);
}

/* ---------- perangkat dicabut dari pusat ---------- */
function useRevoked() {
  useEffect(() => {
    let shown = false;
    return bus.on('revoked', () => {
      if (shown) return;
      shown = true;
      void openLayer(
        () => (
          <Modal
            title="Akses perangkat dicabut"
            size="sm"
            dismissable={false}
            foot={
              <button className="btn danger" onClick={() => void resetDevice()}>
                Hapus data & pasang ulang
              </button>
            }
          >
            <p style={{ margin: 0, color: 'var(--ink-2)' }}>
              Perangkat ini tidak lagi diizinkan oleh server pusat. Data yang belum terkirim tetap tersimpan di perangkat. Hubungi pemilik/manajer untuk memasangkan ulang.
            </p>
          </Modal>
        ),
        { dismissable: false },
      );
    });
  }, []);
}

export async function resetDevice(): Promise<void> {
  if (!(await confirmBox({ title: 'Hapus semua data perangkat?', text: 'Semua data lokal (termasuk transaksi yang belum terkirim) di perangkat ini akan dihapus.', ok: 'Hapus', danger: true }))) return;
  await S.be.destroy();
  try {
    sessionStorage.clear();
    Object.keys(localStorage).filter((k) => k.startsWith('pos:')).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* noop */
  }
  location.hash = '';
  location.reload();
}
