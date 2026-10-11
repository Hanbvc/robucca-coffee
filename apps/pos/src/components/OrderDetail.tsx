/* Detail transaksi + aksi (cetak ulang, WhatsApp, tiket dapur, void, refund, driver delivery) — dipakai Riwayat (dan Kantor nanti).
   Port dari pos/js/components/orderDetail.js. */
import { dateTime, rp } from '@robucca/core';
import type { Order } from '../data/types';
import { Icon } from '../lib/icons';
import { refundOrder, voidOrder } from '../ops';
import { S, branch, settings } from '../state';
import { confirmBox, promptBox, toast } from '../ui/overlay';
import { requireApproval } from './approve';
import { DeliveryInfo, DeliveryTag, deliveryStage, dispatchDialog } from './Delivery';
import { printHTML, printReceipt, receiptHTML, receiptText, ticketHTML } from './receipt';

export const STATUS: Record<string, [string, string]> = {
  DRAFT: ['Draf', ''],
  OPEN: ['Belum dibayar', 'amber'],
  AWAITING_PAYMENT: ['Menunggu bayar', 'amber'],
  PAID: ['Lunas', 'green'],
  VOIDED: ['Dibatalkan', 'red'],
  REFUNDED: ['Direfund', 'blue'],
};

export function StatusTag({ o }: { o: Order }) {
  const [label, cls] = STATUS[o.status] ?? [o.status, ''];
  return <span className={`tag ${cls}`}>{label}</span>;
}

/** Boleh void: tagihan terbuka, atau lunas dalam shift yang masih berjalan di perangkat ini. */
export const canVoid = (o: Order): boolean =>
  o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT' || (o.status === 'PAID' && !!S.shift && o.shiftId === S.shift.id);
export const canRefund = (o: Order): boolean => o.status === 'PAID' && !canVoid(o);

export function OrderDetail({ o }: { o: Order }) {
  const b = branch();
  const tz = b.timezone;
  const info: string[] = [];
  if (o.status === 'VOIDED') info.push(`Dibatalkan ${o.voidedAt ? dateTime(o.voidedAt, tz) : ''} oleh ${o.voidedByName || '-'} — “${o.voidReason || ''}”`);
  if (o.status === 'REFUNDED' && o.refund) info.push(`Direfund ${dateTime(o.refund.at, tz)}${o.refund.byName ? ` oleh ${o.refund.byName}` : ''} — ${rp(o.refund.amount)} “${o.refund.reason}”`);
  if (o.discount?.approvedByName) info.push(`Diskon disetujui ${o.discount.approvedByName}`);
  const voided = o.lines.filter((l) => l.voided);
  if (voided.length) info.push(`Item dibatalkan: ${voided.map((l) => `${l.qty}x ${l.name} (${l.voided!.byName}: ${l.voided!.reason})`).join(', ')}`);
  if (o.syncError) info.push(`Ditolak server: ${o.syncError}`);
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <StatusTag o={o} />
        <span className="tag">{o.channelName}</span>
        {o.source === 'PWA' && <span className="tag blue">Aplikasi</span>}
        <DeliveryTag o={o} />
        <span className="tag">{b.name}</span>
        <span className="tag">T{o.terminalNo ?? '-'}</span>
        {o.demo && <span className="tag amber">Data contoh</span>}
      </div>
      {info.length > 0 && (
        <div className={`note ${o.status === 'VOIDED' || o.syncError ? 'red' : 'blue'}`} style={{ marginBottom: 12 }}>
          <Icon name="info" size="sm" />
          <div>
            {info.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        </div>
      )}
      <DeliveryInfo o={o} />
      <div className="receipt" dangerouslySetInnerHTML={{ __html: receiptHTML(o, { branch: b, settings: settings() }) }} />
    </>
  );
}

/** Jalankan aksi; kembalikan true bila data berubah. */
export async function runAction(act: string, o: Order): Promise<boolean> {
  const b = branch();
  const opts = { branch: b, settings: settings() };
  if (act === 'print') {
    printReceipt(o, { ...opts, reprint: true });
    return false;
  }
  if (act === 'ticket') {
    printHTML(ticketHTML(o, o.lines.filter((l) => l.kAt && !l.voided), { branch: b }), { paper: b.receiptPaperMm, title: o.number });
    return false;
  }
  if (act === 'wa') {
    const ph = await promptBox({ title: 'Kirim struk ke WhatsApp', label: 'Nomor WhatsApp pelanggan', placeholder: '08xxxxxxxxxx', type: 'tel', ok: 'Buka WhatsApp', value: o.customerPhone });
    if (!ph) return false;
    const n = ph.replace(/\D/g, '').replace(/^0/, '62');
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(receiptText(o, opts))}`, '_blank', 'noopener');
    return false;
  }
  if (act === 'void') {
    const who = await requireApproval('void', {
      title: 'Void transaksi',
      text: `${o.number} · ${rp(o.totals.total)}${o.status === 'PAID' ? ' — uang dikembalikan ke pelanggan dari laci/metode yang sama.' : ''}`,
    });
    if (!who) return false;
    const reason = await promptBox({ title: 'Alasan void', presets: ['Pelanggan batal', 'Salah input', 'Salah metode bayar', 'Transaksi ganda'], ok: 'Void transaksi', danger: true });
    if (!reason) return false;
    const cur = (await S.be.get<Order>('orders', o.id)) ?? o;
    await voidOrder(cur, { reason, approval: who });
    toast('Transaksi dibatalkan', 'warn');
    return true;
  }
  if (act === 'refund') {
    const who = await requireApproval('refund', { title: 'Refund transaksi', text: `${o.number} · ${rp(o.totals.total)}` });
    if (!who) return false;
    const shift = S.shift && S.shift.branchId === o.branchId ? S.shift : null;
    if (
      !shift &&
      !(await confirmBox({
        title: 'Refund tanpa shift',
        text: 'Tidak ada shift kasir terbuka di perangkat ini, jadi refund tidak mengurangi kas laci mana pun. Lanjutkan?',
        ok: 'Lanjutkan',
      }))
    )
      return false;
    const reason = await promptBox({ title: 'Alasan refund', presets: ['Komplain kualitas', 'Pesanan salah', 'Pesanan tidak datang'], ok: 'Refund', danger: true, minLength: 3 });
    if (!reason) return false;
    await refundOrder(o, { reason, approval: who, shift });
    toast(`Refund ${rp(o.totals.total)} dicatat`, 'warn');
    return true;
  }
  if (act === 'dispatch') {
    const again = o.fulfillment === 'OUT_FOR_DELIVERY';
    if (!(await dispatchDialog(o))) return false;
    toast(again ? 'Data driver diperbarui' : 'Driver berangkat · pelanggan melihat "Sedang diantar"');
    return true;
  }
  if (act === 'delivered') {
    const ok = await confirmBox({
      title: 'Pesanan sudah tiba?',
      text: `${o.number} · ${o.delivery?.recipientName ?? ''}. Status di aplikasi pelanggan menjadi selesai.`,
      ok: 'Ya, sudah tiba',
    });
    if (!ok) return false;
    await S.be.delivered(o);
    toast('Pesanan delivery selesai');
    return true;
  }
  return false;
}

export function OrderActions({ o, after }: { o: Order; after: () => void }) {
  const run = async (act: string) => {
    try {
      if (await runAction(act, o)) after();
    } catch (err) {
      toast((err as Error).message || 'Gagal', 'err');
    }
  };
  const dlv = deliveryStage(o);
  return (
    <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
      {(dlv === 'prep' || dlv === 'ready' || dlv === 'out') && (
        <button className={`btn ${dlv === 'out' ? 'ghost' : ''}`} data-od="dispatch" onClick={() => void run('dispatch')}>
          <Icon name="scooter" size="sm" /> {dlv === 'out' ? 'Ubah data driver' : 'Driver berangkat'}
        </button>
      )}
      {(dlv === 'ready' || dlv === 'out') && (
        <button className={`btn ${dlv === 'out' ? '' : 'ghost'}`} data-od="delivered" onClick={() => void run('delivered')}>
          <Icon name="check-circle" size="sm" /> Pesanan tiba
        </button>
      )}
      <button className="btn ghost" data-od="print" onClick={() => void run('print')}>
        <Icon name="printer" size="sm" /> Cetak ulang
      </button>
      <button className="btn ghost" data-od="wa" onClick={() => void run('wa')}>
        <Icon name="chat" size="sm" /> WhatsApp
      </button>
      {o.lines.some((l) => l.kAt) && o.status !== 'VOIDED' && (
        <button className="btn ghost" data-od="ticket" onClick={() => void run('ticket')}>
          <Icon name="chef" size="sm" /> Tiket dapur
        </button>
      )}
      {canVoid(o) && (
        <button className="btn danger ghost" data-od="void" onClick={() => void run('void')}>
          <Icon name="x-circle" size="sm" /> Void
        </button>
      )}
      {canRefund(o) && (
        <button className="btn danger ghost" data-od="refund" onClick={() => void run('refund')}>
          <Icon name="undo" size="sm" /> Refund
        </button>
      )}
    </div>
  );
}
