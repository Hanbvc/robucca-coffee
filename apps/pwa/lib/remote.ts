/* Cache data server di memori (+ localStorage untuk katalog) dengan pola stale-while-revalidate:
   tampilkan data terakhir segera, perbarui di latar saat basi, saat aplikasi kembali dibuka, atau berkala. */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { errText } from './api';

interface Entry<T> {
  data?: T;
  error?: string;
  at: number;
  loading: boolean;
}

const entries = new Map<string, Entry<unknown>>();
const subs = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const PKEY = (k: string): string => `rbc:c:${k}`;

function notify(key: string): void {
  subs.get(key)?.forEach((f) => f());
}

function put(key: string, e: Entry<unknown>): void {
  entries.set(key, e);
  notify(key);
}

function hydrate(key: string, persist: boolean): Entry<unknown> | undefined {
  const cur = entries.get(key);
  if (cur || !persist || typeof window === 'undefined') return cur;
  try {
    const raw = localStorage.getItem(PKEY(key));
    if (raw) {
      const v = JSON.parse(raw) as { data: unknown; at: number };
      const e: Entry<unknown> = { data: v.data, at: v.at, loading: false };
      entries.set(key, e);
      return e;
    }
  } catch {
    /* noop */
  }
  return undefined;
}

export function fetchInto<T>(key: string, fetcher: () => Promise<T>, persist = false): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const prev = entries.get(key);
  put(key, { ...prev, at: prev?.at ?? 0, loading: true });
  const p = fetcher()
    .then((data) => {
      const at = Date.now();
      put(key, { data, at, loading: false });
      if (persist) {
        try {
          localStorage.setItem(PKEY(key), JSON.stringify({ data, at }));
        } catch {
          /* noop */
        }
      }
    })
    .catch((e: unknown) => {
      put(key, { data: prev?.data, at: prev?.at ?? 0, error: errText(e), loading: false });
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Muat ulang sekarang; bila sedang memuat, muat sekali lagi sesudahnya (data yang sedang dimuat mungkin sudah usang). */
export function refetch<T>(key: string, fetcher: () => Promise<T>, persist = false): Promise<void> {
  const running = inflight.get(key);
  return running ? running.then(() => fetchInto(key, fetcher, persist)) : fetchInto(key, fetcher, persist);
}

/** Ganti data di cache (mis. pesanan terbaru dari SSE / setelah aksi). */
export function mutate<T>(key: string, data: T): void {
  put(key, { data, at: Date.now(), loading: false });
}

export function peek<T>(key: string): T | undefined {
  return (entries.get(key) ?? hydrate(key, true))?.data as T | undefined;
}

/** Buang dari cache (mis. data akun saat keluar); yang sedang tampil memuat ulang dari kosong. */
export function forget(prefix: string): void {
  for (const k of [...entries.keys()]) {
    if (k.startsWith(prefix)) {
      entries.delete(k);
      notify(k);
    }
  }
}

/** Tandai basi; yang sedang tampil akan memuat ulang. */
export function invalidate(prefix: string): void {
  for (const [k, e] of entries) {
    if (k.startsWith(prefix)) {
      entries.set(k, { ...e, at: 0 });
      notify(k);
    }
  }
}

export interface Remote<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  /** Waktu data terakhir berhasil dimuat (0 = belum pernah). */
  at: number;
}

const NONE: Entry<never> = { at: 0, loading: false };

export function useRemote<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { maxAge = 30_000, persist = false, poll = 0 }: { maxAge?: number; persist?: boolean; poll?: number } = {},
): Remote<T> {
  const fref = useRef(fetcher);
  fref.current = fetcher;
  const subscribe = useCallback(
    (f: () => void) => {
      if (!key) return () => {};
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(f);
      return () => set.delete(f);
    },
    [key],
  );
  const e = useSyncExternalStore(
    subscribe,
    () => (key ? (hydrate(key, persist) ?? NONE) : NONE),
    () => NONE,
  ) as Entry<T>;

  const reload = useCallback(() => (key ? fetchInto(key, () => fref.current(), persist) : Promise.resolve()), [key, persist]);

  useEffect(() => {
    if (!key) return;
    const stale = (): boolean => {
      const cur = entries.get(key);
      return !cur || (!cur.loading && Date.now() - cur.at > maxAge);
    };
    if (stale()) void reload();
    const onWake = (): void => {
      if (document.visibilityState === 'visible' && stale()) void reload();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    const t = poll ? setInterval(() => document.visibilityState === 'visible' && void reload(), poll) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      if (t) clearInterval(t);
    };
  }, [key, maxAge, poll, reload, e.at]);

  return { data: e.data, error: e.error, loading: e.loading || (!!key && e.at === 0 && !e.error), reload, at: e.at };
}
