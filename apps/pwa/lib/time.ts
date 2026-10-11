/* Waktu per cabang (zona waktu cabang, bukan zona perangkat). Port dari helper waktu js/app.js lama. */
import { addDays, clock, dateLabel, DAYS_SHORT, MONTHS_SHORT, parts, ymdOf, zonedEpoch } from '@robucca/core';
import type { Branch } from './types';

export const TZ_DEFAULT = 'Asia/Jakarta';
export const PREP_MINUTES = 15;
/** Jam reservasi terakhir = tutup − 90 menit (sama dengan server). */
export const RSV_LAST_BEFORE_CLOSE = 90;

export const toMin = (s: string): number => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
export const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** "08:00" → "08.00" */
export const dot = (s: string | null | undefined): string => String(s ?? '').replace(':', '.');

export const openOf = (b: Pick<Branch, 'openTime'> | null | undefined): string => b?.openTime || '08:00';
export const closeOf = (b: Pick<Branch, 'closeTime'> | null | undefined): string => b?.closeTime || '21:00';

/** Tanggal (YYYY-MM-DD) & menit-dalam-hari sekarang di zona cabang. */
export function nowAt(tz = TZ_DEFAULT, ts = Date.now()): { ymd: string; min: number; dow: number } {
  const p = parts(ts, tz);
  return { ymd: ymdOf(p), min: p.H * 60 + p.M, dow: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() };
}

export function isOpen(b: Branch | null | undefined, ts = Date.now()): boolean {
  if (!b) return false;
  const { min } = nowAt(b.timezone, ts);
  return min >= toMin(openOf(b)) && min < toMin(closeOf(b));
}

export function greeting(tz = TZ_DEFAULT): string {
  const h = Math.floor(nowAt(tz).min / 60);
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

/** "Sen, 12 Okt" */
export const dateShort = (ymd: string): string => dateLabel(ymd);
/** "Senin, 12 Oktober 2026" */
export const dateLong = (ymd: string): string => dateLabel(ymd, true);

/** Waktu (ISO/epoch) → tanggal & jam di zona cabang. */
export function at(ts: string | number, tz = TZ_DEFAULT): { ymd: string; time: string; clock: string } {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  const p = parts(t, tz);
  const time = `${String(p.H).padStart(2, '0')}:${String(p.M).padStart(2, '0')}`;
  return { ymd: ymdOf(p), time, clock: clock(t, tz) };
}

/** "Hari ini, 10.30" / "Kemarin, 19.05" / "Sen, 12 Okt, 08.15" */
export function stampLabel(ts: string | number, tz = TZ_DEFAULT): string {
  const a = at(ts, tz);
  const today = nowAt(tz).ymd;
  const day = a.ymd === today ? 'Hari ini' : a.ymd === addDays(today, -1) ? 'Kemarin' : dateShort(a.ymd);
  return `${day}, ${a.clock}`;
}

/** Label waktu ambil: "Hari ini, 14.30" / "Besok, 09.00" / "Sen, 12 Okt, 09.00". */
export function whenLabel(ts: string | number, tz = TZ_DEFAULT): string {
  const a = at(ts, tz);
  const today = nowAt(tz).ymd;
  const day = a.ymd === today ? 'Hari ini' : a.ymd === addDays(today, 1) ? 'Besok' : dateShort(a.ymd);
  return `${day}, ${a.clock}`;
}

export interface Slot {
  /** 'asap' atau epoch ms */
  v: string;
  t: string;
  s: string;
}

/** Jadwal ambil Pick Up: secepatnya (bila buka), tiap 15 menit hari ini sampai tutup − 15, lalu besok bila sedikit. */
export function pickupSlots(b: Branch): Slot[] {
  const tz = b.timezone;
  const now = nowAt(tz);
  const open = toMin(openOf(b));
  const last = toMin(closeOf(b)) - 15;
  const out: Slot[] = [];
  if (isOpen(b) && now.min + PREP_MINUTES <= last) out.push({ v: 'asap', t: 'Secepatnya', s: `±${PREP_MINUTES} menit` });
  const start = Math.max(open + 15, Math.ceil((now.min + PREP_MINUTES + 10) / 15) * 15);
  for (let m = start; m <= last; m += 15) out.push({ v: String(zonedEpoch(now.ymd, hhmm(m), tz)), t: dot(hhmm(m)), s: 'Hari ini' });
  if (out.length < 4) {
    const tmr = addDays(now.ymd, 1);
    for (let m = open + 15; m <= Math.min(last, open + 15 * 16); m += 15) out.push({ v: String(zonedEpoch(tmr, hhmm(m), tz)), t: dot(hhmm(m)), s: 'Besok' });
  }
  return out;
}

export function pickupLabel(v: string, tz = TZ_DEFAULT): string {
  return v === 'asap' ? `Secepatnya (±${PREP_MINUTES} menit)` : whenLabel(Number(v), tz);
}

/** Jam reservasi tiap 30 menit dari buka sampai tutup − 90; hari ini minimal 60 menit dari sekarang. */
export function rsvSlots(b: Branch, date: string): { m: number; v: string; off: boolean }[] {
  const now = nowAt(b.timezone);
  const minOk = date === now.ymd ? now.min + 60 : 0;
  const out: { m: number; v: string; off: boolean }[] = [];
  for (let m = toMin(openOf(b)); m <= toMin(closeOf(b)) - RSV_LAST_BEFORE_CLOSE; m += 30) out.push({ m, v: hhmm(m), off: m < minOk });
  return out;
}

/** 14 tanggal terdekat (dalam 21 hari) yang masih punya jam kosong. */
export function rsvDates(b: Branch): string[] {
  const today = nowAt(b.timezone).ymd;
  const out: string[] = [];
  for (let i = 0; i < 21 && out.length < 14; i++) {
    const d = addDays(today, i);
    if (rsvSlots(b, d).some((s) => !s.off)) out.push(d);
  }
  return out;
}

export function dayParts(ymd: string): { d: number; mon: string; dow: string } {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { d, mon: MONTHS_SHORT[m - 1] ?? '', dow: DAYS_SHORT[w] ?? '' };
}

export { addDays, zonedEpoch };
