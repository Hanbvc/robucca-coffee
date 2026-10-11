import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Backend } from './data/backend';
import { bus } from './lib/bus';
import { S, restoreUser, setUser } from './state';
import './index.css';

declare global {
  interface Window {
    __posReady?: boolean;
    __posBootFail?: (detail: string) => void;
  }
}

function fail(msg: string): void {
  if (window.__posBootFail) window.__posBootFail(msg);
  else {
    const m = document.getElementById('boot-msg');
    if (m) m.textContent = msg;
  }
}

async function start(): Promise<void> {
  try {
    S.be = await Backend.create();
  } catch (e) {
    console.error(e);
    fail(`Penyimpanan perangkat tidak bisa dibuka: ${(e as Error).message || e}`);
    return;
  }
  if (S.be.device) {
    restoreUser();
    if (S.user) S.shift = await S.be.currentShift();
    if (S.be.isServer) S.be.startSync();
  }
  // staf dihapus/dinonaktifkan dari pusat → keluar
  bus.on('master', () => {
    if (!S.user || !S.be.master) return;
    const p = S.be.master.person(S.user.id);
    if (!p) setUser(null);
    else S.user = p;
  });
  const root = document.getElementById('root');
  if (!root) throw new Error('#root tidak ditemukan');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  window.__posReady = true;
  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.transition = 'opacity .3s';
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 320);
  }
}

/* service worker: aplikasi tetap terbuka saat offline (tidak dipakai di file:// Electron) */
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/[?&]nosw/.test(location.search)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

void start().catch((e: unknown) => {
  console.error(e);
  fail(`Aplikasi gagal dimulai: ${(e as Error).message || e}`);
});
