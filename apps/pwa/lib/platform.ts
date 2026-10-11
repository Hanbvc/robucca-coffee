/* Perilaku perangkat: iPhone, getar, keyboard iOS, salin, kalender, tautan peta & WhatsApp. Port dari js/app.js. */
import { normalizePhone } from '@robucca/core';
import type { Branch } from './types';

export const isIOS = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.platform) || /iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1));

export const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  ((navigator as Navigator & { standalone?: boolean }).standalone === true || (!!window.matchMedia && matchMedia('(display-mode: standalone)').matches));

/** Getar singkat: Android lewat Vibration API, iPhone (iOS 18+) lewat toggle <input switch> tersembunyi. */
export function haptic(): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(8);
      return;
    }
    if (!isIOS()) return;
    const l = document.createElement('label');
    l.setAttribute('aria-hidden', 'true');
    l.style.display = 'none';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.setAttribute('switch', '');
    l.appendChild(i);
    document.head.appendChild(l);
    l.click();
    l.remove();
  } catch {
    /* noop */
  }
}

/** iOS hanya membuka keyboard bila fokus terjadi di dalam gestur sentuh: fokuskan input sementara sekarang. */
export function primeKeyboard(): HTMLInputElement | null {
  if (!isIOS()) return null;
  const t = document.createElement('input');
  t.setAttribute('aria-hidden', 'true');
  t.tabIndex = -1;
  t.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;';
  document.body.appendChild(t);
  try {
    t.focus({ preventScroll: true });
  } catch {
    t.focus();
  }
  return t;
}

export function focusLater(inp: HTMLElement | null, prime: HTMLElement | null, ms = 360): void {
  setTimeout(() => {
    if (inp) {
      try {
        inp.focus({ preventScroll: true });
      } catch {
        inp.focus();
      }
    }
    prime?.remove();
  }, ms);
}

/** Salin teks; fallback untuk http / Safari lama. true bila berhasil. */
export async function copyText(v: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(v);
      return true;
    } catch {
      /* lanjut ke cara lama */
    }
  }
  const ta = document.createElement('textarea');
  ta.value = v;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;opacity:0;font-size:16px';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, v.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    /* noop */
  }
  ta.remove();
  return ok;
}

/** Berkas kalender (.ics) dengan pengingat 1 jam sebelumnya. */
export function downloadICS(o: { uid: string; start: number; minutes: number; title: string; location: string; description: string; alarm: string; file: string; domain: string }): void {
  const f = (t: number): string => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${o.domain}//reservasi//ID`, 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${o.uid}@${o.domain}`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(o.start)}`, `DTEND:${f(o.start + o.minutes * 60e3)}`,
    `SUMMARY:${esc(o.title)}`, `LOCATION:${esc(o.location)}`, `DESCRIPTION:${esc(o.description)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.alarm)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  if (isIOS()) {
    // Safari iOS menampilkan lembar "Tambah ke Kalender" untuk data text/calendar.
    const data = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(body);
    if (isStandalone()) window.open(data, '_blank');
    else window.location.href = data;
    return;
  }
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = o.file;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --- Tautan ------------------------------------------------------------------------

/** Nomor WhatsApp cabang (62…) atau null bila bukan nomor seluler. */
export const waNumber = (b: Pick<Branch, 'phone'> | null | undefined): string | null => (b?.phone ? normalizePhone(b.phone) : null);
/** 62812… → 0812… untuk ditampilkan / diisi ke formulir. */
export const localPhone = (phone62: string): string => (phone62.startsWith('62') ? `0${phone62.slice(2)}` : phone62);
export const waLink = (phone62: string, text?: string): string =>`https://wa.me/${phone62}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const telLink = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

export const gmapsLink = (lat: number, lng: number): string => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const mapEmbed = (q: string, z = 16): string => `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=${z}&output=embed`;

/** Tautan Google Maps & peta sematan untuk cabang (titik koordinat, atau alamat bila belum ada titik). */
export function branchMaps(b: Branch): { url: string; embed: string; ll: string | null } {
  if (b.lat != null && b.lng != null) return { url: gmapsLink(b.lat, b.lng), embed: mapEmbed(`${b.lat},${b.lng}`, 17), ll: `${b.lat},${b.lng}` };
  const q = `Robucca ${b.name}${b.address ? `, ${b.address}` : ''}`;
  return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, embed: mapEmbed(q), ll: null };
}

/** "@robucca.id" / "robucca.id" / URL → URL profil. */
export function socialUrl(kind: 'instagram' | 'tiktok', v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^https?:\/\//.test(s)) return s;
  const h = s.replace(/^@/, '');
  if (!h) return null;
  return kind === 'instagram' ? `https://www.instagram.com/${h}/` : `https://www.tiktok.com/@${h}`;
}
export const handleOf = (v: string | null | undefined): string => {
  if (!v) return '';
  const s = v.trim();
  const m = /(?:instagram\.com|tiktok\.com)\/@?([^/?#]+)/.exec(s);
  return `@${(m?.[1] ?? s).replace(/^@/, '')}`;
};

/** Alamat singkat untuk kartu: bagian pertama yang bermakna (bukan "Blok …"). */
export function shortAddress(a: string | null | undefined, max = 46): string {
  if (!a) return '';
  const t = a.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Kota dari alamat ("Kota Malang" → "Malang") untuk mempersempit pencarian alamat di peta. */
export function cityOf(a: string | null | undefined): string {
  const m = /(?:Kota|Kabupaten|Kab\.)\s+([A-Za-z ]+?)(?:,|\s+\d|$)/.exec(a ?? '');
  return m ? m[1]!.trim() : '';
}
