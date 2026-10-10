/* Konversi dokumen lokal ↔ kontrak API (/pos/sync, /pos/feed). */
import { chosenModifiers, modifiersSummary, type DiscountType, type OrderTotals, type Selection } from '@robucca/core';
import { menuOf, typeName, type Master } from './master';
import type { AuditDoc, CashMove, KitchenMark, Line, Order, OrderStatus, Pay, PaymentMethod, Shift, Station } from './types';

const iso = (ms: number | null | undefined): string | undefined => (ms ? new Date(ms).toISOString() : undefined);
const opt = (s: string | null | undefined): string | undefined => {
  const v = (s ?? '').trim();
  return v ? v : undefined;
};

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'FOOD_PLATFORM', 'CLICK_COLLECT', 'DELIVERY'];
const FULFILLMENTS = ['RECEIVED', 'PREPARING', 'READY', 'COMPLETED'];

/* ---------- lokal → server ---------- */

export function toServerOrder(o: Order): Record<string, unknown> {
  const status = o.status === 'PAID' || o.status === 'REFUNDED' ? 'PAID' : o.status === 'VOIDED' ? 'VOIDED' : 'OPEN';
  const doc: Record<string, unknown> = {
    id: o.id,
    number: o.number,
    queueNumber: o.queueNo,
    type: ORDER_TYPES.includes(o.type) ? o.type : 'CLICK_COLLECT',
    channelCode: o.channelCode ?? undefined,
    tableNumber: opt(o.table),
    customerName: opt(o.customerName),
    customerPhone: opt(o.customerPhone),
    note: opt(o.note),
    platformOrderRef: opt(o.platformOrderRef),
    status,
    fulfillment: o.fulfillment && FULFILLMENTS.includes(o.fulfillment) ? o.fulfillment : undefined,
    createdAt: iso(o.createdAt),
    paidAt: status === 'PAID' || o.paidAt ? iso(o.paidAt) : undefined,
    shiftId: o.shiftId ?? undefined,
    cashierId: o.cashierId,
    version: Math.max(1, o.version),
    items: o.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      optionIds: l.optionIds,
      note: opt(l.note),
      discount: l.disc && l.disc.value > 0 ? { type: l.disc.type, value: l.disc.value } : undefined,
      promotionId: l.disc?.promotionId ?? undefined,
      sentToKitchenAt: iso(l.kAt),
      voided: l.voided ? { reason: l.voided.reason, byId: l.voided.byId || undefined, at: iso(l.voided.at), ...(l.voided.approval ? { approval: l.voided.approval } : {}) } : undefined,
    })),
    discount: o.discount && o.discount.value > 0 ? { type: o.discount.type, value: o.discount.value } : undefined,
    promotionId: o.discount?.promotionId ?? undefined,
    discountNote: opt(o.discount?.name),
    discountApproval: o.discountApproval || undefined,
    discountApprovedById: o.discount?.approvedById ?? o.lines.find((l) => l.disc?.approvedById)?.disc?.approvedById ?? undefined,
    payments: o.payments.map((p) => ({
      id: p.id,
      optionCode: p.code,
      amount: p.amount,
      tendered: p.method === 'CASH' ? (p.tendered ?? p.amount) : undefined,
      reference: opt(p.ref),
      at: iso(p.at),
    })),
    voidReason: status === 'VOIDED' ? o.voidReason : undefined,
    voidedById: status === 'VOIDED' ? o.voidedById : undefined,
    voidApproval: status === 'VOIDED' ? o.voidApproval || undefined : undefined,
    voidedAt: status === 'VOIDED' ? iso(o.voidedAt) : undefined,
  };
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>; // buang undefined
}

export const toServerShift = (s: Shift) =>
  JSON.parse(JSON.stringify({
    id: s.id,
    status: s.status,
    openedAt: iso(s.openedAt),
    openingCash: s.openingCash,
    openedById: s.openedById,
    closedAt: iso(s.closedAt),
    closedById: s.closedById,
    countedCash: s.countedCash,
    countedDenominations: s.countedDenominations ?? undefined,
    differenceNote: opt(s.differenceNote),
  })) as Record<string, unknown>;

export const toServerCash = (c: CashMove) => ({
  id: c.id, shiftId: c.shiftId, type: c.type, amount: c.amount, reason: c.reason, createdById: c.createdById, createdAt: iso(c.createdAt),
});

export const toServerKitchen = (k: KitchenMark) => ({ orderId: k.orderId, itemId: k.lineId, done: k.done, at: iso(k.at) });

export const toServerAudit = (a: AuditDoc) =>
  JSON.parse(JSON.stringify({ action: a.action, actorId: a.actorId ?? undefined, detail: a.detail, at: iso(a.at) })) as Record<string, unknown>;

/* ---------- server → lokal ---------- */

export interface FeedItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  note: string | null;
  station: Station;
  kitchenStatus: 'QUEUED' | 'DONE';
  sentToKitchenAt: string | null;
  kitchenDoneAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  promotionId: string | null;
  modifiers: { modifierOptionId: string; groupName: string; optionName: string; priceDelta: number }[];
}

export interface FeedOrder {
  id: string;
  number: string;
  queueNumber: string;
  source: 'POS' | 'PWA';
  type: string;
  status: Exclude<OrderStatus, 'DRAFT'>;
  fulfillment: string | null;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  pickupAt: string | null;
  platformOrderRef: string | null;
  channelId: string | null;
  channelMarkupBp: number;
  shiftId: string | null;
  cashierId: string | null;
  deviceId: string | null;
  promotionId: string | null;
  discountNote: string | null;
  subtotal: number;
  discountTotal: number;
  serviceCharge: number;
  taxTotal: number;
  deliveryFee: number;
  rounding: number;
  total: number;
  taxRateBp: number;
  taxInclusive: boolean;
  serviceRateBp: number;
  taxOnService: boolean;
  roundingUnit: number;
  roundingMode: 'DOWN' | 'NEAREST' | 'UP';
  createdAt: string;
  paidAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  version: number;
  businessDate: string;
  branchId?: string;
  items: FeedItem[];
  payments: { id: string; method: PaymentMethod; provider: string | null; amount: number; tenderedAmount: number | null; changeAmount: number | null; reference: string | null; paidAt: string | null; paymentOptionId: string | null }[];
  refund: { amount: number; reason: string; createdAt: string } | null;
}

const ms = (s: string | null | undefined): number | null => (s ? Date.parse(s) : null);

/** Pesanan dari feed → dokumen lokal. `prev` (salinan lokal) dipakai untuk mempertahankan detail diskon. */
export function fromServerOrder(row: FeedOrder, master: Master, branchId: string, prev: Order | null, terminalOf: (deviceId: string | null) => number | null): Order {
  const lines: Line[] = row.items.map((it) => {
    const p = master.product(it.productId);
    const optionIds = it.modifiers.map((m) => m.modifierOptionId);
    let sum = it.modifiers.map((m) => m.optionName).join(' · ');
    if (p) {
      const menu = menuOf(p);
      const sel: Selection = {};
      for (const g of p.modifierGroups) sel[g.id] = optionIds.filter((id) => g.options.some((o) => o.id === id));
      sum = modifiersSummary(menu, chosenModifiers(menu, sel));
    }
    const pl = prev?.lines.find((l) => l.id === it.id);
    const sent = ms(it.sentToKitchenAt) ?? (row.source === 'PWA' && it.station !== 'NONE' ? ms(row.createdAt) : null);
    return {
      id: it.id,
      productId: it.productId,
      name: it.productName,
      qty: it.quantity,
      unitPrice: it.unitPrice,
      optionIds,
      sum,
      note: it.note ?? '',
      station: it.station,
      disc: pl?.disc ?? null,
      kAt: sent,
      voided: it.voidedAt ? { reason: it.voidReason ?? '', byId: pl?.voided?.byId ?? '', byName: pl?.voided?.byName ?? '', at: ms(it.voidedAt)! } : null,
    };
  });

  let discount = prev?.discount ?? null;
  if (!prev && row.discountTotal > 0) {
    const promo = master.promo(row.promotionId);
    discount = promo
      ? { type: promo.type, value: promo.value, name: promo.name, promotionId: promo.id }
      : { type: 'AMOUNT' as DiscountType, value: row.discountTotal, name: row.discountNote ?? 'Diskon' };
  }

  const items = lines.filter((l) => !l.voided).reduce((a, l) => a + l.qty, 0);
  const lineDisc = lines.reduce((a, l) => a + (l.disc && !l.voided ? Math.min(l.unitPrice * l.qty, l.disc.type === 'PERCENT' ? Math.round((l.unitPrice * l.qty * l.disc.value) / 10000) : l.disc.value) : 0), 0);
  const tax = row.taxTotal;
  const totals: OrderTotals = {
    items,
    gross: row.subtotal,
    lineDiscount: lineDisc,
    orderDiscount: Math.max(0, row.discountTotal - lineDisc),
    discount: row.discountTotal,
    sales: row.subtotal - row.discountTotal,
    net: row.taxInclusive ? row.subtotal - row.discountTotal - (tax - Math.round((row.serviceCharge * (row.taxOnService ? row.taxRateBp : 0)) / 10000)) : row.subtotal - row.discountTotal,
    service: row.serviceCharge,
    tax,
    deliveryFee: row.deliveryFee,
    rounding: row.rounding,
    total: row.total,
  };

  const channel = master.channelById(row.channelId);
  const payments: Pay[] = row.payments.map((p) => {
    const o = master.payById(p.paymentOptionId);
    return {
      id: p.id,
      code: o?.code ?? p.provider ?? p.method.toLowerCase(),
      name: o?.name ?? p.provider ?? p.method,
      method: p.method,
      amount: p.amount,
      ...(p.tenderedAmount != null ? { tendered: p.tenderedAmount } : {}),
      ...(p.reference ? { ref: p.reference } : {}),
      at: ms(p.paidAt) ?? ms(row.paidAt) ?? Date.now(),
    };
  });
  const change = row.payments.reduce((a, p) => a + (p.changeAmount ?? 0), 0);
  const cashier = master.person(row.cashierId);

  return {
    id: row.id,
    number: row.number,
    queueNo: row.queueNumber,
    branchId,
    deviceId: row.deviceId,
    terminalNo: terminalOf(row.deviceId) ?? prev?.terminalNo ?? null,
    source: row.source,
    type: row.type,
    channelCode: channel?.code ?? null,
    channelName: channel?.name ?? typeName(row.type),
    status: row.status,
    fulfillment: row.fulfillment,
    table: row.tableNumber ?? '',
    customerName: row.customerName ?? '',
    customerPhone: row.customerPhone ?? '',
    note: row.note ?? '',
    platformOrderRef: row.platformOrderRef ?? '',
    lines,
    discount,
    cfg: {
      taxRateBp: row.taxRateBp,
      taxInclusive: row.taxInclusive,
      serviceRateBp: row.serviceRateBp,
      taxOnService: row.taxOnService,
      roundingUnit: row.roundingUnit,
      roundingMode: row.roundingMode,
    },
    markupBp: row.channelMarkupBp,
    deliveryFee: row.deliveryFee,
    totals,
    payments,
    change,
    createdAt: ms(row.createdAt)!,
    paidAt: ms(row.paidAt),
    pickupAt: ms(row.pickupAt),
    bizDate: String(row.businessDate).slice(0, 10),
    shiftId: row.shiftId,
    cashierId: row.cashierId,
    cashierName: cashier?.name ?? prev?.cashierName ?? '',
    ...(row.voidReason ? { voidReason: row.voidReason } : {}),
    ...(row.voidedAt ? { voidedAt: ms(row.voidedAt)!, voidedById: prev?.voidedById ?? '', voidedByName: prev?.voidedByName ?? '' } : {}),
    ...(row.refund
      ? { refund: { amount: row.refund.amount, reason: row.refund.reason, at: ms(row.refund.createdAt)!, shiftId: prev?.refund?.shiftId ?? null, ...(prev?.refund?.byName ? { byName: prev.refund.byName } : {}) } }
      : {}),
    version: row.version,
    updatedAt: Date.now(),
  };
}
