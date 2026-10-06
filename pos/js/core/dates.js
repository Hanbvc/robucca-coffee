/* =========================================================
   Waktu per cabang (zona WIB/WITA/WIT) & hari bisnis.
   Semua waktu disimpan sebagai epoch ms (UTC); tanggal bisnis 'YYYY-MM-DD'
   dihitung di zona waktu cabang saat transaksi terjadi.
   ========================================================= */

export const TZS = [
  { id: 'Asia/Jakarta', label: 'WIB' },
  { id: 'Asia/Makassar', label: 'WITA' },
  { id: 'Asia/Jayapura', label: 'WIT' },
];
export const tzLabel = (tz) => (TZS.find((t) => t.id === tz) || { label: tz }).label;

export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const DAYS_S = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Bagian tanggal/jam di zona `tz` → { y, m (1-12), d, H, M, S } */
export function parts(ts, tz = 'Asia/Jakarta') {
  const p = {};
  fmt(tz).formatToParts(new Date(ts)).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute, S: +p.second };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const ymdOf = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

/** Tanggal bisnis: hari berganti pada jam `dayStart` (0 = tengah malam). */
export function bizDate(ts, tz = 'Asia/Jakarta', dayStart = 0) {
  return ymdOf(parts(ts - (Number(dayStart) || 0) * 3600e3, tz));
}
export const bizHour = (ts, tz = 'Asia/Jakarta') => parts(ts, tz).H;

/** Operasi tanggal 'YYYY-MM-DD' (tanpa zona; dihitung di UTC agar aman dari DST) */
export function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dayDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export function daysBetween(from, to) {
  const out = []; let s = from; let guard = 0;
  while (s <= to && guard++ < 3700) { out.push(s); s = addDays(s, 1); }
  return out;
}

/** Epoch ms untuk jam lokal cabang (mis. awal hari bisnis) */
export function zonedEpoch(dateStr, timeStr, tz = 'Asia/Jakarta') {
  const [y, m, d] = dateStr.split('-').map(Number); const [H, M] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  const p = parts(guess, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M);
  return guess - (asUtc - guess);
}

/* ---------- Rentang tanggal untuk laporan ---------- */
export const PRESETS = [
  ['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7d', '7 hari'], ['30d', '30 hari'], ['month', 'Bulan ini'], ['lastmonth', 'Bulan lalu'],
];
export function presetRange(key, today) {
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d }; }
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastmonth': {
      const first = `${y}-${pad(m)}-01`; const lastPrev = addDays(first, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    default: return { from: today, to: today };
  }
}
/** Periode pembanding dengan panjang sama tepat sebelum rentang */
export function prevRange({ from, to }) {
  const n = dayDiff(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/* ---------- Format tampilan ---------- */
export function dateLabel(s, long = false) {
  const [y, m, d] = s.split('-').map(Number); const w = dow(s);
  return long ? `${DAYS[w]}, ${d} ${MONTHS[m - 1]} ${y}` : `${DAYS_S[w]}, ${d} ${MONTHS_S[m - 1]}`;
}
export const dateShort = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS_S[m - 1]}`; };
export function rangeLabel({ from, to }) {
  if (from === to) return dateLabel(from, true);
  const [y1] = from.split('-'); const [y2] = to.split('-');
  return `${dateShort(from)}${y1 !== y2 ? ' ' + y1 : ''} – ${dateShort(to)} ${y2}`;
}
export const clock = (ts, tz) => { const p = parts(ts, tz); return `${pad(p.H)}.${pad(p.M)}`; };
export const dateTime = (ts, tz) => { const p = parts(ts, tz); return `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.H)}.${pad(p.M)}`; };
/** "5 mnt", "1 j 20 mnt" */
export function ago(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} mnt`;
  return `${Math.floor(m / 60)} j ${m % 60} mnt`;
}
