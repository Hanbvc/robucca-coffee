/* Event sederhana + siaran antar-tab (BroadcastChannel) agar layar Kasir, Dapur, dan Antrean
   yang terbuka di tab berbeda pada perangkat yang sama ikut diperbarui. */
import { useEffect, useReducer, useRef } from 'react';

export type BusType =
  | 'orders' | 'kitchen' | 'shifts' | 'cashMoves' | 'audit' | 'master' | 'sync' | 'net' | 'revoked' | 'app' | 'soldout';
export type BusData = Record<string, unknown> & { remote?: boolean };
type Handler = (data: BusData) => void;

const handlers = new Map<string, Set<Handler>>();
let chan: BroadcastChannel | null = null;
try {
  chan = new BroadcastChannel('robucca-pos');
} catch {
  chan = null;
}

function fire(type: string, data: BusData): void {
  for (const fn of handlers.get(type) ?? []) {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  }
}

if (chan) {
  chan.onmessage = (e: MessageEvent<{ type?: string; data?: BusData }>) => {
    if (e.data?.type) fire(e.data.type, { ...(e.data.data ?? {}), remote: true });
  };
}

export const bus = {
  on(type: BusType, fn: Handler): () => void {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  },
  /** Kirim ke tab ini dan (bila `share`) ke tab lain. */
  emit(type: BusType, data: BusData = {}, share = true): void {
    fire(type, data);
    if (share && chan) {
      try {
        chan.postMessage({ type, data });
      } catch {
        /* data tidak bisa diklon */
      }
    }
  },
};

/** Panggil handler setiap ada event (handler terbaru selalu dipakai). */
export function useBus(types: BusType[], fn: Handler): void {
  const ref = useRef(fn);
  ref.current = fn;
  const key = types.join(',');
  useEffect(() => {
    const offs = key.split(',').map((t) => bus.on(t as BusType, (d) => ref.current(d)));
    return () => offs.forEach((f) => f());
  }, [key]);
}

/** Render ulang komponen setiap ada event. */
export function useBusTick(types: BusType[]): number {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useBus(types, () => bump());
  return n;
}
