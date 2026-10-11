/* Data server untuk layar: katalog (disimpan di perangkat agar cepat dibuka), cabang pilihan,
   dan aktivitas (pesanan & reservasi milik perangkat ini atau akun yang masuk). */
import { useEffect, useMemo } from 'react';
import { api } from './api';
import { indexMenu, type MenuIndex } from './menu';
import { fetchInto, peek, refetch, useRemote } from './remote';
import { getState, tokenOf, useApp, type State } from './store';
import type { Branch, Menu, PublicOrder, Reservation } from './types';

const MIN = 60_000;

export const useConfig = () => useRemote('config', api.config, { persist: true, maxAge: 10 * MIN });
export const useBranches = () => useRemote('branches', api.branches, { persist: true, maxAge: 2 * MIN });
export const useBanners = () => useRemote('banners', api.banners, { persist: true, maxAge: 10 * MIN });
export const useCouriers = () => useRemote('couriers', api.couriers, { persist: true, maxAge: 10 * MIN });
export const usePayments = () => useRemote('payments', api.payments, { persist: true, maxAge: 10 * MIN });

export const menuKey = (code: string): string => `menu:${code}`;
export function useMenu(code: string | null | undefined): { menu: Menu | undefined; idx: MenuIndex | null; error: string | undefined; loading: boolean; reload: () => Promise<void> } {
  const r = useRemote(code ? menuKey(code) : null, () => api.menu(code!), { persist: true, maxAge: MIN });
  const idx = useMemo(() => (r.data ? indexMenu(r.data) : null), [r.data]);
  return { menu: r.data, idx, error: r.error, loading: r.loading, reload: r.reload };
}

/** Menu cabang (dari cache bila ada, selain itu dimuat dulu). */
export async function loadMenu(code: string): Promise<Menu> {
  const hit = peek<Menu>(menuKey(code));
  if (hit) return hit;
  await fetchInto(menuKey(code), () => api.menu(code), true);
  const m = peek<Menu>(menuKey(code));
  if (!m) throw new Error('Menu cabang belum bisa dimuat. Coba lagi.');
  return m;
}

/** Cabang pilihan (null bila belum memilih atau cabang sudah tidak aktif). */
export function useBranch(): { branch: Branch | null; branches: Branch[] | undefined; loading: boolean; error: string | undefined } {
  const { branch: code } = useApp();
  const r = useBranches();
  const branch = useMemo(() => r.data?.find((b) => b.code === code) ?? null, [r.data, code]);
  return { branch, branches: r.data, loading: r.loading && !r.data, error: r.error };
}

export const branchOf = (code: string | null | undefined): Branch | null => peek<Branch[]>('branches')?.find((b) => b.code === code) ?? null;

// --- Aktivitas ------------------------------------------------------------------------

/** Token akses pesanan/reservasi akun (dari /me) hanya disimpan di memori, bukan di perangkat. */
const memTokens = new Map<string, string>();

/** Token untuk membuka pesanan/reservasi: referensi di perangkat dulu, lalu token dari daftar akun. */
export function tokenFor(kind: 'orders' | 'rsvs', id: string): string | undefined {
  return tokenOf(kind, id) ?? memTokens.get(`${kind}:${id}`);
}
/** Keluar akun: token pesanan/reservasi milik akun ikut dilupakan. */
export const forgetTokens = (): void => memTokens.clear();

export interface Activity {
  orders: PublicOrder[];
  rsvs: Reservation[];
}

const sigOf = (s: State): string => `${s.auth ? 'u' : 'g'}|${s.orders.length}|${s.rsvs.length}|${s.orders[0]?.id ?? ''}|${s.rsvs[0]?.id ?? ''}`;
let loadedSig: string | null = null;

function mergeById<T extends { id: string; createdAt: string }>(...lists: T[][]): T[] {
  const m = new Map<string, T>();
  for (const l of lists) for (const x of l) m.set(x.id, x);
  return [...m.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function loadActivity(): Promise<Activity> {
  const s = getState();
  loadedSig = sigOf(s);
  const refs = (l: { id: string; token: string }[]) => l.map(({ id, token }) => ({ id, token }));
  const [lo, lr, mo, mr] = await Promise.all([
    s.orders.length ? api.lookupOrders(refs(s.orders)) : Promise.resolve([] as PublicOrder[]),
    s.rsvs.length ? api.lookupReservations(refs(s.rsvs)) : Promise.resolve([] as Reservation[]),
    s.auth ? api.myOrders() : Promise.resolve([] as PublicOrder[]),
    s.auth ? api.myReservations() : Promise.resolve([] as Reservation[]),
  ]);
  for (const o of mo) if (o.accessToken) memTokens.set(`orders:${o.id}`, o.accessToken);
  for (const r of mr) if (r.accessToken) memTokens.set(`rsvs:${r.id}`, r.accessToken);
  return { orders: mergeById(lo, mo), rsvs: mergeById(lr, mr) };
}

export const refreshActivity = (): Promise<void> => refetch('activity', loadActivity);

// --- Satu pesanan / reservasi ------------------------------------------------------

export const orderKey = (id: string): string => `order:${id}`;
export const rsvKey = (id: string): string => `rsv:${id}`;

/** Pesanan (tamu: token di perangkat; akun: token pelanggan). Diperbarui berkala; status real-time lewat SSE di layar status. */
export const useOrder = (id: string | null) =>
  useRemote<PublicOrder>(id ? orderKey(id) : null, () => api.order(id!, tokenFor('orders', id!)), { maxAge: 15_000, poll: 20_000 });

export const useReservation = (id: string | null) =>
  useRemote<Reservation>(id ? rsvKey(id) : null, () => api.reservation(id!, tokenFor('rsvs', id!)), { maxAge: 20_000, poll: 30_000 });

/** Pesanan & reservasi terbaru, diperbarui berkala selama aplikasi terbuka. */
export function useActivity(): { data: Activity | undefined; error: string | undefined; loading: boolean; reload: () => Promise<void> } {
  const st = useApp();
  const r = useRemote('activity', loadActivity, { maxAge: 20_000, poll: 30_000 });
  const sig = sigOf(st);
  useEffect(() => {
    // Pesanan/reservasi baru di perangkat, masuk/keluar akun: muat ulang.
    if (loadedSig !== null && sigOf(getState()) !== loadedSig) void refreshActivity();
  }, [sig]);
  return r;
}
