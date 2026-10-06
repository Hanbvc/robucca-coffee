/* =========================================================
   Riwayat transaksi CONTOH untuk mode demo (simulasi, bukan data penjualan asli).
   Dibuat deterministik untuk tiap cabang aktif selama N hari terakhir supaya
   dasbor, laporan, shift, dan stok bisa dicoba. Semua dokumen ditandai `demo: true`
   dan dicatat sebagai terminal 2 agar tidak bentrok dengan nomor struk perangkat ini.
   ========================================================= */
import { buildLine, applyTotals, cfgFor, cashSuggestions, defaultSel } from '../core/calc.js';
import { receiptNo, queueNo } from '../core/ids.js';
import { zonedEpoch, addDays, dow, bizDate, bizHour } from '../core/dates.js';
import { shiftSummary } from '../core/report.js';

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickW(r, entries) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) { if ((x -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
}

const CAT_W = { essentials: 6, signature: 5, coffee: 5, milk: 3, tea: 2.2, soda: 1.4, ramen: 3, bento: 2.4, donburi: 2.4, breakfast: 1.4, salad: 0.6, pasta: 1.1, snack: 2.6, pastry: 2.2, dessert: 1.5 };
const HOUR_W = { 8: 6, 9: 8, 10: 7, 11: 7, 12: 10, 13: 9, 14: 6, 15: 6, 16: 7, 17: 8, 18: 9, 19: 9, 20: 5 };
const NAMES = ['Andi', 'Rani', 'Dimas', 'Putri', 'Bayu', 'Intan', 'Yoga', 'Laras', 'Reza', 'Tika', 'Galih', 'Wulan', 'Arif', 'Citra', 'Hendra', 'Mega'];
const DAY_BASE = [80, 55, 55, 55, 58, 66, 86]; // Minggu..Sabtu
const BRANCH_F = [1, 0.78, 0.62];

function randomSel(r, item) {
  const sel = defaultSel(item);
  (item.opts || []).forEach((g) => {
    if (g.type === 'multi') return;
    if (r() < 0.45 && g.choices.length) sel[g.id] = g.choices[Math.floor(r() * g.choices.length)].n;
  });
  return sel;
}

export function generateHistory(master, { days = 30, now = Date.now(), seed = 20261006 } = {}) {
  const r = prng(seed);
  const out = { orders: [], shifts: [], cashMoves: [], stockMoves: [] };
  let seqId = 0; const nid = (p) => `demo-${p}-${(seqId++).toString(36)}`;
  const chans = master.activeChannels();
  const chW = { dinein: 45, takeaway: 30, gofood: 12, grabfood: 9, shopeefood: 4 };
  const pays = master.activePays().filter((p) => p.type !== 'platform');
  const payW = { cash: 30, qris: 42, debit: 10, credit: 3, gopay: 6, ovo: 4, dana: 3, shopeepay: 2, transfer: 0.5 };
  const member = master.discounts.find((d) => d.active !== false && d.type === 'pct' && !d.approval);
  const voucher = master.discounts.find((d) => d.active !== false && d.type === 'amt' && !d.approval);

  // urutan asli data (cabang utama dulu), bukan urutan abjad
  master.raw.branches.filter((b) => b.active !== false).forEach((b, bi) => {
    const tz = b.tz || 'Asia/Jakarta';
    const today = bizDate(now, tz, b.dayStart);
    const cfg = cfgFor(b, master.settings);
    const team = master.staff.filter((s) => s.active !== false && (s.branchIds || []).includes(b.id));
    const cashiers = team.filter((s) => s.role === 'cashier');
    const cashier = cashiers[0] || team[0] || master.staff[0];
    const mgr = team.find((s) => s.role === 'manager') || cashier;
    const menu = master.items.filter((it) => master.available(b.id, it)).map((it) => {
      const nInCat = master.items.filter((x) => x.catId === it.catId).length || 1;
      return [it, ((CAT_W[it.catId] || 1) / nInCat) * (it.sig ? 1.6 : 1) * (0.6 + r() * 0.8)];
    });
    const tracked = menu.map(([it]) => it).filter((it) => it.track);
    const stock = {};
    const f = BRANCH_F[bi % BRANCH_F.length] || 0.6;

    for (let di = days - 1; di >= 0; di--) {
      const date = addDays(today, -di);
      const openTs = zonedEpoch(date, b.open || '08:00', tz);
      const closeTs = zonedEpoch(date, b.close || '21:00', tz);
      const isToday = di === 0;
      const endTs = isToday ? Math.min(now - 5 * 60e3, closeTs) : closeTs;
      if (endTs <= openTs + 30 * 60e3) continue;

      const shift = {
        id: nid('sh'), branchId: b.id, deviceId: 'demo-terminal-2', terminalNo: 2, bizDate: date,
        openedAt: openTs - 10 * 60e3, openedBy: cashier.id, openedByName: cashier.name, openingCash: 500000,
        status: 'open', createdAt: openTs - 10 * 60e3, updatedAt: openTs - 10 * 60e3, rev: 1, demo: true,
      };
      const dayOrders = []; const dayMoves = [];
      tracked.forEach((it) => {
        // isi ulang ke target harian (beberapa hari dilewati supaya ada stok menipis)
        const target = 6 + Math.floor(r() * 7);
        const q = target - (stock[it.id] || 0);
        if (q <= 0 || (di < 2 && r() < 0.5)) return;
        if (bi === 0 && di <= 3 && tracked.indexOf(it) < 2) return; // contoh stok menipis di cabang utama
        stock[it.id] = (stock[it.id] || 0) + q;
        out.stockMoves.push({ id: nid('sm'), branchId: b.id, itemId: it.id, qty: q, type: 'receive', note: 'Kiriman pagi', by: mgr.id, byName: mgr.name, at: openTs - 20 * 60e3, updatedAt: openTs - 20 * 60e3, rev: 1, demo: true });
      });

      let n = Math.round(DAY_BASE[dow(date)] * f * (0.85 + r() * 0.3));
      if (isToday) n = Math.round((n * (endTs - openTs)) / (closeTs - openTs));
      const hours = Object.entries(HOUR_W).map(([h, w]) => [+h, w]);
      const stamps = [];
      for (let k = 0; k < n; k++) {
        const h = pickW(r, hours);
        const ts = zonedEpoch(date, `${String(h).padStart(2, '0')}:00`, tz) + Math.floor(r() * 3600e3);
        if (ts >= openTs && ts < endTs) stamps.push(ts);
      }
      stamps.sort((a, x) => a - x);

      stamps.forEach((ts, k) => {
        const chId = pickW(r, chans.map((c) => [c.id, chW[c.id] ?? 2]));
        const ch = master.channel[chId];
        const nLines = pickW(r, [[1, 35], [2, 35], [3, 20], [4, 10]]);
        const used = new Set(); const lines = [];
        for (let i = 0; i < nLines; i++) {
          const it = pickW(r, menu);
          if (used.has(it.id)) continue;
          const qty = pickW(r, [[1, 80], [2, 17], [3, 3]]);
          if (it.track && (stock[it.id] || 0) < qty) continue;
          used.add(it.id);
          if (it.track) stock[it.id] -= qty;
          lines.push(buildLine(it, randomSel(r, it), { id: `l${i + 1}`, qty, ov: master.override(b.id, it.id), markupPct: ch.markupPct, station: master.stationOf(it) }));
        }
        if (!lines.length) return;
        const seq = k + 1;
        const platform = ch.type === 'platform';
        let discount = null;
        if (!platform && member && r() < 0.06) discount = { id: member.id, name: member.name, type: member.type, value: member.value };
        else if (!platform && voucher && r() < 0.01) discount = { id: voucher.id, name: voucher.name, type: voucher.type, value: voucher.value };
        let o = {
          id: nid('o'), kind: 'sale', branchId: b.id, deviceId: 'demo-terminal-2', terminalNo: 2, shiftId: shift.id,
          number: receiptNo(b.code, 2, date, seq), queueNo: queueNo(2, seq),
          channel: ch.id, channelName: ch.name, table: ch.type === 'dinein' ? String(1 + Math.floor(r() * 20)) : '',
          customer: { name: ch.type === 'dinein' ? '' : NAMES[Math.floor(r() * NAMES.length)], phone: '' },
          status: 'paid', lines, discount, cashierId: cashier.id, cashierName: cashier.name,
          createdAt: ts, paidAt: ts + 45e3, updatedAt: ts + 45e3, bizDate: date, bizHour: bizHour(ts + 45e3, tz), rev: 1, demo: true,
        };
        o = applyTotals(o, cfg);
        const total = o.totals.total;
        if (platform) o.payments = [{ method: ch.id, name: ch.name, type: 'platform', amount: total }];
        else {
          const pm = master.pay[pickW(r, pays.map((p) => [p.id, payW[p.id] ?? 1]))] || pays[0];
          if (pm.type === 'cash') {
            const sug = cashSuggestions(total);
            const tendered = r() < 0.4 ? total : sug[Math.min(sug.length - 1, 1 + Math.floor(r() * 2))];
            o.payments = [{ method: pm.id, name: pm.name, type: 'cash', amount: total, tendered }];
            o.change = tendered - total;
          } else o.payments = [{ method: pm.id, name: pm.name, type: pm.type, amount: total, ref: pm.ref ? String(100000 + Math.floor(r() * 899999)) : '' }];
        }
        if (r() < 0.008) {
          Object.assign(o, { status: 'void', voidAt: ts + 6 * 60e3, voidReason: 'Salah input pesanan', voidBy: mgr.id, voidByName: mgr.name, updatedAt: ts + 6 * 60e3 });
          lines.forEach((l) => { const it = master.item[l.itemId]; if (it && it.track) stock[it.id] += l.qty; });
        } else {
          lines.forEach((l) => {
            const it = master.item[l.itemId];
            if (it && it.track) out.stockMoves.push({ id: nid('sm'), branchId: b.id, itemId: it.id, qty: -l.qty, type: 'sale', ref: o.id, refNumber: o.number, by: cashier.id, byName: cashier.name, at: o.paidAt, updatedAt: o.paidAt, rev: 1, demo: true });
          });
        }
        dayOrders.push(o);
      });

      if (r() < 0.35) {
        const at = openTs + Math.floor(r() * (endTs - openTs));
        dayMoves.push({ id: nid('cm'), branchId: b.id, shiftId: shift.id, type: 'out', amount: 25000, reason: 'Beli es batu', by: cashier.id, byName: cashier.name, at, updatedAt: at, rev: 1, demo: true });
      }
      if (r() < 0.1) {
        const at = openTs + 60 * 60e3;
        dayMoves.push({ id: nid('cm'), branchId: b.id, shiftId: shift.id, type: 'in', amount: 200000, reason: 'Tambahan uang kembalian', by: mgr.id, byName: mgr.name, at, updatedAt: at, rev: 1, demo: true });
      }

      if (!isToday) {
        const sum = shiftSummary(shift, dayOrders, dayMoves);
        const diff = pickW(r, [[0, 80], [-2000, 6], [-5000, 6], [1000, 4], [-10000, 4]]);
        Object.assign(shift, {
          status: 'closed', closedAt: closeTs + 15 * 60e3, closedBy: cashier.id, closedByName: cashier.name,
          countedCash: sum.expected + diff, expectedCash: sum.expected, difference: diff, summary: sum,
          note: diff ? 'Selisih kas' : '', updatedAt: closeTs + 15 * 60e3,
        });
        tracked.forEach((it) => {
          if ((stock[it.id] || 0) > 0 && r() < 0.25) {
            stock[it.id] -= 1;
            out.stockMoves.push({ id: nid('sm'), branchId: b.id, itemId: it.id, qty: -1, type: 'waste', note: 'Tidak layak jual', by: mgr.id, byName: mgr.name, at: closeTs, updatedAt: closeTs, rev: 1, demo: true });
          }
        });
      }
      out.shifts.push(shift);
      out.orders.push(...dayOrders);
      out.cashMoves.push(...dayMoves);
    }
  });
  return out;
}
