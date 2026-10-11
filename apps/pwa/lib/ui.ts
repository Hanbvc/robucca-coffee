/* Umpan balik singkat: toast, layar "memproses", animasi masuk keranjang. Port dari js/app.js. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { asset } from './env';

type Listener = () => void;
function tiny<T>(initial: T) {
  let v = initial;
  const subs = new Set<Listener>();
  return {
    get: () => v,
    set: (n: T) => {
      v = n;
      subs.forEach((f) => f());
    },
    sub: (f: Listener) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export interface ToastState {
  msg: string;
  icon: string;
  on: boolean;
  n: number;
}
const toastS = tiny<ToastState>({ msg: '', icon: 'check', on: false, n: 0 });
let toastT: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, icon = 'check'): void {
  clearTimeout(toastT);
  toastS.set({ msg, icon, on: true, n: toastS.get().n + 1 });
  toastT = setTimeout(() => toastS.set({ ...toastS.get(), on: false }), 2300);
}
export const useToast = (): ToastState => useSyncExternalStore(toastS.sub, toastS.get, toastS.get);

const procS = tiny<string | null>(null);
/** Tampilkan layar "memproses" sampai fungsi yang dikembalikan dipanggil. */
export function processing(text: string): () => void {
  procS.set(text);
  return () => {
    if (procS.get() === text) procS.set(null);
  };
}
export const useProcessing = (): string | null => useSyncExternalStore(procS.sub, procS.get, () => null);

/** Getar kecil pada bar keranjang. */
export function bump(): void {
  const bar = document.getElementById('cartbar');
  if (!bar || bar.hidden) return;
  bar.classList.remove('bump');
  void bar.offsetWidth;
  bar.classList.add('bump');
}

/** Foto menu "terbang" ke ikon keranjang. */
export function fly(fromEl: Element | null, img: string | null): void {
  const bar = document.getElementById('cartbar');
  const target = bar?.querySelector('.cb-ico');
  if (!fromEl || !bar || bar.hidden || !target) {
    bump();
    return;
  }
  const a = fromEl.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'fly';
  if (img) {
    const i = document.createElement('img');
    i.src = asset(img);
    i.alt = '';
    f.append(i);
  } else f.style.background = 'var(--ink)';
  document.body.append(f);
  const x0 = a.left + a.width / 2 - 27;
  const y0 = a.top + a.height / 2 - 27;
  const x1 = b.left + b.width / 2 - 27;
  const y1 = b.top + b.height / 2 - 27;
  if (!f.animate) {
    f.remove();
    bump();
    return;
  }
  const anim = f.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(.9)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 60}px) scale(.75)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x1}px, ${y1}px) scale(.25)`, opacity: 0.4 },
    ],
    { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' },
  );
  anim.onfinish = () => {
    f.remove();
    bump();
  };
}

/** Gambar ulang setiap `ms` (jadwal ambil & status buka/tutup mengikuti jam). */
export function useTick(ms: number): void {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
