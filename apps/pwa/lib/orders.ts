/* Status pesanan & reservasi untuk tampilan (judul, langkah linimasa) dan pesan WhatsApp. Port dari js/app.js lama. */
import { rp } from '@robucca/core';
import { gmapsLink } from './platform';
import { at, dateLong, dateShort, dot, stampLabel, TZ_DEFAULT, whenLabel } from './time';
import type { PublicOrder, Reservation } from './types';

export type Kind = 'pickup' | 'delivery' | 'preorder';
export const kindOf = (o: PublicOrder): Kind => (o.type === 'DELIVERY' ? 'delivery' : o.reservation ? 'preorder' : 'pickup');
export const KIND_LABEL: Record<Kind, string> = { pickup: 'Pick Up', delivery: 'Delivery', preorder: 'Pre-order' };
export const KIND_ICON: Record<Kind, string> = { pickup: 'bag', delivery: 'scooter', preorder: 'calendar' };

export interface Phase {
  /** -2 batal · -1 menunggu bayar · 0 diterima/terjadwal · 1 disiapkan · 2 siap/diantar · 3 selesai */
  step: -2 | -1 | 0 | 1 | 2 | 3;
  scheduled: boolean;
  title: string;
  sub: string;
}

export function phase(o: PublicOrder, tz = TZ_DEFAULT): Phase {
  const d = o.delivery;
  const k = kindOf(o);
  const code = o.number;
  switch (o.stage) {
    case 'cancelled':
      return { step: -2, scheduled: false, title: 'Pesanan dibatalkan', sub: 'Pesanan ini dibatalkan oleh kasir. Hubungi kami lewat WhatsApp bila ada pertanyaan.' };
    case 'awaiting_payment':
      return { step: -1, scheduled: false, title: 'Menunggu pembayaran', sub: 'Selesaikan pembayaran agar pesananmu segera kami siapkan.' };
    case 'scheduled':
      return k === 'preorder'
        ? { step: 0, scheduled: true, title: 'Pre-order terjadwal', sub: 'Pesananmu akan disiapkan menjelang jam reservasi.' }
        : { step: 0, scheduled: true, title: 'Pesanan terjadwal', sub: `Pesananmu akan disiapkan menjelang jam ambil (${o.pickupAt ? whenLabel(o.pickupAt, tz) : '-'}).` };
    case 'received':
      return { step: 0, scheduled: false, title: 'Pesanan diterima', sub: 'Barista kami sudah menerima pesananmu.' };
    case 'preparing':
      return d
        ? { step: 1, scheduled: false, title: 'Sedang disiapkan', sub: `Pesananmu sedang dibuat. Driver ${d.provider} dipesan begitu pesanan siap.` }
        : { step: 1, scheduled: false, title: 'Sedang disiapkan', sub: 'Pesananmu sedang dibuat dengan sepenuh hati.' };
    case 'ready':
      if (d) return { step: 1, scheduled: false, title: 'Menunggu driver', sub: `Pesananmu sudah siap dan menunggu driver ${d.provider}.` };
      return {
        step: 2, scheduled: false, title: k === 'preorder' ? 'Siap disajikan' : 'Siap diambil',
        sub: k === 'preorder' ? 'Pesananmu siap disajikan di mejamu.' : `Langsung ambil di counter pick-up tanpa antre. Sebutkan nama “${o.customerName ?? ''}” atau kode ${code}.`,
      };
    case 'on_delivery': {
      const who = d?.driverName ? `${d.driverName} (${d.courierName})` : `Driver ${d?.courierName ?? ''}`.trim();
      const eta = d?.estimatedAt ? ` Perkiraan tiba ${at(d.estimatedAt, tz).clock}.` : '';
      return { step: 2, scheduled: false, title: 'Sedang diantar', sub: `${who} sedang menuju alamatmu.${eta}` };
    }
    case 'completed':
    default:
      return d
        ? { step: 3, scheduled: false, title: 'Pesanan tiba', sub: 'Terima kasih sudah memesan di Robucca. Selamat menikmati!' }
        : { step: 3, scheduled: false, title: 'Selesai', sub: 'Terima kasih sudah mampir. Sampai jumpa lagi di Robucca.' };
  }
}

/** Masih berjalan (untuk "Sedang berjalan", kartu di beranda, dan titik di tab). */
export const isLive = (o: PublicOrder): boolean => {
  const s = phase(o).step;
  return s >= -1 && s < 3;
};

export function payLabel(o: PublicOrder): string {
  const p = o.payment;
  if (p.state === 'cashier') return 'Bayar di kasir';
  if (p.state === 'void') return 'Dibatalkan';
  return `${p.name} · ${p.state === 'paid' ? 'Lunas' : 'Menunggu konfirmasi kasir'}`;
}

export function pickupText(o: PublicOrder, tz = TZ_DEFAULT): string {
  if (!o.pickupAt) return 'Secepatnya';
  return whenLabel(o.pickupAt, tz);
}

/** Pesan WhatsApp ke cabang tentang pesanan (seperti tombol WhatsApp di prototipe). */
export function orderMsg(o: PublicOrder, tz = TZ_DEFAULT): string {
  const d = o.delivery;
  const k = kindOf(o);
  const type = d
    ? `Delivery · ${d.courierName} (±${kmLabel(d.distanceKm)})`
    : k === 'preorder'
      ? `Pre-order reservasi ${o.reservation?.code ?? ''}`
      : `Pick Up · ${pickupText(o, tz)}`;
  return [
    `Halo Robucca ${o.branch.name}, saya pesan lewat aplikasi:`, '',
    `*${o.number}*${o.queueNumber ? ` (antrean ${o.queueNumber})` : ''}`,
    `Tipe: ${type}`,
    `Nama: ${o.customerName ?? '-'}${o.customerPhone ? ' · ' + o.customerPhone : ''}`,
    ...(d ? [`Alamat: ${d.addressText}${d.addressNote ? ' (' + d.addressNote + ')' : ''}`, `Peta: ${gmapsLink(d.lat, d.lng)}`] : []),
    '',
    ...o.items.map((l) => `${l.quantity}x ${l.name}${l.summary ? ' (' + l.summary + ')' : ''}${l.note ? ' — "' + l.note + '"' : ''}`),
    '',
    ...(d ? [`Subtotal: ${rp(o.total - o.deliveryFee)}`, `Ongkir: ${rp(o.deliveryFee)}`] : []),
    `Total: ${rp(o.total)}`,
    `Pembayaran: ${payLabel(o)}`,
  ].join('\n');
}

export const kmLabel = (km: number): string => `${km.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`;

// --- Reservasi ------------------------------------------------------------------

export type RsvPhase = 'upcoming' | 'past' | 'cancelled';
export function rsvPhase(r: Reservation): RsvPhase {
  if (r.status === 'CANCELLED' || r.status === 'NO_SHOW') return 'cancelled';
  if (r.status === 'SEATED' || Date.parse(r.reservedFor) + 2 * 3600e3 < Date.now()) return 'past';
  return 'upcoming';
}

export function rsvTag(r: Reservation): { cls: string; text: string } {
  const p = rsvPhase(r);
  if (p === 'cancelled') return { cls: 'red', text: r.status === 'NO_SHOW' ? 'Tidak hadir' : 'Dibatalkan' };
  if (p === 'past') return { cls: '', text: 'Selesai' };
  return r.status === 'CONFIRMED' ? { cls: 'olive', text: 'Terkonfirmasi' } : { cls: 'warn', text: 'Menunggu konfirmasi' };
}

export function rsvWhen(r: Reservation): { ymd: string; time: string } {
  const a = at(r.reservedFor, r.branch.timezone);
  return { ymd: a.ymd, time: a.time };
}

export function rsvMsg(r: Reservation): string {
  const w = rsvWhen(r);
  return [
    `Halo Robucca ${r.branch.name}, saya ingin reservasi meja:`, '',
    `Kode: *${r.code}*`,
    `Nama: ${r.name}`,
    `Tanggal: ${dateLong(w.ymd)}`,
    `Jam: ${dot(w.time)} WIB`,
    `Jumlah tamu: ${r.guests} orang`,
    `Area: ${r.area ?? 'Bebas'}`,
    r.occasion ? `Acara: ${r.occasion}` : null,
    r.note ? `Catatan: ${r.note}` : null,
    '', 'Mohon konfirmasinya. Terima kasih!',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

export const rsvShort = (r: Reservation): string => {
  const w = rsvWhen(r);
  return `${dateShort(w.ymd)}, ${dot(w.time)}`;
};

export { stampLabel };
