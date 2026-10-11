/* Harga kanal, diskon, biaya layanan, pajak (PB1/PBJT), pembulatan, dan pembayaran.
   Fungsi murni: dihitung di kasir/PWA, lalu dihitung ulang server sebelum disimpan.
   Port dari pos/js/core/calc.js dengan persentase dalam basis poin. */
import { roundTo, type RoundingMode } from './money.js';

/** Harga kanal ojol dibulatkan ke atas ke kelipatan ini (Rp500). */
export const MARKUP_ROUND = 500;

/** Harga di kanal (GoFood/GrabFood/…): harga × (1 + markup) dibulatkan ke atas ke Rp500. */
export function channelPrice(base: number, markupBp: number): number {
  const m = Number(markupBp) || 0;
  if (!m) return base;
  return Math.ceil((base * (10000 + m)) / 10000 / MARKUP_ROUND - 1e-9) * MARKUP_ROUND;
}

// --- Diskon ------------------------------------------------------------------

export type DiscountType = 'PERCENT' | 'AMOUNT';

/** PERCENT: value dalam basis poin; AMOUNT: rupiah. */
export interface Discount {
  type: DiscountType;
  value: number;
}

/** Nominal diskon, dibatasi 0..base. */
export function discAmount(d: Discount | null | undefined, base: number): number {
  if (!d || base <= 0) return 0;
  const v = Number(d.value) || 0;
  const a = d.type === 'PERCENT' ? Math.round((base * Math.min(Math.max(v, 0), 10000)) / 10000) : Math.round(v);
  return Math.max(0, Math.min(a, base));
}

/** Membagi `amount` ke tiap bobot secara proporsional (sisa ke pecahan terbesar). Σ hasil = amount, hasil ≤ bobot. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0);
  if (!amount || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const out = raw.map((x) => Math.floor(x + 1e-9));
  let rest = amount - out.reduce((a, x) => a + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x + 1e-9), i] as const).sort((a, b) => b[0] - a[0]);
  while (rest > 0) {
    let moved = false;
    for (const [, i] of order) {
      if (rest <= 0) break;
      if (out[i]! < weights[i]!) {
        out[i]! += 1;
        rest -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

// --- Total pesanan ---------------------------------------------------------------

/** Konfigurasi pajak/servis/pembulatan; disalin ke setiap pesanan. */
export interface TaxConfig {
  taxRateBp: number;
  /** true = harga menu sudah termasuk pajak */
  taxInclusive: boolean;
  /** pajak juga dikenakan atas biaya layanan */
  taxOnService: boolean;
  serviceRateBp: number;
  roundingUnit: number;
  roundingMode: RoundingMode;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  taxRateBp: 0,
  taxInclusive: true,
  taxOnService: true,
  serviceRateBp: 0,
  roundingUnit: 100,
  roundingMode: 'DOWN',
};

export interface CalcLine {
  id: string;
  /** Harga satuan akhir (cabang + opsi + markup kanal). */
  unitPrice: number;
  quantity: number;
  discount?: Discount | null;
  voided?: boolean;
}

export interface CalcOrderInput {
  lines: CalcLine[];
  discount?: Discount | null;
  /** Ongkir delivery: di luar dasar pajak, ditambahkan setelah pembulatan tidak berlaku. */
  deliveryFee?: number;
}

export interface OrderTotals {
  items: number;
  gross: number;
  lineDiscount: number;
  orderDiscount: number;
  discount: number;
  /** gross − discount */
  sales: number;
  /** penjualan bersih tanpa pajak */
  net: number;
  service: number;
  tax: number;
  deliveryFee: number;
  rounding: number;
  total: number;
}

export interface LineAmount {
  id: string;
  gross: number;
  discount: number;
  amount: number;
}

/**
 * - Harga termasuk pajak: pajak = bagian pajak di dalam harga; total = harga setelah diskon (+ servis & pajaknya).
 * - Harga belum termasuk pajak: pajak = (penjualan + servis) × tarif.
 * Identitas: total = net + service + tax + deliveryFee + rounding.
 */
export function calcOrder(order: CalcOrderInput, cfgIn?: Partial<TaxConfig> | null): { totals: OrderTotals; amounts: LineAmount[] } {
  const cfg = { ...DEFAULT_TAX_CONFIG, ...(cfgIn ?? {}) };
  const taxBp = Math.max(0, Number(cfg.taxRateBp) || 0);
  const serviceBp = Math.max(0, Number(cfg.serviceRateBp) || 0);
  const lines = order.lines.filter((l) => !l.voided);

  let gross = 0;
  let lineDiscount = 0;
  let items = 0;
  const bases = lines.map((l) => {
    const g = Math.round(l.unitPrice) * l.quantity;
    const d = discAmount(l.discount, g);
    gross += g;
    lineDiscount += d;
    items += l.quantity;
    return g - d;
  });
  const sub = gross - lineDiscount;
  const orderDiscount = discAmount(order.discount, sub);
  const alloc = allocate(orderDiscount, bases);
  const sales = sub - orderDiscount;

  let net: number;
  let service: number;
  let tax: number;
  if (cfg.taxInclusive) {
    const taxItems = taxBp ? Math.round((sales * taxBp) / (10000 + taxBp)) : 0;
    net = sales - taxItems;
    service = Math.round((net * serviceBp) / 10000);
    tax = taxItems + (cfg.taxOnService ? Math.round((service * taxBp) / 10000) : 0);
  } else {
    net = sales;
    service = Math.round((net * serviceBp) / 10000);
    tax = Math.round(((net + (cfg.taxOnService ? service : 0)) * taxBp) / 10000);
  }
  const deliveryFee = Math.max(0, Math.round(order.deliveryFee ?? 0));
  const raw = net + service + tax;
  const rounded = roundTo(raw, cfg.roundingUnit, cfg.roundingMode);
  const total = rounded + deliveryFee;
  const amounts = lines.map((l, i) => {
    const g = Math.round(l.unitPrice) * l.quantity;
    return { id: l.id, gross: g, discount: g - bases[i]! + alloc[i]!, amount: bases[i]! - alloc[i]! };
  });
  return {
    totals: {
      items,
      gross,
      lineDiscount,
      orderDiscount,
      discount: lineDiscount + orderDiscount,
      sales,
      net,
      service,
      tax,
      deliveryFee,
      rounding: rounded - raw,
      total,
    },
    amounts,
  };
}

/** Konfigurasi dari cabang + pengaturan pusat. */
export function taxConfigFor(
  branch: { taxRateBp: number; taxInclusive: boolean; taxOnService: boolean; serviceRateBp: number },
  settings: { roundingUnit: number; roundingMode: RoundingMode },
): TaxConfig {
  return {
    taxRateBp: branch.taxRateBp,
    taxInclusive: branch.taxInclusive,
    taxOnService: branch.taxOnService,
    serviceRateBp: branch.serviceRateBp,
    roundingUnit: settings.roundingUnit || 1,
    roundingMode: settings.roundingMode,
  };
}

// --- Pembayaran ------------------------------------------------------------------

export interface PaymentInput {
  /** true untuk tunai: `tendered` = uang diterima */
  cash: boolean;
  amount: number;
  tendered?: number | null;
}

export function paySummary(total: number, payments: PaymentInput[]): { applied: number; remaining: number; change: number; tendered: number } {
  const applied = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const tendered = payments.reduce((a, p) => a + (p.cash ? Number(p.tendered ?? p.amount) || 0 : Number(p.amount) || 0), 0);
  return { applied, remaining: Math.max(0, total - applied), change: Math.max(0, tendered - total), tendered };
}

/** Saran nominal uang tunai: uang pas, lalu pecahan berikutnya yang lazim. */
export function cashSuggestions(amount: number): number[] {
  if (amount <= 0) return [];
  const out = new Set([amount]);
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(amount / step) * step;
    if (v > amount) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** Pecahan uang untuk hitung kas saat tutup shift. */
export const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const;

export const countDenominations = (counts: Record<string, number>): number =>
  Object.entries(counts).reduce((a, [d, n]) => a + Number(d) * (Math.max(0, Math.floor(Number(n) || 0))), 0);
