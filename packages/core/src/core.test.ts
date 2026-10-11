/* Port tes tests/core.test.js (POS lama): angka yang sama harus menghasilkan total yang sama. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rp, num, parse, roundTo, short, bpLabel,
  channelPrice, calcOrder, allocate, discAmount, paySummary, cashSuggestions, countDenominations,
  defaultSelection, chosenModifiers, modifiersSummary, selectionErrors, unitPrice, lineKey, productImage, optionNotes,
  businessDate, businessHour, presetRange, prevRange, addDays, zonedEpoch, daysBetween, dayDiff,
  receiptNo, queueNo, uuidv7, UUID_RE, randDigits, randCode, validBranchCode, normalizePhone,
  type CalcLine, type MenuProduct, type TaxConfig,
} from './index.js';

test('format & parse rupiah', () => {
  assert.equal(rp(87000), 'Rp87.000');
  assert.equal(rp(-5000), '-Rp5.000');
  assert.equal(num(1234567), '1.234.567');
  assert.equal(parse('Rp 100.000'), 100000);
  assert.equal(parse('-2.500'), -2500);
  assert.equal(short(1250000), '1,3 jt');
  assert.equal(short(87000), '87 rb');
  assert.equal(bpLabel(250), '2,5%');
});

test('pembulatan', () => {
  assert.equal(roundTo(84315, 100, 'DOWN'), 84300);
  assert.equal(roundTo(84350, 100, 'NEAREST'), 84400);
  assert.equal(roundTo(84301, 100, 'UP'), 84400);
  assert.equal(roundTo(84300, 100, 'UP'), 84300);
  assert.equal(roundTo(1234.6, 1), 1235);
});

const L = (id: string, unitPrice: number, quantity = 1, extra: Partial<CalcLine> = {}): CalcLine => ({ id, unitPrice, quantity, ...extra });
const cfg = (c: Partial<TaxConfig>): Partial<TaxConfig> => c;

test('harga kanal dengan markup dibulatkan ke atas Rp500', () => {
  assert.equal(channelPrice(35000, 0), 35000);
  assert.equal(channelPrice(35000, 2000), 42000);
  assert.equal(channelPrice(15500, 2500), 19500);
  assert.equal(channelPrice(20000, 2000), 24000);
});

test('pajak termasuk harga (PB1 10%) tidak mengubah total', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, cfg({ taxRateBp: 1000, taxInclusive: true, roundingUnit: 100, roundingMode: 'DOWN' }));
  assert.deepEqual(totals, { items: 3, gross: 73000, lineDiscount: 0, orderDiscount: 0, discount: 0, sales: 73000, net: 66364, service: 0, tax: 6636, deliveryFee: 0, rounding: 0, total: 73000 });
});

test('diskon pesanan 10% + pajak termasuk', () => {
  const { totals, amounts } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)], discount: { type: 'PERCENT', value: 1000 } }, cfg({ taxRateBp: 1000, taxInclusive: true }));
  assert.equal(totals.orderDiscount, 7300);
  assert.equal(totals.total, 65700);
  assert.equal(totals.tax, 5973);
  assert.equal(totals.net, 59727);
  assert.equal(amounts.reduce((a, x) => a + x.amount, 0), 65700);
});

test('pajak di luar harga + servis 5% + pembulatan ke bawah', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, cfg({ taxRateBp: 1000, taxInclusive: false, serviceRateBp: 500, roundingUnit: 100, roundingMode: 'DOWN' }));
  assert.equal(totals.service, 3650);
  assert.equal(totals.tax, 7665);
  assert.equal(totals.total, 84300);
  assert.equal(totals.rounding, -15);
});

test('pajak termasuk + servis', () => {
  const { totals } = calcOrder({ lines: [L('a', 35000), L('b', 19000, 2)] }, cfg({ taxRateBp: 1000, taxInclusive: true, serviceRateBp: 500, roundingUnit: 100, roundingMode: 'DOWN' }));
  assert.equal(totals.service, 3318);
  assert.equal(totals.tax, 6636 + 332);
  assert.equal(totals.total, 76600);
});

test('servis tidak kena pajak', () => {
  const { totals } = calcOrder({ lines: [L('a', 100000)] }, cfg({ taxRateBp: 1000, taxInclusive: false, serviceRateBp: 500, taxOnService: false, roundingUnit: 1 }));
  assert.equal(totals.tax, 10000);
  assert.equal(totals.total, 115000);
});

test('ongkir delivery di luar pajak & pembulatan', () => {
  const { totals } = calcOrder({ lines: [L('a', 24000)], deliveryFee: 12500 }, cfg({ taxRateBp: 1000, taxInclusive: true, roundingUnit: 100 }));
  assert.equal(totals.total, 36500);
  assert.equal(totals.tax, 2182);
});

test('identitas total = net + servis + pajak + ongkir + pembulatan (acak)', () => {
  let s = 42;
  const r = (): number => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  for (let n = 0; n < 2000; n++) {
    const lines = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) =>
      L('x' + i, Math.round(r() * 80) * 500, 1 + Math.floor(r() * 4),
        r() < 0.2 ? { discount: r() < 0.5 ? { type: 'PERCENT', value: Math.round(r() * 5000) } : { type: 'AMOUNT', value: Math.round(r() * 20000) } } : {}));
    const order = { lines, discount: r() < 0.3 ? { type: 'PERCENT' as const, value: Math.round(r() * 3000) } : null, deliveryFee: r() < 0.2 ? 12000 : 0 };
    const c = cfg({ taxRateBp: pick([0, 1000, 1100]), taxInclusive: r() < 0.5, serviceRateBp: pick([0, 500, 750]), roundingUnit: pick([1, 100, 500]), roundingMode: pick(['DOWN', 'NEAREST', 'UP'] as const) });
    const { totals: t, amounts } = calcOrder(order, c);
    assert.equal(t.total, t.net + t.service + t.tax + t.deliveryFee + t.rounding);
    assert.equal(t.sales, t.gross - t.discount);
    assert.equal(amounts.reduce((a, x) => a + x.amount, 0), t.sales);
    assert.ok(amounts.every((x) => x.amount >= 0));
    assert.ok((t.total - t.deliveryFee) % (c.roundingUnit || 1) === 0);
  }
});

test('alokasi & batas diskon, baris void diabaikan', () => {
  assert.deepEqual(allocate(7300, [35000, 38000]), [3500, 3800]);
  assert.ok(allocate(2, [1, 1, 1]).every((x) => x <= 1));
  assert.equal(discAmount({ type: 'PERCENT', value: 15000 }, 10000), 10000);
  assert.equal(discAmount({ type: 'AMOUNT', value: -5 }, 10000), 0);
  const { totals } = calcOrder({ lines: [L('a', 10000), L('b', 5000, 1, { voided: true })] });
  assert.equal(totals.total, 10000);
  assert.equal(totals.items, 1);
});

test('pembayaran, saran tunai, hitung pecahan', () => {
  assert.deepEqual(paySummary(87000, [{ cash: false, amount: 30000 }, { cash: true, amount: 57000, tendered: 100000 }]), { applied: 87000, remaining: 0, change: 43000, tendered: 130000 });
  assert.deepEqual(cashSuggestions(87000), [87000, 90000, 100000]);
  assert.deepEqual(cashSuggestions(15500), [15500, 20000, 50000, 100000]);
  assert.equal(countDenominations({ 100000: 3, 50000: 1, 500: 2 }), 351000);
});

const latte: MenuProduct = {
  id: 'caffe-latte', name: 'Caffe Latte', price: 19000, imageUrl: 'latte.jpg',
  modifierGroups: [
    { id: 'size', name: 'Penyajian & ukuran', selection: 'SINGLE', isRequired: true, showWhenOptionIds: [], options: [
      { id: 'ir', name: 'Iced · Regular', priceDelta: 0, isDefault: true },
      { id: 'il', name: 'Iced · Large', priceDelta: 4000, isDefault: false },
      { id: 'hot', name: 'Hot', priceDelta: 2000, isDefault: false, imageUrl: 'latte-hot.jpg' },
    ] },
    { id: 'sugar', name: 'Level Gula', selection: 'SINGLE', isRequired: false, showWhenOptionIds: [], options: [
      { id: 'n', name: 'Normal', priceDelta: 0, isDefault: true },
      { id: 'less', name: 'Less Sugar', priceDelta: 0, isDefault: false },
    ] },
    { id: 'ice', name: 'Level Es', selection: 'SINGLE', isRequired: false, showWhenOptionIds: ['ir', 'il'], options: [
      { id: 'ni', name: 'Normal Ice', priceDelta: 0, isDefault: true },
      { id: 'li', name: 'Less Ice', priceDelta: 0, isDefault: false },
    ] },
  ],
};

test('opsi menu: bawaan, grup bersyarat, ringkasan, wajib, harga, foto', () => {
  const sel = defaultSelection(latte);
  assert.deepEqual(sel, { size: ['ir'], sugar: ['n'], ice: ['ni'] });
  const large = { ...sel, size: ['il'], sugar: ['less'] };
  assert.equal(unitPrice(latte, large), 23000);
  assert.equal(modifiersSummary(latte, chosenModifiers(latte, large)), 'Iced · Large · Less Sugar');
  const hot = { ...sel, size: ['hot'], ice: ['li'] };
  assert.deepEqual(chosenModifiers(latte, hot).map((m) => m.optionName), ['Hot', 'Normal']);
  assert.equal(modifiersSummary(latte, chosenModifiers(latte, hot)), 'Hot');
  assert.equal(productImage(latte, hot), 'latte-hot.jpg');
  assert.deepEqual(selectionErrors(latte, { sugar: ['n'] }), ['Penyajian & ukuran wajib dipilih']);
  assert.deepEqual(selectionErrors(latte, { ...sel, size: ['ir', 'il'] }), ['Penyajian & ukuran: pilih satu']);
  assert.equal(unitPrice({ ...latte, price: 20000 }, sel, 2000), 24000);
  assert.notEqual(lineKey('x', large, '', 23000), lineKey('x', sel, '', 19000));
  assert.equal(lineKey('x', { b: ['2', '1'], a: [] }, ' Pedas', 1), lineKey('x', { a: [], b: ['1', '2'] }, 'pedas', 1));
  assert.deepEqual(optionNotes(latte), ['Iced · Large +4.000', 'Hot +2.000']);
});

test('tanggal bisnis per zona waktu & jam pergantian hari', () => {
  const ts = Date.UTC(2026, 9, 6, 17, 30); // 7 Okt 00.30 WIB
  assert.equal(businessDate(ts, 'Asia/Jakarta'), '2026-10-07');
  assert.equal(businessDate(ts, 'Asia/Jakarta', 240), '2026-10-06');
  assert.equal(businessDate(Date.UTC(2026, 9, 6, 16, 30), 'Asia/Makassar'), '2026-10-07');
  assert.equal(businessHour(ts, 'Asia/Jakarta'), 0);
  assert.equal(zonedEpoch('2026-10-07', '00:30', 'Asia/Jakarta'), ts);
});

test('rentang preset & pembanding', () => {
  assert.deepEqual(presetRange('7d', '2026-10-06'), { from: '2026-09-30', to: '2026-10-06' });
  assert.deepEqual(presetRange('lastmonth', '2026-03-15'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(prevRange({ from: '2026-10-01', to: '2026-10-06' }), { from: '2026-09-25', to: '2026-09-30' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-02-27', '2026-03-02').length, 4);
  assert.equal(dayDiff('2026-10-01', '2026-10-06'), 5);
});

test('nomor struk, antrean, uuidv7, kode, telepon', () => {
  assert.equal(receiptNo('IJN', 1, '2026-10-06', 42), 'IJN1-261006-0042');
  assert.equal(queueNo(1, 7), '007');
  assert.equal(queueNo(2, 7), 'B007');
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_000_001);
  assert.match(a, UUID_RE);
  assert.equal(a[14], '7');
  assert.ok(a < b, 'uuidv7 urut waktu');
  assert.match(randDigits(6), /^\d{6}$/);
  assert.match(randCode(4), /^[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(validBranchCode('IJN') && validBranchCode('CB2') && !validBranchCode('ijn') && !validBranchCode('TOOLONG'));
  assert.equal(normalizePhone('0812-0000-1234'), '6281200001234');
  assert.equal(normalizePhone('+62 812 0000 1234'), '6281200001234');
  assert.equal(normalizePhone('12345'), null);
});
