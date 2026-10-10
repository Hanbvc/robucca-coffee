/* Modul kantor: klien API /office/* (selalu online), filter periode & cabang bersama, dan tipe respons.
   Sesi memakai sesi server staf yang login di perangkat ini (X-Device-Token + X-Session, lib/api.ts). */
import { presetRange, rangeLabel, type DateRange, type PresetKey } from '@robucca/core';
import { useEffect, useState } from 'react';
import { ApiError, isOffline } from '../lib/api';
import { ss } from '../lib/store';
import { S } from '../state';
import { download } from '../ui/overlay';

/* =========================================================
   Galat khusus kantor
   ========================================================= */
/** Sesi server habis dan PIN tidak ada di memori → minta PIN lagi. */
export class NeedPinError extends Error {
  constructor() {
    super('Verifikasi PIN ke server pusat');
  }
}

export const errText = (e: unknown): string =>
  isOffline(e) ? 'Tidak terhubung ke server pusat. Data kantor perlu koneksi internet.' : e instanceof Error ? e.message : String(e);

/* =========================================================
   Panggilan API
   ========================================================= */
async function ensure(): Promise<void> {
  const api = S.be.api;
  if (!api) throw new Error('Kantor hanya tersedia bila perangkat terhubung ke server pusat.');
  if (!api.session && !(await S.be.ensureSession())) throw new NeedPinError();
}

/** Panggil /office/* dengan sesi staf; sesi kedaluwarsa dibuat ulang sekali dari PIN di memori. */
export async function oc<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  await ensure();
  const api = S.be.api!;
  try {
    return await api.call<T>(method, path, body, { session: true, timeout: 30000 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && /sesi|masuk/i.test(e.message)) {
      api.session = null;
      if (!(await S.be.ensureSession())) throw new NeedPinError();
      return api.call<T>(method, path, body, { session: true, timeout: 30000 });
    }
    throw e;
  }
}
export const oget = <T = unknown>(path: string) => oc<T>('GET', path);

/** Unduh CSV dari server (format=csv). */
export async function csv(path: string, filename: string): Promise<void> {
  const text = await oc<string>('GET', path + (path.includes('?') ? '&' : '?') + 'format=csv');
  download(`${filename}.csv`, String(text ?? '').replace(/^﻿/, ''));
}

export const qs = (o: Record<string, string | number | boolean | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/* =========================================================
   Konteks kantor: staf & cabang yang boleh dilihat (GET /office/me)
   ========================================================= */
export interface OBranch {
  id: string;
  code: string;
  name: string;
  timezone: string;
  dayStartMinute: number;
  isActive: boolean;
}
export interface OfficeMe {
  staff: { id: string; name: string; role: string; permissions: string[]; branchIds: string[] | null };
  allBranches: boolean;
  branches: OBranch[];
  device: { id: string; branchId: string | null } | null;
}

let meCache: OfficeMe | null = null;
export const me = (): OfficeMe => meCache!;
export async function loadMe(force = false): Promise<OfficeMe> {
  if (meCache && !force && meCache.staff.id === S.user?.id) return meCache;
  meCache = await oget<OfficeMe>('/office/me');
  return meCache;
}
export const branchOf = (id: string | null | undefined): OBranch | undefined => meCache?.branches.find((b) => b.id === id);
export const branchName = (id: string | null | undefined): string => (id ? (branchOf(id)?.name ?? '—') : 'Pusat');
export const tzOf = (id: string | null | undefined): string => branchOf(id)?.timezone ?? S.be.tz;
export const activeBranches = (): OBranch[] => (meCache?.branches ?? []).filter((b) => b.isActive);
/** Cabang awal untuk halaman per cabang (menu, stok): cabang perangkat bila boleh, lalu cabang pertama. */
export function defaultBranch(key: string): string {
  const list = activeBranches();
  const saved = ss.get<string | null>(key, null);
  if (saved && list.some((b) => b.id === saved)) return saved;
  const dev = S.be.device?.branchId;
  if (dev && list.some((b) => b.id === dev)) return dev;
  return list[0]?.id ?? '';
}

/* =========================================================
   Filter periode & cabang (bertahan selama tab terbuka)
   ========================================================= */
export interface Filter {
  preset: PresetKey | 'custom';
  from: string;
  to: string;
  branch: string; // 'all' atau id cabang
}
const KEY = 'pos:office:filter';
let F: Filter = { preset: '7d', from: '', to: '', branch: 'all', ...ss.get<Partial<Filter>>(KEY, {}) };
const subs = new Set<() => void>();
export const filter = (): Filter => F;
export function setFilter(p: Partial<Filter>): void {
  F = { ...F, ...p };
  ss.set(KEY, F);
  subs.forEach((f) => f());
}
/** Render ulang saat filter berubah. */
export function useFilter(): Filter {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return F;
}
export const todayStr = (): string => S.be.today();
export function range(): DateRange {
  if (F.preset === 'custom' && F.from && F.to) return F.from <= F.to ? { from: F.from, to: F.to } : { from: F.to, to: F.from };
  return presetRange(F.preset === 'custom' ? '7d' : F.preset, todayStr());
}
/** Cabang terpilih (null = semua yang boleh dilihat). */
export function branchSel(): string | null {
  if (F.branch !== 'all' && activeBranches().some((b) => b.id === F.branch)) return F.branch;
  return null;
}
export const scopeLabel = (): string => {
  const b = branchSel();
  if (b) return branchName(b);
  const n = activeBranches().length;
  return me()?.allBranches ? 'Semua cabang' : n === 1 ? (activeBranches()[0]?.name ?? '') : `${n} cabang`;
};
/** Query periode + cabang untuk endpoint laporan. */
export const rangeQ = (extra: Record<string, string | number | boolean | null | undefined> = {}): string => {
  const r = range();
  return qs({ from: r.from, to: r.to, branchId: branchSel(), ...extra });
};
export const periodLabel = (): string => rangeLabel(range());
export const fileRange = (): string => {
  const r = range();
  return `${r.from}_${r.to}`;
};

/* =========================================================
   Format kecil
   ========================================================= */
export const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);
export const pct = (v: number, t: number): string => (t ? `${(Math.round((v / t) * 1000) / 10).toLocaleString('id-ID')}%` : '0%');
