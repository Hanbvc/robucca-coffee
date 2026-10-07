import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rp, num, parse, roundTo, short } from '../pos/js/core/money.js';
import {
  channelPrice, calcOrder, allocate, discAmount, defaultSel, chosenMods, modsSummary, buildLine, applyTotals,
  missingRequired, paySummary, cashSuggestions, cfgFor, lineKey,
} from '../pos/js/core/calc.js';
import { bizDate, bizHour, presetRange, prevRange, addDays, zonedEpoch, daysBetween, dayDiff } from '../pos/js/core/dates.js';
import { receiptNo, queueNo, uuid, randDigits, validBranchCode } from '../pos/js/core/ids.js';
import { hashPin, verifyPin, pbkdf2Js, sha256Hex, validPin } from '../pos/js/core/pin.js';
import { aggregate, shiftSummary, stockLevels, toCSV } from '../pos/js/core/report.js';
import { validate } from '../pos/js/core/validate.js';
import { can, canBranch, staffForBranch, assignableRoles } from '../pos/js/core/perms.js';
import { seedMaster, menuFromData } from '../pos/js/core/seed.js';
import { loadCustomerData } from '../server/data-loader.js';
import { MENU_GROUPS, groupOf, byMenuOrder, publicMenu, optionNotes, priceNote } from '../pos/js/core/menu.js';
import { Master } from '../pos/js/data/master.js';

const hex = (u8) => Buffer.from(u8).toString('hex');

/* ---------------- money ---------------- */
test('format & parse rupiah', () => {
  assert.equal(rp(87000), 'Rp87.000');
  assert.equal(rp(-5000), '-Rp5.000');
  assert.equal(rp(0), 'Rp0');
  assert.equal(num(1234567), '1.234.567');
  assert.equal(parse('Rp 100.000'), 100000);
  assert.equal(parse(''), 0);
  assert.equal(parse('-2.500'), -2500);
  assert.equal(short(1250000), '1,3 jt');
  assert.equal(short(87000), '87 rb');
});

test('pembulatan', () => {
  assert.equal(roundTo(84315, 100, 'down'), 84300);
  assert.equal(roundTo(84350, 100, 'nearest'), 84400);
  assert.equal(roundTo(84301, 100, 'up'), 84400);
  assert.equal(roundTo(84300, 100, 'up'), 84300);
  assert.equal(roundTo(84300, 100, 'down'), 84300);
  assert.equal(roundTo(1234.6, 1), 1235);
});

/* ---------------- calc ---------------- */
const L = (id, price, qty = 1, extra = {}) => ({ id, itemId: id, name: id, price, qty, ...extra });

test('harga kanal dengan markup dibulatkan ke atas Rp500', () => {
  assert.equal(channelPrice(35000, 0), 35000);
  assert.equal(channelPrice(35000, 20), 42000);
  assert.equal(channelPrice(15500, 25), 19500); // 19.375 → 19.500
  assert.equal(channelPrice(20000, 20), 24000); // tepat kelipatan: tidak naik
});

test('pajak termasuk harga (PB1 10%) tidak mengubah total', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, { taxPct: 10, taxIncl: true, servicePct: 0, roundUnit: 100, roundMode: 'down' });
  assert.deepEqual(totals, { items: 3, gross: 73000, lineDisc: 0, orderDisc: 0, discount: 0, sales: 73000, net: 66364, service: 0, tax: 6636, rounding: 0, total: 73000 });
});

test('diskon pesanan 10% + pajak termasuk', () => {
  const { totals, amounts } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)], discount: { type: 'pct', value: 10 } }, { taxPct: 10, taxIncl: true });
  assert.equal(totals.orderDisc, 7300);
  assert.equal(totals.total, 65700);
  assert.equal(totals.tax, 5973);
  assert.equal(totals.net, 59727);
  assert.equal(amounts.reduce((a, x) => a + x.amount, 0), 65700);
  assert.equal(amounts.reduce((a, x) => a + x.disc, 0), 7300);
});

test('pajak di luar harga + servis 5% + pembulatan ke bawah', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, { taxPct: 10, taxIncl: false, servicePct: 5, roundUnit: 100, roundMode: 'down' });
  assert.equal(totals.service, 3650);
  assert.equal(totals.tax, 7665); // (73.000 + 3.650) × 10%
  assert.equal(totals.total, 84300);
  assert.equal(totals.rounding, -15);
});

test('pajak termasuk + servis: servis & pajak servis ditambahkan', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, { taxPct: 10, taxIncl: true, servicePct: 5, roundUnit: 100, roundMode: 'down' });
  assert.equal(totals.net, 66364);
  assert.equal(totals.service, 3318);
  assert.equal(totals.tax, 6636 + 332);
  assert.equal(totals.total, 76600);
  assert.equal(totals.rounding, -50);
});

test('pajak tanpa servis kena pajak (taxService=false)', () => {
  const { totals } = calcOrder({ lines: [L('a', 100000)] }, { taxPct: 10, taxIncl: false, servicePct: 5, taxService: false, roundUnit: 1 });
  assert.equal(totals.service, 5000);
  assert.equal(totals.tax, 10000);
  assert.equal(totals.total, 115000);
});

test('identitas total = net + servis + pajak + pembulatan (acak)', () => {
  let s = 42; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let n = 0; n < 2000; n++) {
    const lines = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => L('x' + i, Math.round(r() * 80) * 500, 1 + Math.floor(r() * 4), r() < 0.2 ? { disc: { type: r() < 0.5 ? 'pct' : 'amt', value: r() < 0.5 ? Math.round(r() * 50) : Math.round(r() * 20000) } } : {}));
    const order = { lines, discount: r() < 0.3 ? { type: 'pct', value: Math.round(r() * 30) } : null };
    const cfg = { taxPct: [0, 10, 11][Math.floor(r() * 3)], taxIncl: r() < 0.5, servicePct: [0, 5, 7.5][Math.floor(r() * 3)], roundUnit: [1, 100, 500][Math.floor(r() * 3)], roundMode: ['down', 'nearest', 'up'][Math.floor(r() * 3)] };
    const { totals: t, amounts } = calcOrder(order, cfg);
    assert.equal(t.total, t.net + t.service + t.tax + t.rounding, JSON.stringify({ order, cfg, t }));
    assert.equal(t.sales, t.gross - t.discount);
    assert.equal(amounts.reduce((a, x) => a + x.amount, 0), t.sales);
    assert.ok(amounts.every((x) => x.amount >= 0));
    assert.ok(t.total % (cfg.roundUnit || 1) === 0);
  }
});

test('alokasi diskon proporsional tidak melebihi bobot', () => {
  assert.deepEqual(allocate(2, [1, 1, 1]).reduce((a, x) => a + x, 0), 2);
  assert.ok(allocate(2, [1, 1, 1]).every((x) => x <= 1));
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.deepEqual(allocate(10, [10, 0]), [10, 0]);
  assert.deepEqual(allocate(7300, [35000, 38000]), [3500, 3800]);
});

test('diskon dibatasi & baris void diabaikan', () => {
  assert.equal(discAmount({ type: 'pct', value: 150 }, 10000), 10000);
  assert.equal(discAmount({ type: 'amt', value: 50000 }, 10000), 10000);
  assert.equal(discAmount({ type: 'amt', value: -5 }, 10000), 0);
  const { totals } = calcOrder({ lines: [L('a', 10000), L('b', 5000, 1, { voided: true })] }, { taxPct: 0 });
  assert.equal(totals.total, 10000);
  assert.equal(totals.items, 1);
});

test('opsi menu: bawaan, showIf, ringkasan, wajib', () => {
  const SUGAR = { id: 'sugar', name: 'Level Gula', type: 'single', choices: [{ n: 'Normal' }, { n: 'Less Sugar' }, { n: 'No Sugar' }] };
  const ICED = ['Iced · Regular', 'Iced · Large'];
  const item = {
    id: 'caffe-latte', catId: 'coffee', name: 'Caffe Latte', price: 19000,
    opts: [
      { id: 'size', name: 'Penyajian & ukuran', type: 'single', required: true, def: ICED[0], choices: [{ n: ICED[0] }, { n: ICED[1], p: 4000 }, { n: 'Hot', p: 2000 }] },
      SUGAR,
      { id: 'ice', name: 'Level Es', type: 'single', choices: [{ n: 'Normal Ice' }, { n: 'Less Ice' }], showIf: { size: ICED } },
    ],
  };
  const sel = defaultSel(item);
  assert.deepEqual(sel, { size: 'Iced · Regular', sugar: 'Normal', ice: 'Normal Ice' });
  const l1 = buildLine(item, { ...sel, size: 'Iced · Large', sugar: 'Less Sugar' }, { id: 'l1' });
  assert.equal(l1.price, 23000);
  assert.equal(l1.sum, 'Iced · Large · Less Sugar');
  const hot = { ...sel, size: 'Hot', ice: 'Less Ice' };
  assert.deepEqual(chosenMods(item, hot).map((m) => m.n), ['Hot', 'Normal']); // es disembunyikan saat Hot
  assert.equal(modsSummary(item, chosenMods(item, hot)), 'Hot');
  assert.deepEqual(missingRequired(item, { sugar: 'Normal' }), ['Penyajian & ukuran']);
  const gofood = buildLine(item, sel, { id: 'l2', markupPct: 20, ov: { price: 20000 } });
  assert.equal(gofood.base, 20000);
  assert.equal(gofood.price, 24000);
  assert.notEqual(lineKey(l1), lineKey(gofood));
});

test('applyTotals menyimpan nominal per baris & konfigurasi', () => {
  const o = applyTotals({ lines: [L('a', 35000), L('b', 19000, 2, { voided: true })], discount: { type: 'amt', value: 5000, name: 'Voucher' } }, { taxPct: 10, taxIncl: true, roundUnit: 100, roundMode: 'down' });
  assert.equal(o.totals.total, 30000);
  assert.equal(o.lines[0].amount, 30000);
  assert.equal(o.lines[1].amount, 0);
  assert.equal(o.discount.amount, 5000);
  assert.equal(o.cfg.taxPct, 10);
});

test('cfgFor dari cabang & pengaturan', () => {
  assert.deepEqual(cfgFor({ taxPct: 10, taxIncl: false, servicePct: 5 }, { roundUnit: 100, roundMode: 'nearest' }), { taxPct: 10, taxIncl: false, taxService: true, servicePct: 5, roundUnit: 100, roundMode: 'nearest' });
});

test('ringkasan pembayaran & saran uang tunai', () => {
  const s = paySummary(87000, [{ type: 'noncash', amount: 30000 }, { type: 'cash', amount: 57000, tendered: 100000 }]);
  assert.deepEqual(s, { applied: 87000, remaining: 0, change: 43000, tendered: 130000 });
  assert.deepEqual(cashSuggestions(87000), [87000, 90000, 100000]);
  assert.deepEqual(cashSuggestions(15500), [15500, 20000, 50000, 100000]);
});

/* ---------------- dates ---------------- */
test('tanggal bisnis per zona waktu & jam pergantian hari', () => {
  const ts = Date.UTC(2026, 9, 6, 17, 30); // 7 Okt 00.30 WIB
  assert.equal(bizDate(ts, 'Asia/Jakarta'), '2026-10-07');
  assert.equal(bizDate(ts, 'Asia/Jakarta', 4), '2026-10-06');
  assert.equal(bizDate(Date.UTC(2026, 9, 6, 16, 30), 'Asia/Makassar'), '2026-10-07'); // 00.30 WITA
  assert.equal(bizHour(ts, 'Asia/Jakarta'), 0);
  assert.equal(zonedEpoch('2026-10-07', '00:30', 'Asia/Jakarta'), ts);
});

test('rentang preset & pembanding', () => {
  assert.deepEqual(presetRange('7d', '2026-10-06'), { from: '2026-09-30', to: '2026-10-06' });
  assert.deepEqual(presetRange('month', '2026-10-06'), { from: '2026-10-01', to: '2026-10-06' });
  assert.deepEqual(presetRange('lastmonth', '2026-03-15'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(prevRange({ from: '2026-10-01', to: '2026-10-06' }), { from: '2026-09-25', to: '2026-09-30' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-02-27', '2026-03-02').length, 4);
  assert.equal(dayDiff('2026-10-01', '2026-10-06'), 5);
});

/* ---------------- ids ---------------- */
test('nomor struk, antrean, uuid', () => {
  assert.equal(receiptNo('IJN', 1, '2026-10-06', 42), 'IJN1-261006-0042');
  assert.equal(queueNo(1, 7), '007');
  assert.equal(queueNo(2, 7), 'B007');
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(randDigits(6), /^\d{6}$/);
  assert.ok(validBranchCode('IJN') && validBranchCode('CB2') && !validBranchCode('ijn') && !validBranchCode('TOOLONG'));
});

/* ---------------- pin ---------------- */
test('SHA-256 & PBKDF2 JS murni sesuai vektor uji', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const te = new TextEncoder();
  assert.equal(hex(pbkdf2Js(te.encode('password'), te.encode('salt'), 1)), '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  assert.equal(hex(pbkdf2Js(te.encode('password'), te.encode('salt'), 2)), 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
});

test('hash & verifikasi PIN (WebCrypto sama dengan JS murni)', async () => {
  const h = await hashPin('2580', '00112233445566778899aabbccddeeff', 1000);
  const [, , salt, hash] = h.split('$');
  assert.equal(hex(pbkdf2Js(new TextEncoder().encode('2580'), Buffer.from(salt, 'hex'), 1000)), hash);
  assert.equal(await verifyPin('2580', h), true);
  assert.equal(await verifyPin('2581', h), false);
  assert.equal(await verifyPin('abc', h), false);
  assert.ok(validPin('1234') && validPin('123456') && !validPin('123') && !validPin('12a4'));
});

/* ---------------- report ---------------- */
function order(over = {}) {
  const base = { id: uuid(), kind: 'sale', status: 'paid', branchId: 'br-a', number: 'A1-261006-0001', bizDate: '2026-10-06', bizHour: 9, createdAt: 1.7e12 + 1, paidAt: 1.7e12 + 2, channel: 'dinein', cashierId: 'k1', cashierName: 'Sari', lines: [L('l1', 35000, 1, { itemId: 'ramen', catId: 'ramen', name: 'Ramen' }), L('l2', 19000, 2, { itemId: 'latte', catId: 'coffee', name: 'Latte' })], ...over };
  const o = applyTotals(base, { taxPct: 10, taxIncl: true, roundUnit: 100, roundMode: 'down' });
  o.payments = o.payments || [{ method: 'cash', name: 'Tunai', type: 'cash', amount: o.totals.total, tendered: 100000 }];
  return o;
}

test('agregasi: penjualan, refund, void', () => {
  const a = order({ shiftId: 's1' });
  const b = order({ branchId: 'br-b', bizDate: '2026-10-05', bizHour: 14, channel: 'gofood', shiftId: 's2' });
  b.payments = [{ method: 'gofood', name: 'GoFood', type: 'platform', amount: b.totals.total }];
  const v = order({ status: 'void', voidReason: 'salah input', shiftId: 's1' });
  const ref = { ...a, id: uuid(), kind: 'refund', status: 'paid', refOf: a.id, totals: Object.fromEntries(Object.entries(a.totals).map(([k, x]) => [k, -x])), lines: a.lines.map((l) => ({ ...l, qty: -l.qty, gross: -l.gross, discAmt: -l.discAmt, amount: -l.amount })), payments: [{ method: 'cash', name: 'Tunai', type: 'cash', amount: -a.totals.total }], bizDate: '2026-10-06' };
  a.status = 'refunded';
  const r = aggregate([a, b, v, ref], { from: '2026-10-05', to: '2026-10-06', branchNames: { 'br-a': 'A', 'br-b': 'B' } });
  assert.equal(r.kpi.orders, 2);
  assert.equal(r.kpi.refunds, 1);
  assert.equal(r.kpi.voids, 1);
  assert.equal(r.kpi.total, 73000); // 73.000 + 73.000 − 73.000
  assert.equal(r.kpi.refundTotal, 73000);
  assert.equal(r.kpi.avg, 73000);
  assert.equal(r.days.length, 2);
  assert.equal(r.days.find((d) => d.date === '2026-10-06').total, 0);
  assert.equal(r.branches.find((x) => x.id === 'br-b').name, 'B');
  assert.equal(r.items.find((i) => i.id === 'latte').qty, 2);
  assert.equal(r.payments.find((p) => p.method === 'cash').amount, 0);
  assert.equal(r.hours[14].total, 73000);
});

test('ringkasan shift: kas seharusnya', () => {
  const shift = { id: 's1', openingCash: 500000 };
  const a = order({ shiftId: 's1' }); // tunai 73.000
  const q = order({ shiftId: 's1' }); q.payments = [{ method: 'qris', name: 'QRIS', type: 'noncash', amount: q.totals.total }];
  const v = order({ shiftId: 's1', status: 'void', voidReason: 'x' });
  const other = order({ shiftId: 's2' });
  const moves = [{ shiftId: 's1', type: 'in', amount: 20000 }, { shiftId: 's1', type: 'out', amount: 15000 }, { shiftId: 's2', type: 'out', amount: 99999 }];
  const s = shiftSummary(shift, [a, q, v, other], moves);
  assert.equal(s.cashSales, 73000);
  assert.equal(s.expected, 500000 + 73000 + 20000 - 15000);
  assert.equal(s.count, 2);
  assert.equal(s.voids, 1);
  assert.equal(s.total, 146000);
});

test('stok & CSV', () => {
  assert.deepEqual(stockLevels([{ itemId: 'a', qty: 10 }, { itemId: 'a', qty: -3 }, { itemId: 'b', qty: 2 }]), { a: 7, b: 2 });
  const csv = toCSV([{ n: 'Kopi; susu', q: 2 }], [{ label: 'Menu', key: 'n' }, { label: 'Qty', key: 'q' }]);
  assert.equal(csv, 'Menu;Qty\r\n"Kopi; susu";2');
});

/* ---------------- validate ---------------- */
test('validasi pesanan: total dihitung ulang', () => {
  const o = order({ updatedAt: 1.7e12 + 3 });
  assert.deepEqual(validate('orders', o), []);
  const bad = { ...o, totals: { ...o.totals, total: o.totals.total - 1000 } };
  assert.ok(validate('orders', bad).some((e) => e.includes('total')));
  const underpaid = { ...o, payments: [{ method: 'cash', type: 'cash', amount: 1000, tendered: 1000 }] };
  assert.ok(validate('orders', underpaid).some((e) => e.includes('pembayaran')));
  const voidNoReason = { ...o, status: 'void', voidReason: '' };
  assert.ok(validate('orders', voidNoReason).some((e) => e.includes('alasan')));
  assert.deepEqual(validate('cashMoves', { id: 'cm-1', branchId: 'br-a', shiftId: 's-1', type: 'out', amount: 5000, reason: 'Es batu', at: 1.7e12 }), []);
  assert.ok(validate('cashMoves', { id: 'cm-1', branchId: 'br-a', shiftId: 's-1', type: 'out', amount: -5, reason: 'x', at: 1.7e12 }).length);
  assert.ok(validate('nope', { id: 'abc', branchId: 'br-a' }).length);
});

/* ---------------- perms ---------------- */
test('hak akses per peran & cabang', () => {
  const owner = { role: 'owner', branchIds: ['*'] };
  const mgr = { role: 'manager', branchIds: ['br-a'] };
  const kasir = { role: 'cashier', branchIds: ['br-a'] };
  assert.ok(can(owner, 'settings') && !can(mgr, 'settings') && can(mgr, 'approve') && !can(kasir, 'approve'));
  assert.ok(canBranch(owner, 'br-z') && canBranch(mgr, 'br-a') && !canBranch(mgr, 'br-b'));
  assert.ok(!can({ role: 'cashier', active: false }, 'sell'));
  assert.deepEqual(staffForBranch([owner, mgr, kasir, { role: 'cashier', branchIds: ['br-b'] }], 'br-a').length, 3);
  assert.deepEqual(staffForBranch([owner, mgr, kasir], null).length, 2);
  assert.deepEqual(assignableRoles(mgr), ['cashier', 'kitchen']);
});

/* ---------------- seed ---------------- */
test('data awal dari js/data.js', async () => {
  const { MENU, CONFIG } = loadCustomerData();
  const { categories, items } = menuFromData(MENU);
  assert.equal(categories.length, 15);
  assert.equal(items.length, 95);
  assert.equal(categories.find((c) => c.id === 'coffee').station, 'bar');
  assert.equal(categories.find((c) => c.id === 'ramen').station, 'kitchen');
  assert.equal(categories.find((c) => c.id === 'pastry').station, 'bar');
  assert.equal(items.find((i) => i.id === 'pasta-aglio-olio').img, 'pasta-oglio-olio');
  const m = await seedMaster({ MENU, CONFIG, demo: false, ownerPin: '123456' });
  assert.equal(m.branches.length, 1);
  assert.equal(m.branches[0].code, 'IJN');
  assert.equal(m.staff.length, 1);
  assert.equal(await verifyPin('123456', m.staff[0].pin), true);
  const d = await seedMaster({ MENU, CONFIG, demo: true });
  assert.equal(d.branches.length, 3);
  assert.ok(d.staff.length >= 9);
});

/* ---------------- urutan kelompok & menu pelanggan ---------------- */
test('urutan kelompok sama di js/data.js & POS: Minuman → Snack → Makanan Berat → Pastry & Dessert', () => {
  const { MENU, GROUPS } = loadCustomerData();
  assert.deepEqual(GROUPS, MENU_GROUPS);
  assert.deepEqual(MENU_GROUPS.map((g) => g.name), ['Minuman', 'Snack', 'Makanan Berat', 'Pastry & Dessert']);
  // kategori di MG_MENU tersusun per kelompok sesuai urutan → chip kategori searah dengan bagian menu
  const seq = MENU.map((c) => MENU_GROUPS.findIndex((g) => g.id === c.group));
  assert.ok(seq.every((x) => x >= 0), 'setiap kategori punya kelompok yang dikenal');
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
  assert.deepEqual(MENU.filter((c) => c.group === 'pastry').map((c) => c.id), ['pastry', 'dessert']);
});

test('data POS lama: pastry & dessert di kelompok snack tetap tampil paling akhir', () => {
  // kelompok & nomor urut versi sebelumnya: makanan → snack/pastry/dessert → minuman
  const old = [['ramen', 'food'], ['pasta', 'food'], ['snack', 'snack'], ['pastry', 'snack'], ['dessert', 'snack'], ['coffee', 'drinks'], ['tea', 'drinks']]
    .map(([id, group], i) => ({ id, name: id, group, sort: i + 1 }));
  assert.equal(groupOf(old[3]), 'pastry');
  assert.equal(groupOf(old[2]), 'snack');
  assert.equal(groupOf({ id: 'x', group: '' }), 'other');
  const m = new Master({ settings: [], branches: [], categories: old, items: [], itemBranch: [], channels: [], payMethods: [], discounts: [], staff: [] });
  assert.deepEqual(m.categories.map((c) => c.id), ['coffee', 'tea', 'snack', 'ramen', 'pasta', 'pastry', 'dessert']);
  assert.equal([...old, { id: 'baru', name: 'Baru', group: 'zzz', sort: 0 }].sort(byMenuOrder).at(-1).id, 'baru', 'kelompok tak dikenal di akhir');
});

test('menu publik: harga cabang, habis, stok, opsi berharga, pajak', () => {
  const { MENU } = loadCustomerData();
  const { categories, items } = menuFromData(MENU, { demo: true }); // pastry & dessert stoknya dilacak
  const raw = {
    settings: [{ id: 'org', blockNoStock: true }],
    branches: [{ id: 'b1', code: 'B1', name: 'Satu', taxPct: 10, taxIncl: true, servicePct: 0, taxLabel: 'PB1', active: true }, { id: 'b2', code: 'B2', name: 'Dua', active: false }],
    categories: categories.map((c) => (c.id === 'salad' ? { ...c, active: false } : c)),
    items: items.map((i) => (i.id === 'takoyaki' ? { ...i, active: false } : i)),
    itemBranch: [{ id: 'b1:americano', branchId: 'b1', itemId: 'americano', price: 17500 }, { id: 'b1:gyu-don', branchId: 'b1', itemId: 'gyu-don', available: false }],
    channels: [{ id: 'dinein', type: 'dinein', markupPct: 0, active: true }],
  };
  const pm = publicMenu(raw, 'b1', { stock: { 'almond-croissant': 0, 'croissant-plain': 4 } });
  const all = pm.groups.flatMap((g) => g.cats.flatMap((c) => c.items));
  const get = (id) => all.find((i) => i.id === id);
  assert.deepEqual(pm.groups.map((g) => g.id), ['drinks', 'snack', 'food', 'pastry']);
  assert.deepEqual(pm.groups[0].cats.map((c) => c.id), ['essentials', 'signature', 'coffee', 'milk', 'tea', 'soda']);
  assert.equal(get('americano').price, 17500, 'harga khusus cabang');
  assert.equal(get('caffe-latte').price, 19000);
  assert.deepEqual(get('americano').notes, ['Iced · Large +4.000', 'Hot +2.000']);
  assert.deepEqual(get('mochaccino').notes, ['Iced · Large +4.000', 'Hot']);
  assert.deepEqual(get('mango-tea').notes, ['Large +4.000'], 'level gula & es tidak ditampilkan');
  assert.deepEqual(get('kopi-kelapa').notes, []);
  assert.equal(get('gyu-don').soldOut, true, 'ditandai habis di cabang');
  assert.equal(get('almond-croissant').soldOut, true, 'stok 0');
  assert.equal(get('croissant-plain').soldOut, false);
  assert.equal(get('matcha-croissant').soldOut, true, 'dilacak tanpa catatan stok = 0');
  assert.equal(get('takoyaki'), undefined, 'menu nonaktif disembunyikan');
  assert.ok(!pm.groups.some((g) => g.cats.some((c) => c.id === 'salad')), 'kategori nonaktif disembunyikan');
  assert.equal(pm.priceNote, 'Harga sudah termasuk PB1 10%.');
  assert.deepEqual(Object.keys(pm.branch).sort(), ['address', 'close', 'code', 'name', 'open', 'phone', 'tz']);
  assert.equal(publicMenu(raw, 'b2'), null, 'cabang nonaktif');
  // tanpa blokir stok: menu dilacak tetap tersedia; markup kanal dine-in ikut dihitung
  const pm2 = publicMenu({ ...raw, settings: [{ blockNoStock: false }], channels: [{ id: 'dinein', type: 'dinein', markupPct: 10, active: true }] }, 'b1', { stock: {} });
  const a2 = pm2.groups.flatMap((g) => g.cats.flatMap((c) => c.items));
  assert.equal(a2.find((i) => i.id === 'almond-croissant').soldOut, false);
  assert.equal(a2.find((i) => i.id === 'americano').price, channelPrice(17500, 10));
  assert.equal(priceNote({ taxPct: 11, taxIncl: false, servicePct: 5, taxLabel: 'PBJT' }), 'Harga belum termasuk PBJT 11%. Biaya layanan 5% ditambahkan saat pembayaran.');
  assert.equal(priceNote({ taxPct: 0 }), '');
  assert.deepEqual(optionNotes([{ id: 'x', type: 'multi', choices: [{ n: 'Extra shot', p: 5000 }, { n: 'Oat milk', p: 6000 }] }]), ['Extra shot +5.000', 'Oat milk +6.000']);
});
