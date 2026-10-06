/* =========================================================
   Struk pelanggan, tiket dapur, laporan shift — tampil di layar & dicetak.
   Cetak lewat dialog print browser ke printer thermal 58/80 mm (driver printer
   di Windows/Android/macOS). Pencetakan ESC/POS langsung belum didukung.
   ========================================================= */
import { esc } from '../lib/ui.js';
import { num, rp, pctLabel } from '../core/money.js';
import { dateTime, clock } from '../core/dates.js';

const R = (l, r, cls = '') => `<div class="r ${cls}"><span>${l}</span><span>${r}</span></div>`;

export function receiptHTML(o, { branch, settings, reprint = false } = {}) {
  const t = o.totals || {}; const tz = (branch && branch.tz) || 'Asia/Jakarta';
  const refund = o.kind === 'refund';
  const lines = (o.lines || []).filter((l) => !l.voided);
  const cfg = o.cfg || {};
  const taxName = `${(branch && branch.taxLabel) || 'PB1'} ${pctLabel(cfg.taxPct || 0)}`;
  const footer = (branch && branch.receiptFooter) || (settings && settings.receiptFooter) || '';
  const pays = o.payments || [];
  return `
    <div class="c"><img class="logo" src="../assets/brand/lockup-dark.png" alt="Robucca"></div>
    <div class="c b">${esc((settings && settings.orgName) || 'Robucca')} ${esc(branch ? branch.name : '')}</div>
    ${branch && branch.address ? `<div class="c">${esc(branch.address)}</div>` : ''}
    ${branch && branch.phone ? `<div class="c">${esc(branch.phone)}</div>` : ''}
    ${refund ? '<div class="c"><span class="stamp">REFUND</span></div>' : ''}
    ${o.status === 'void' ? '<div class="c"><span class="stamp">DIBATALKAN</span></div>' : ''}
    ${reprint ? '<div class="c b">— CETAK ULANG —</div>' : ''}
    <hr>
    ${R('No', esc(o.number || '-'))}
    ${refund && o.refNumber ? R('Refund dari', esc(o.refNumber)) : ''}
    ${R('Waktu', dateTime(o.paidAt || o.createdAt, tz))}
    ${R('Kasir', esc(o.cashierName || '-'))}
    ${R('Tipe', `${esc(o.channelName || o.channel || '')}${o.table ? ` · Meja ${esc(o.table)}` : ''}`)}
    ${o.customer && o.customer.name ? R('Nama', esc(o.customer.name)) : ''}
    ${o.queueNo && !refund ? `<div class="c big" style="margin-top:6px">Antrean ${esc(o.queueNo)}</div>` : ''}
    <hr>
    ${lines.map((l) => `
      ${R(`${Math.abs(l.qty)}x ${esc(l.name)}`, num(l.gross != null ? l.gross : l.price * l.qty))}
      ${l.sum ? `<div class="sub">${esc(l.sum)}</div>` : ''}
      ${l.note ? `<div class="sub">"${esc(l.note)}"</div>` : ''}
      ${Math.abs(l.qty) > 1 ? `<div class="sub">@ ${num(l.price)}</div>` : ''}
      ${l.disc ? `<div class="sub">Diskon${l.disc.type === 'pct' ? ' ' + pctLabel(l.disc.value) : ''} -${num(discLine(l))}</div>` : ''}
    `).join('')}
    <hr>
    ${R('Subtotal', num(t.gross))}
    ${t.discount ? R(`Diskon${o.discount && o.discount.name ? ` (${esc(o.discount.name)})` : ''}`, `-${num(Math.abs(t.discount))}`) : ''}
    ${t.service ? R(`Biaya layanan ${pctLabel(cfg.servicePct || 0)}`, num(t.service)) : ''}
    ${t.tax && !cfg.taxIncl ? R(esc(taxName), num(t.tax)) : ''}
    ${t.rounding ? R('Pembulatan', num(t.rounding)) : ''}
    ${R('TOTAL', rp(t.total), 'big')}
    ${pays.map((p) => R(esc(p.name || p.method) + (p.ref ? ` <small>(${esc(p.ref)})</small>` : ''), num(p.type === 'cash' && p.tendered ? p.tendered : p.amount))).join('')}
    ${o.change ? R('Kembalian', num(o.change)) : ''}
    ${t.tax && cfg.taxIncl ? `<div class="c" style="margin-top:6px">Harga sudah termasuk ${esc(taxName)}: ${num(t.tax)}</div>` : ''}
    ${refund && o.reason ? `<div class="c" style="margin-top:6px">Alasan: ${esc(o.reason)}</div>` : ''}
    <hr>
    ${footer ? `<div class="c">${esc(footer)}</div>` : ''}`;
}
/** Diskon khusus baris (tanpa bagian diskon pesanan) */
const discLine = (l) => {
  if (!l.disc) return 0;
  const g = l.price * Math.abs(l.qty);
  return l.disc.type === 'pct' ? Math.round((g * Math.min(100, l.disc.value)) / 100) : Math.min(g, Math.round(l.disc.value));
};

/** Struk sebagai teks (untuk WhatsApp) */
export function receiptText(o, { branch, settings } = {}) {
  const t = o.totals; const tz = (branch && branch.tz) || 'Asia/Jakarta';
  return [
    `*${(settings && settings.orgName) || 'Robucca'} ${branch ? branch.name : ''}*`,
    `No: ${o.number}`,
    `Waktu: ${dateTime(o.paidAt || o.createdAt, tz)}`,
    '',
    ...o.lines.filter((l) => !l.voided).map((l) => `${Math.abs(l.qty)}x ${l.name}${l.sum ? ` (${l.sum})` : ''} — ${rp(l.gross)}`),
    '',
    ...(t.discount ? [`Diskon: -${rp(t.discount)}`] : []),
    ...(t.service ? [`Biaya layanan: ${rp(t.service)}`] : []),
    ...(t.tax && !(o.cfg && o.cfg.taxIncl) ? [`Pajak: ${rp(t.tax)}`] : []),
    `*Total: ${rp(t.total)}*`,
    ...(o.payments || []).map((p) => `${p.name}: ${rp(p.type === 'cash' && p.tendered ? p.tendered : p.amount)}`),
    ...(o.change ? [`Kembalian: ${rp(o.change)}`] : []),
    '',
    (branch && branch.receiptFooter) || (settings && settings.receiptFooter) || 'Terima kasih!',
  ].join('\n');
}

/** Tiket dapur/bar (tanpa harga) */
export function ticketHTML(o, lines, { branch, station } = {}) {
  const tz = (branch && branch.tz) || 'Asia/Jakarta';
  return `
    <div class="c b">${station === 'bar' ? 'BAR' : station === 'kitchen' ? 'DAPUR' : 'PESANAN'}</div>
    <div class="c big">Antrean ${esc(o.queueNo || '')}</div>
    <div class="c">${esc(o.channelName || '')}${o.table ? ` · Meja ${esc(o.table)}` : ''}${o.customer && o.customer.name ? ` · ${esc(o.customer.name)}` : ''}</div>
    <div class="c">${esc(o.number)} · ${clock(Date.now(), tz)}</div>
    <hr>
    ${lines.map((l) => `<div class="big">${l.qty}x ${esc(l.name)}</div>${l.sum ? `<div class="sub">${esc(l.sum)}</div>` : ''}${l.note ? `<div class="sub b">!! ${esc(l.note)}</div>` : ''}`).join('')}
    <hr>`;
}

/** Laporan tutup shift */
export function shiftHTML(shift, sum, { branch, settings } = {}) {
  const tz = (branch && branch.tz) || 'Asia/Jakarta';
  return `
    <div class="c b">${esc((settings && settings.orgName) || 'Robucca')} ${esc(branch ? branch.name : '')}</div>
    <div class="c b">LAPORAN SHIFT</div>
    <hr>
    ${R('Terminal', String(shift.terminalNo || 1))}
    ${R('Buka', `${dateTime(shift.openedAt, tz)}`)}
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
    ${sum.cashRefunds ? R('Refund tunai', `-${num(sum.cashRefunds)}`) : ''}
    ${R('Kas masuk lain', num(sum.cashIn))}
    ${R('Kas keluar', `-${num(sum.cashOut)}`)}
    ${R('Kas seharusnya', num(sum.expected), 'b')}
    ${shift.countedCash != null ? R('Kas dihitung', num(shift.countedCash), 'b') : ''}
    ${shift.countedCash != null ? R('Selisih', `${shift.countedCash - sum.expected > 0 ? '+' : ''}${num(shift.countedCash - sum.expected)}`, 'b') : ''}
    ${shift.note ? `<div style="margin-top:6px">Catatan: ${esc(shift.note)}</div>` : ''}
    <hr>
    <div class="c">Dicetak ${dateTime(Date.now(), tz)}</div>`;
}

/* ---------- cetak lewat iframe tersembunyi ---------- */
const RECEIPT_CSS = (paper) => `
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

export function printHTML(inner, { paper = 80, title = 'Struk' } = {}) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(f);
  const doc = f.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${esc(location.href)}"><title>${esc(title)}</title><style>${RECEIPT_CSS(paper)}</style></head><body>${inner}</body></html>`);
  doc.close();
  const go = () => {
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.print(); }
    setTimeout(() => f.remove(), 60000);
  };
  const imgs = [...doc.images];
  if (!imgs.length) setTimeout(go, 50);
  else {
    let left = imgs.length;
    const one = () => { left -= 1; if (left <= 0) go(); };
    imgs.forEach((im) => { if (im.complete) one(); else { im.onload = one; im.onerror = one; } });
    setTimeout(() => { if (left > 0) { left = 0; go(); } }, 2500);
  }
}

export const printReceipt = (o, opts) => printHTML(receiptHTML(o, opts), { paper: (opts.branch && opts.branch.paper) || 80, title: o.number });
