/* Waktu per cabang (WIB/WITA/WIT) & hari bisnis. Waktu disimpan UTC; tanggal bisnis 'YYYY-MM-DD'
   dihitung di zona waktu cabang dengan jam pergantian hari (dayStartMinute). Port dari pos/js/core/dates.js. */

export const TIMEZONES = [
  { id: 'Asia/Jakarta', label: 'WIB' },
  { id: 'Asia/Makassar', label: 'WITA' },
  { id: 'Asia/Jayapura', label: 'WIT' },
] as const;
export const tzLabel = (tz: string): string => TIMEZONES.find((t) => t.id === tz)?.label ?? tz;

export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;
export const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const;
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

export interface DateParts {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Bagian tanggal/jam di zona `tz`. */
export function parts(ts: number, tz = 'Asia/Jakarta'): DateParts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year!, m: +p.month!, d: +p.day!, H: +p.hour! % 24, M: +p.minute!, S: +p.second! };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
export const ymdOf = (p: Pick<DateParts, 'y' | 'm' | 'd'>): string => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

/** Tanggal bisnis: hari berganti pada `dayStartMinute` menit setelah 00:00 waktu cabang. */
export function businessDate(ts: number, tz = 'Asia/Jakarta', dayStartMinute = 0): string {
  return ymdOf(parts(ts - (Number(dayStartMinute) || 0) * 60e3, tz));
}
export const businessHour = (ts: number, tz = 'Asia/Jakarta'): number => parts(ts, tz).H;

const ymd = (s: string): [number, number, number] => s.split('-').map(Number) as [number, number, number];

/** Operasi tanggal 'YYYY-MM-DD' (dihitung di UTC). */
export function addDays(s: string, n: number): string {
  const [y, m, d] = ymd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = ymd(a);
  const [y2, m2, d2] = ymd(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export const dow = (s: string): number => {
  const [y, m, d] = ymd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let s = from;
  let guard = 0;
  while (s <= to && guard++ < 3700) {
    out.push(s);
    s = addDays(s, 1);
  }
  return out;
}

/** Epoch ms untuk jam lokal cabang. */
export function zonedEpoch(dateStr: string, timeStr = '00:00', tz = 'Asia/Jakarta'): number {
  const [y, m, d] = ymd(dateStr);
  const [H, M] = timeStr.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, H, M);
  const p = parts(guess, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M);
  return guess - (asUtc - guess);
}

// --- Rentang laporan ----------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

export const PRESETS = [
  ['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7d', '7 hari'], ['30d', '30 hari'], ['month', 'Bulan ini'], ['lastmonth', 'Bulan lalu'],
] as const;
export type PresetKey = (typeof PRESETS)[number][0];

export function presetRange(key: PresetKey, today: string): DateRange {
  const [y, m] = ymd(today);
  switch (key) {
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastmonth': {
      const lastPrev = addDays(`${y}-${pad(m)}-01`, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    default: return { from: today, to: today };
  }
}

/** Periode pembanding dengan panjang sama tepat sebelum rentang. */
export function prevRange({ from, to }: DateRange): DateRange {
  const n = dayDiff(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

// --- Format tampilan --------------------------------------------------------------------

export function dateLabel(s: string, long = false): string {
  const [y, m, d] = ymd(s);
  const w = dow(s);
  return long ? `${DAYS[w]}, ${d} ${MONTHS[m - 1]} ${y}` : `${DAYS_SHORT[w]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}
export const dateShort = (s: string): string => {
  const [, m, d] = ymd(s);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
};
export function rangeLabel({ from, to }: DateRange): string {
  if (from === to) return dateLabel(from, true);
  const y1 = from.slice(0, 4);
  const y2 = to.slice(0, 4);
  return `${dateShort(from)}${y1 !== y2 ? ' ' + y1 : ''} – ${dateShort(to)} ${y2}`;
}
export const clock = (ts: number, tz?: string): string => {
  const p = parts(ts, tz);
  return `${pad(p.H)}.${pad(p.M)}`;
};
export const dateTime = (ts: number, tz?: string): string => {
  const p = parts(ts, tz);
  return `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.H)}.${pad(p.M)}`;
};
/** "5 mnt", "1 j 20 mnt" */
export function ago(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} mnt`;
  return `${Math.floor(m / 60)} j ${m % 60} mnt`;
}
