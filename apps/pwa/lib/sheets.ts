/* Lembar bawah (bottom sheet) bertumpuk yang terhubung dengan tombol Back:
   membuka = satu entri riwayat baru (URL tetap), Back/geser ke bawah/Escape = menutup lembar teratas. Port dari js/app.js. */
import { useSyncExternalStore, type ReactNode } from 'react';

export interface SheetOpts {
  /** Hampir setinggi layar (cari menu, alamat). */
  full?: boolean;
  /** Pegangan putih di atas foto. */
  handleOnImg?: boolean;
  onClose?: () => void;
}

export interface SheetEntry {
  id: number;
  node: ReactNode;
  opts: SheetOpts;
  closing: boolean;
}

let stack: SheetEntry[] = [];
const EMPTY: SheetEntry[] = [];
let seq = 0;
let afterClose: (() => void) | null = null;
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());

const live = (): SheetEntry[] => stack.filter((e) => !e.closing);
export const sheetOpen = (): boolean => live().length > 0;

function lock(on: boolean): void {
  document.documentElement.classList.toggle('lock', on);
  document.body.classList.toggle('lock', on);
}

export function openSheet(node: ReactNode, opts: SheetOpts = {}): number {
  const id = ++seq;
  stack = [...stack, { id, node, opts, closing: false }];
  history.pushState({ rbSheet: id }, '');
  lock(true);
  emit();
  return id;
}

/** Tutup lembar teratas (lewat history.back agar riwayat tetap rapi), lalu jalankan `after`. */
export function closeSheet(after?: () => void): void {
  if (!sheetOpen()) {
    after?.();
    return;
  }
  afterClose = after ?? null;
  history.back();
}

function dropTop(): void {
  const top = live().at(-1);
  if (!top) return;
  stack = stack.map((e) => (e.id === top.id ? { ...e, closing: true } : e));
  if (!sheetOpen()) lock(false);
  emit();
  top.opts.onClose?.();
  setTimeout(() => {
    stack = stack.filter((e) => e.id !== top.id);
    emit();
  }, 400);
}

let installed = false;
/** Dipasang sekali oleh Shell. */
export function installSheetHistory(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', () => {
    if (!sheetOpen()) return;
    dropTop();
    const fn = afterClose;
    afterClose = null;
    if (fn) setTimeout(fn, 30);
  });
}

/** Tutup semua lembar tanpa riwayat (mis. saat pindah halaman lewat tautan di dalam lembar). */
export function closeAllSilently(): void {
  if (!sheetOpen()) return;
  for (const e of live()) e.opts.onClose?.();
  stack = stack.map((e) => ({ ...e, closing: true }));
  lock(false);
  emit();
  setTimeout(() => {
    stack = stack.filter((e) => !e.closing);
    emit();
  }, 400);
}

export const useSheets = (): SheetEntry[] =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => stack,
    () => EMPTY,
  );
