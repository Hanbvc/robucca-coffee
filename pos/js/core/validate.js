/* =========================================================
   Validasi dokumen transaksi sebelum disimpan di server pusat.
   Total pesanan dihitung ulang dari baris & konfigurasi pajak yang tersimpan
   di pesanan, sehingga data dari perangkat yang rusak/dimanipulasi ditolak.
   ========================================================= */
import { calcOrder } from './calc.js';

export const SYNC_COLLS = ['orders', 'shifts', 'cashMoves', 'stockMoves', 'kitchen', 'audit'];
export const STOCK_TYPES = ['sale', 'void', 'receive', 'adjust', 'waste', 'transfer_in', 'transfer_out'];

const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9:_-]{3,100}$/.test(v);
const isLineId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const isInt = (v) => Number.isInteger(v);
const isTs = (v) => isInt(v) && v > 1.5e12 && v < 4.1e12;
const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function validate(coll, d) {
  const e = [];
  const need = (ok, msg) => { if (!ok) e.push(msg); };
  if (!d || typeof d !== 'object') return ['dokumen kosong'];
  need(isId(d.id), 'id tidak valid');
  need((coll === 'audit' && d.branchId == null) || isId(d.branchId), 'branchId tidak valid');
  need(d.updatedAt == null || isTs(d.updatedAt), 'updatedAt tidak valid');

  switch (coll) {
    case 'orders': {
      need(['sale', 'refund'].includes(d.kind), 'kind tidak valid');
      need(['open', 'paid', 'void', 'refunded'].includes(d.status), 'status tidak valid');
      need(isStr(d.number, 40) && d.number.length > 0, 'nomor tidak valid');
      need(isDate(d.bizDate), 'bizDate tidak valid');
      need(isInt(d.bizHour) && d.bizHour >= 0 && d.bizHour < 24, 'bizHour tidak valid');
      need(isTs(d.createdAt), 'createdAt tidak valid');
      need(Array.isArray(d.lines) && d.lines.length <= 300, 'baris tidak valid');
      if (!Array.isArray(d.lines)) break;
      const refund = d.kind === 'refund';
      d.lines.forEach((l, i) => {
        need(l && isLineId(l.id) && isStr(l.itemId, 100) && isStr(l.name, 160), `baris ${i + 1}: identitas tidak valid`);
        need(l && isInt(l.qty) && (refund ? l.qty <= -1 && l.qty >= -9999 : l.qty >= 1 && l.qty <= 9999), `baris ${i + 1}: jumlah tidak valid`);
        need(l && isInt(l.price) && l.price >= 0 && l.price <= 1e8, `baris ${i + 1}: harga tidak valid`);
      });
      const t = d.totals || {};
      if (!refund) {
        if (e.length) break;
        const { totals } = calcOrder(d, d.cfg || {});
        for (const k of ['items', 'gross', 'discount', 'net', 'service', 'tax', 'rounding', 'total']) {
          need(totals[k] === t[k], `total "${k}" tidak cocok (${t[k]} ≠ ${totals[k]})`);
        }
      } else {
        need(isId(d.refOf), 'refund tanpa referensi');
        need(isInt(t.total) && t.total <= 0, 'total refund harus negatif');
      }
      if (d.status === 'paid' || d.status === 'refunded' || (d.status === 'void' && d.paidAt)) {
        const pays = Array.isArray(d.payments) ? d.payments : [];
        need(pays.length > 0 && pays.length <= 10, 'pembayaran tidak valid');
        const sum = pays.reduce((a, p) => a + (isInt(p.amount) ? p.amount : NaN), 0);
        need(sum === t.total, `jumlah pembayaran (${sum}) ≠ total (${t.total})`);
        pays.forEach((p) => {
          need(['cash', 'noncash', 'platform'].includes(p.type) && isStr(p.method, 40), 'metode bayar tidak valid');
          if (p.type === 'cash' && !refund) need(isInt(p.tendered) && p.tendered >= p.amount, 'uang tunai diterima kurang dari nominal');
        });
        need(isTs(d.paidAt), 'paidAt tidak valid');
      }
      if (d.status === 'void') need(isStr(d.voidReason, 300) && d.voidReason.trim().length > 0, 'alasan void wajib diisi');
      break;
    }
    case 'shifts':
      need(isStr(d.deviceId, 100) && isTs(d.openedAt), 'shift tidak valid');
      need(isInt(d.openingCash) && d.openingCash >= 0, 'kas awal tidak valid');
      need(['open', 'closed'].includes(d.status), 'status shift tidak valid');
      if (d.status === 'closed') need(isInt(d.countedCash) && d.countedCash >= 0 && isTs(d.closedAt), 'tutup shift tidak valid');
      break;
    case 'cashMoves':
      need(isId(d.shiftId) && ['in', 'out'].includes(d.type), 'kas masuk/keluar tidak valid');
      need(isInt(d.amount) && d.amount > 0 && d.amount <= 1e9, 'nominal tidak valid');
      need(isStr(d.reason, 200) && isTs(d.at), 'alasan/waktu tidak valid');
      break;
    case 'stockMoves':
      need(isStr(d.itemId, 100) && isInt(d.qty) && d.qty !== 0 && Math.abs(d.qty) <= 1e6, 'pergerakan stok tidak valid');
      need(STOCK_TYPES.includes(d.type) && isTs(d.at), 'jenis/waktu stok tidak valid');
      break;
    case 'kitchen':
      need(isId(d.orderId) && isLineId(d.lineId) && typeof d.done === 'boolean' && isTs(d.at), 'status dapur tidak valid');
      break;
    case 'audit':
      need(isStr(d.action, 60) && isTs(d.at), 'log tidak valid');
      need(JSON.stringify(d.detail || {}).length <= 4000, 'detail log terlalu besar');
      break;
    default:
      e.push('koleksi tidak dikenal');
  }
  return e;
}
