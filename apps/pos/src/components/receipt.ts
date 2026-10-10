/* =========================================================
   Struk pelanggan, tiket dapur, laporan shift — tampil di layar & dicetak.
   Port dari pos/js/components/receipt.js. Cetak lewat dialog print browser ke
   printer thermal 58/80 mm (driver printer OS / Electron).
   ========================================================= */
import { bpLabel, clock, dateTime, num, rp } from '@robucca/core';
import type { MBranch, MSettings, Order, Shift } from '../data/types';
import type { ShiftSummary } from '../ops';
import { lineDiscAmount } from '../ops';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const R = (l: string, r: string, cls = '') => `<div class="r ${cls}"><span>${l}</span><span>${r}</span></div>`;

export interface ReceiptOpts {
  branch: MBranch | null;
  settings: MSettings;
  reprint?: boolean;
  /** cetak sebagai tagihan (belum dibayar) */
  bill?: boolean;
}

const tzOf = (b: MBranch | null) => b?.timezone ?? 'Asia/Jakarta';
const taxName = (o: Order, b: MBranch | null) => `${b?.taxLabel || 'PB1'} ${bpLabel(o.cfg?.taxRateBp ?? 0)}`;

export function receiptHTML(o: Order, { branch, settings, reprint = false, bill = false }: ReceiptOpts): string {
  const t = o.totals;
  const tz = tzOf(branch);
  const lines = o.lines.filter((l) => !l.voided);
  const footer = branch?.receiptFooter || settings.receiptFooter || '';
  const refunded = o.status === 'REFUNDED';
  return `
    <div class="c"><img class="logo" src="assets/brand/lockup-dark.png" alt="Robucca"></div>
    <div class="c b">${esc(settings.orgName || 'Robucca')} ${esc(branch?.name ?? '')}</div>
    ${branch?.address ? `<div class="c">${esc(branch.address)}</div>` : ''}
    ${branch?.phone ? `<div class="c">${esc(branch.phone)}</div>` : ''}
    ${bill ? '<div class="c b">TAGIHAN (BELUM DIBAYAR)</div>' : ''}
    ${refunded ? '<div class="c"><span class="stamp">REFUND</span></div>' : ''}
    ${o.status === 'VOIDED' ? '<div class="c"><span class="stamp">DIBATALKAN</span></div>' : ''}
    ${reprint ? '<div class="c b">— CETAK ULANG —</div>' : ''}
    <hr>
    ${R('No', esc(o.number || '-'))}
    ${R('Waktu', dateTime(o.paidAt || o.createdAt, tz))}
    ${R('Kasir', esc(o.cashierName || '-'))}
    ${R('Tipe', `${esc(o.channelName)}${o.table ? ` · Meja ${esc(o.table)}` : ''}`)}
    ${o.customerName ? R('Nama', esc(o.customerName)) : ''}
    ${o.platformOrderRef ? R('ID ojol', esc(o.platformOrderRef)) : ''}
    ${o.queueNo ? `<div class="c big" style="margin-top:6px">Antrean ${esc(o.queueNo)}</div>` : ''}
    <hr>
    ${lines
      .map((l) => {
        const d = lineDiscAmount(l);
        return `
      ${R(`${Math.abs(l.qty)}x ${esc(l.name)}`, num(l.unitPrice * l.qty))}
      ${l.sum ? `<div class="sub">${esc(l.sum)}</div>` : ''}
      ${l.note ? `<div class="sub">"${esc(l.note)}"</div>` : ''}
      ${Math.abs(l.qty) > 1 ? `<div class="sub">@ ${num(l.unitPrice)}</div>` : ''}
      ${d ? `<div class="sub">Diskon${l.disc?.type === 'PERCENT' ? ' ' + bpLabel(l.disc.value) : ''} -${num(d)}</div>` : ''}`;
      })
      .join('')}
    <hr>
    ${R('Subtotal', num(t.gross))}
    ${t.discount ? R(`Diskon${o.discount?.name ? ` (${esc(o.discount.name)})` : ''}`, `-${num(Math.abs(t.discount))}`) : ''}
    ${t.service ? R(`Biaya layanan ${bpLabel(o.cfg?.serviceRateBp ?? 0)}`, num(t.service)) : ''}
    ${t.tax && !o.cfg?.taxInclusive ? R(esc(taxName(o, branch)), num(t.tax)) : ''}
    ${t.deliveryFee ? R('Ongkir', num(t.deliveryFee)) : ''}
    ${t.rounding ? R('Pembulatan', num(t.rounding)) : ''}
    ${R('TOTAL', rp(t.total), 'big')}
    ${o.payments.map((p) => R(esc(p.name) + (p.ref ? ` <small>(${esc(p.ref)})</small>` : ''), num(p.method === 'CASH' && p.tendered ? p.tendered : p.amount))).join('')}
    ${o.change ? R('Kembalian', num(o.change)) : ''}
    ${t.tax && o.cfg?.taxInclusive ? `<div class="c" style="margin-top:6px">Harga sudah termasuk ${esc(taxName(o, branch))}: ${num(t.tax)}</div>` : ''}
    ${refunded && o.refund ? `<div class="c" style="margin-top:6px">Refund ${rp(o.refund.amount)} — ${esc(o.refund.reason)}</div>` : ''}
    <hr>
    ${footer ? `<div class="c">${esc(footer)}</div>` : ''}`;
}

/** Struk sebagai teks (untuk WhatsApp) */
export function receiptText(o: Order, { branch, settings }: ReceiptOpts): string {
  const t = o.totals;
  const tz = tzOf(branch);
  return [
    `*${settings.orgName || 'Robucca'} ${branch?.name ?? ''}*`,
    `No: ${o.number}`,
    `Waktu: ${dateTime(o.paidAt || o.createdAt, tz)}`,
    '',
    ...o.lines.filter((l) => !l.voided).map((l) => `${Math.abs(l.qty)}x ${l.name}${l.sum ? ` (${l.sum})` : ''} — ${rp(l.unitPrice * l.qty)}`),
    '',
    ...(t.discount ? [`Diskon: -${rp(t.discount)}`] : []),
    ...(t.service ? [`Biaya layanan: ${rp(t.service)}`] : []),
    ...(t.tax && !o.cfg?.taxInclusive ? [`Pajak: ${rp(t.tax)}`] : []),
    ...(t.deliveryFee ? [`Ongkir: ${rp(t.deliveryFee)}`] : []),
    `*Total: ${rp(t.total)}*`,
    ...o.payments.map((p) => `${p.name}: ${rp(p.method === 'CASH' && p.tendered ? p.tendered : p.amount)}`),
    ...(o.change ? [`Kembalian: ${rp(o.change)}`] : []),
    '',
    branch?.receiptFooter || settings.receiptFooter || 'Terima kasih!',
  ].join('\n');
}

/** Tiket dapur/bar (tanpa harga) */
export function ticketHTML(o: Order, lines: Order['lines'], { branch, station }: { branch: MBranch | null; station?: string }): string {
  const tz = tzOf(branch);
  return `
    <div class="c b">${station === 'BAR' ? 'BAR' : station === 'KITCHEN' ? 'DAPUR' : 'PESANAN'}</div>
    <div class="c big">Antrean ${esc(o.queueNo || '')}</div>
    <div class="c">${esc(o.channelName)}${o.table ? ` · Meja ${esc(o.table)}` : ''}${o.customerName ? ` · ${esc(o.customerName)}` : ''}</div>
    <div class="c">${esc(o.number)} · ${clock(Date.now(), tz)}</div>
    <hr>
    ${lines.map((l) => `<div class="big">${l.qty}x ${esc(l.name)}</div>${l.sum ? `<div class="sub">${esc(l.sum)}</div>` : ''}${l.note ? `<div class="sub b">!! ${esc(l.note)}</div>` : ''}`).join('')}
    <hr>`;
}

/** Laporan tutup shift */
export function shiftHTML(shift: Shift, sum: ShiftSummary, { branch, settings }: { branch: MBranch | null; settings: MSettings }): string {
  const tz = tzOf(branch);
  return `
    <div class="c b">${esc(settings.orgName || 'Robucca')} ${esc(branch?.name ?? '')}</div>
    <div class="c b">LAPORAN SHIFT</div>
    <hr>
    ${R('Terminal', String(shift.terminalNo || 1))}
    ${R('Buka', dateTime(shift.openedAt, tz))}
    ${R('Oleh', esc(shift.openedByName || '-'))}
    ${shift.closedAt ? R('Tutup', dateTime(shift.closedAt, tz)) : ''}
    ${shift.closedByName ? R('Oleh', esc(shift.closedByName)) : ''}
    <hr>
    ${R('Transaksi', String(sum.count))}
    ${sum.refunds ? R('Refund', String(sum.refunds)) : ''}
    ${sum.voids ? R('Void', String(sum.voids)) : ''}
    ${R('Total penjualan', num(sum.total), 'b')}
    <hr>
    ${sum.byMethod.map((p) => R(esc(p.name), num(p.amount))).join('')}
    <hr>
    ${R('Kas awal', num(shift.openingCash))}
    ${R('Tunai masuk', num(sum.cashSales))}
    ${sum.cashRefunds ? R('Refund', `-${num(sum.cashRefunds)}`) : ''}
    ${R('Kas masuk lain', num(sum.cashIn))}
    ${R('Kas keluar', `-${num(sum.cashOut)}`)}
    ${R('Kas seharusnya', num(sum.expected), 'b')}
    ${shift.countedCash != null ? R('Kas dihitung', num(shift.countedCash), 'b') : ''}
    ${shift.countedCash != null ? R('Selisih', `${shift.countedCash - sum.expected > 0 ? '+' : ''}${num(shift.countedCash - sum.expected)}`, 'b') : ''}
    ${shift.differenceNote ? `<div style="margin-top:6px">Catatan: ${esc(shift.differenceNote)}</div>` : ''}
    <hr>
    <div class="c">Dicetak ${dateTime(Date.now(), tz)}</div>`;
}

/* ---------- cetak lewat iframe tersembunyi ---------- */
const RECEIPT_CSS = (paper: number) => `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${paper === 58 ? '48mm' : '72mm'}; padding: 2mm ${paper === 58 ? '1mm' : '2mm'}; color: #000;
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace; font-size: ${paper === 58 ? '10.5px' : '12px'}; line-height: 1.35; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 1.25em; font-weight: 700; }
  .logo { width: 60%; margin: 0 auto 4px; display: block; filter: grayscale(1) contrast(1.3); }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .r { display: flex; justify-content: space-between; gap: 6px; } .r span:last-child { text-align: right; white-space: nowrap; }
  .sub { padding-left: 10px; } small { font-size: .85em; }
  .stamp { display: inline-block; border: 2px solid #000; padding: 1px 8px; font-weight: 700; margin: 4px 0; }
`;

export function printHTML(inner: string, { paper = 80, title = 'Struk' }: { paper?: number; title?: string } = {}): void {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.dataset.print = title;
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${esc(location.href)}"><title>${esc(title)}</title><style>${RECEIPT_CSS(paper)}</style></head><body>${inner}</body></html>`);
  doc.close();
  const go = () => {
    try {
      f.contentWindow!.focus();
      f.contentWindow!.print();
    } catch {
      window.print();
    }
    setTimeout(() => f.remove(), 60000);
  };
  const imgs = [...doc.images];
  if (!imgs.length) setTimeout(go, 50);
  else {
    let left = imgs.length;
    const one = () => {
      left -= 1;
      if (left === 0) go();
    };
    imgs.forEach((im) => {
      if (im.complete) one();
      else {
        im.onload = one;
        im.onerror = one;
      }
    });
    setTimeout(() => {
      if (left > 0) {
        left = -1;
        go();
      }
    }, 2500);
  }
}

export const printReceipt = (o: Order, opts: ReceiptOpts): void =>
  printHTML(receiptHTML(o, opts), { paper: opts.branch?.receiptPaperMm || 80, title: o.number });
