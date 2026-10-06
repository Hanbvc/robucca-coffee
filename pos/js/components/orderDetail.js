/* Detail transaksi + aksi (cetak ulang, WhatsApp, void, refund) — dipakai Riwayat & Kantor. */
import { S, master, settings } from '../state.js';
import { $, esc, icon, toast, promptBox, confirmBox } from '../lib/ui.js';
import { rp } from '../core/money.js';
import { dateTime } from '../core/dates.js';
import { receiptHTML, printReceipt, receiptText, printHTML, ticketHTML } from './receipt.js';
import { requireApproval } from './approve.js';
import { voidOrder, refundOrder } from '../ops.js';

export const STATUS = {
  open: ['Belum dibayar', 'amber'], paid: ['Lunas', 'green'], void: ['Dibatalkan', 'red'], refunded: ['Direfund', 'blue'],
};
export const statusTag = (o) => (o.kind === 'refund' ? '<span class="tag blue">Refund</span>' : `<span class="tag ${STATUS[o.status][1]}">${STATUS[o.status][0]}</span>`);

/** Boleh void: tagihan terbuka, atau lunas dalam shift yang masih berjalan di perangkat ini */
export const canVoid = (o) => o.kind === 'sale' && (o.status === 'open' || (o.status === 'paid' && S.shift && o.shiftId === S.shift.id));
export const canRefund = (o) => o.kind === 'sale' && o.status === 'paid' && !canVoid(o);

export function detailHTML(o) {
  const b = master().branch[o.branchId];
  const tz = (b && b.tz) || 'Asia/Jakarta';
  const info = [];
  if (o.status === 'void') info.push(`Dibatalkan ${dateTime(o.voidAt, tz)} oleh ${esc(o.voidByName || '-')} — “${esc(o.voidReason || '')}”`);
  if (o.status === 'refunded') info.push(`Direfund ${dateTime(o.refundAt, tz)} oleh ${esc(o.refundByName || '-')} — “${esc(o.refundReason || '')}”`);
  if (o.kind === 'refund') info.push(`Refund untuk ${esc(o.refNumber || '')} — “${esc(o.reason || '')}”`);
  if (o.discount && o.discount.approvedByName) info.push(`Diskon disetujui ${esc(o.discount.approvedByName)}`);
  const voided = o.lines.filter((l) => l.voided);
  if (voided.length) info.push(`Item dibatalkan: ${voided.map((l) => `${l.qty}x ${esc(l.name)} (${esc(l.voidByName || '')}: ${esc(l.voidReason || '')})`).join(', ')}`);
  return `<div class="row wrap" style="margin-bottom:12px">${statusTag(o)}<span class="tag">${esc(o.channelName || o.channel)}</span>${b ? `<span class="tag">${esc(b.name)}</span>` : ''}<span class="tag">T${o.terminalNo || '-'}</span>${o.demo ? '<span class="tag amber">Data contoh</span>' : ''}</div>
    ${info.length ? `<div class="note ${o.status === 'void' ? 'red' : 'blue'}" style="margin-bottom:12px">${icon('info', 'sm')}<div>${info.join('<br>')}</div></div>` : ''}
    <div class="receipt">${receiptHTML(o, { branch: b, settings: settings() })}</div>`;
}

export function actionsHTML(o) {
  return `<button class="btn ghost" data-od="print">${icon('printer', 'sm')} Cetak ulang</button>
    <button class="btn ghost" data-od="wa">${icon('chat', 'sm')} WhatsApp</button>
    ${o.lines.some((l) => l.kAt) && o.status !== 'void' && o.kind === 'sale' ? `<button class="btn ghost" data-od="ticket">${icon('chef', 'sm')} Tiket dapur</button>` : ''}
    ${canVoid(o) ? `<button class="btn danger ghost" data-od="void">${icon('x-circle', 'sm')} Void</button>` : ''}
    ${canRefund(o) ? `<button class="btn danger ghost" data-od="refund">${icon('undo', 'sm')} Refund</button>` : ''}`;
}

/** Jalankan aksi; kembalikan true bila data berubah */
export async function runAction(act, o) {
  const b = master().branch[o.branchId];
  const opts = { branch: b, settings: settings() };
  if (act === 'print') { printReceipt(o, { ...opts, reprint: true }); return false; }
  if (act === 'ticket') { printHTML(ticketHTML(o, o.lines.filter((l) => l.kAt && !l.voided), { branch: b }), { paper: b.paper, title: o.number }); return false; }
  if (act === 'wa') {
    const ph = await promptBox({ title: 'Kirim struk ke WhatsApp', label: 'Nomor WhatsApp pelanggan', placeholder: '08xxxxxxxxxx', type: 'tel', ok: 'Buka WhatsApp' });
    if (!ph) return false;
    const n = ph.replace(/\D/g, '').replace(/^0/, '62');
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(receiptText(o, opts))}`, '_blank', 'noopener');
    return false;
  }
  if (act === 'void') {
    const who = await requireApproval({ title: 'Void transaksi', text: `${esc(o.number)} · ${rp(o.totals.total)}${o.status === 'paid' ? ' — uang dikembalikan ke pelanggan dari laci/metode yang sama.' : ''}`, branchId: o.branchId });
    if (!who) return false;
    const reason = await promptBox({ title: 'Alasan void', presets: ['Pelanggan batal', 'Salah input', 'Salah metode bayar', 'Transaksi ganda'], ok: 'Void transaksi', danger: true });
    if (!reason) return false;
    await voidOrder(o, { reason, approver: who });
    toast('Transaksi dibatalkan', 'warn');
    return true;
  }
  if (act === 'refund') {
    const who = await requireApproval({ title: 'Refund transaksi', text: `${esc(o.number)} · ${rp(o.totals.total)}`, branchId: o.branchId });
    if (!who) return false;
    const cash = (o.payments || []).some((p) => p.type === 'cash');
    const shift = S.shift && S.shift.branchId === o.branchId ? S.shift : null;
    if (cash && !shift && !(await confirmBox({ title: 'Refund tunai tanpa shift', text: 'Tidak ada shift kasir terbuka di perangkat ini, jadi refund tunai tidak mengurangi kas laci mana pun. Lanjutkan?', ok: 'Lanjutkan' }))) return false;
    const reason = await promptBox({ title: 'Alasan refund', presets: ['Komplain kualitas', 'Pesanan salah', 'Pesanan tidak datang'], ok: 'Refund', danger: true });
    if (!reason) return false;
    await refundOrder(o, { reason, approver: who, shift });
    toast(`Refund ${rp(o.totals.total)} dicatat`, 'warn');
    return true;
  }
  return false;
}

export function wireActions(container, getOrder, after) {
  container.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-od]'); if (!x) return;
    const o = getOrder(); if (!o) return;
    try {
      if (await runAction(x.dataset.od, o)) after();
    } catch (err) { toast(err.message || 'Gagal', 'err'); }
  });
}
export { $ };
