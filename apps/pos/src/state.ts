/* Status aplikasi bersama (backend perangkat, staf yang login, shift) + router hash.
   Dipakai juga oleh modul kantor (apps/pos/src/office) nanti. */
import { useEffect, useState } from 'react';
import type { Backend } from './data/backend';
import { can as canPerm, type Master, type Perm } from './data/master';
import type { MStaff, Shift } from './data/types';
import { bus, useBusTick } from './lib/bus';
import { ss } from './lib/store';
import { closeAllModals } from './ui/overlay';

export const S: { be: Backend; user: MStaff | null; shift: Shift | null } = {
  be: null as unknown as Backend,
  user: null,
  shift: null,
};

export const be = (): Backend => S.be;
export const master = (): Master => S.be.master!;
export const branch = () => S.be.master!.branch!;
export const settings = () => S.be.master!.settings;
export const can = (perm: Perm | string): boolean => canPerm(S.user, perm);
export const today = (): string => S.be.today();
export const user = (): MStaff => S.user!;

/* ---------- sesi staf (bertahan saat halaman dimuat ulang di tab yang sama) ---------- */
const SESSION_KEY = 'pos:user';
export function setUser(staff: MStaff | null): void {
  S.user = staff;
  if (staff) ss.set(SESSION_KEY, { id: staff.id, exp: Date.now() + 12 * 3600e3 });
  else ss.del(SESSION_KEY);
  bus.emit('app', {}, false);
}
export function restoreUser(): void {
  const x = ss.get<{ id: string; exp: number } | null>(SESSION_KEY, null);
  const s = x && x.exp > Date.now() ? S.be.master?.person(x.id) : undefined;
  if (s) S.user = s;
}
/** Keluar (atau kunci layar saja: sesi server tetap). */
export function logout(lockOnly = false): void {
  if (!lockOnly) S.be.logout();
  S.shift = null;
  closeAllModals();
  setUser(null);
  nav('masuk');
}
export function setShift(sh: Shift | null): void {
  S.shift = sh;
  bus.emit('app', {}, false);
}

/** Render ulang saat status aplikasi berubah (login, shift, master, jaringan). */
export function useApp(): typeof S {
  useBusTick(['app', 'master', 'net', 'sync']);
  return S;
}

/* ---------- router hash (jalan juga dari file:// di Electron) ---------- */
export interface Route {
  parts: string[];
  query: Record<string, string>;
}
export function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}
export function nav(path: string, replace = false): void {
  const h = '#/' + String(path).replace(/^#?\/?/, '');
  if (replace) {
    history.replaceState(null, '', h);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}
export function useRoute(): Route {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function homeFor(): string {
  if (!S.be.device?.branchId) return 'kantor';
  if (can('sell')) return 'kasir';
  if (can('kds')) return 'dapur';
  return 'kantor';
}
