/* Bentuk respons /office/* yang dipakai layar kantor (lihat apps/api/docs/office-api.md). Waktu = string ISO. */
import type { DateRange } from '@robucca/core';

export interface Kpi {
  orders: number; refunds: number; refundTotal: number; voids: number; voidTotal: number; gross: number; discount: number; net: number;
  service: number; tax: number; deliveryFee: number; rounding: number; total: number; items: number; salesTotal: number; avg: number;
}
export interface HourRow { hour: number; total: number; orders: number; items: number; net: number; discount: number; salesTotal: number }
export interface DayRow { date: string; total: number; net: number; orders: number; tax: number }
export interface SlimDoc { id: string; kind: 'void' | 'refund'; number: string; branchId: string; bizDate: string; at: string; total: number; reason: string; by: string; wasPaid: boolean }
export interface Report {
  range: DateRange;
  kpi: Kpi;
  days: DayRow[];
  hours: HourRow[];
  branches: { id: string; code: string; name: string; total: number; net: number; orders: number; items: number }[];
  payments: { code: string; method: string; name: string; amount: number; count: number }[];
  channels: { id: string; code: string; name: string; total: number; orders: number }[];
  items: { id: string; name: string; categoryId: string | null; categoryName: string; qty: number; gross: number; disc: number; amount: number }[];
  categories: { id: string; name: string; qty: number; amount: number }[];
  cashiers: { id: string; name: string; total: number; orders: number }[];
  discounts: { name: string; count: number; amount: number }[];
  voids: SlimDoc[];
  refunds: SlimDoc[];
}
export interface BranchStatus {
  branchId: string; code: string; name: string; today: string; total: number; orders: number; openBills: number; openShifts: number;
  lastActivity: string | null; lastSeen: string | null;
}
type KpiKey = 'total' | 'orders' | 'avg' | 'items' | 'discount' | 'net';
export interface Dashboard {
  range: DateRange;
  prevRange: DateRange;
  today: string;
  live: boolean;
  compareLabel: string;
  current: Report;
  previous: { kpi: Kpi; days: DayRow[]; hours: HourRow[] };
  comparison: { previous: Pick<Kpi, KpiKey>; deltaPct: Record<KpiKey, number | null> };
  dailyAverage: number;
  topItems: Report['items'];
  branchStatus: BranchStatus[];
}

export interface Totals { items: number; gross: number; discount: number; net: number; service: number; tax: number; deliveryFee: number; rounding: number; total: number }
export interface TxRow {
  id: string; number: string; queueNumber: string | null; branchId: string; branchCode: string; branchName: string; terminalNo: number | null;
  source: string; type: string; status: string; fulfillment: string | null; businessDate: string; createdAt: string; paidAt: string | null;
  voidedAt: string | null; voidReason: string | null; tableNumber: string | null; customerName: string | null; platformOrderRef: string | null;
  shiftId: string | null; cashierId: string | null; cashierName: string | null; channelCode: string | null; channelName: string | null; discountName: string | null;
  totals: Totals;
  payments: { code: string; name: string; method: string; amount: number; reference: string | null }[];
  refund: { amount: number; reason: string; createdAt: string; approvedBy: string; processedBy: string } | null;
}
export interface TxList { range: DateRange; total: number; limit: number; offset: number; summary: { paidCount: number; paidTotal: number }; rows: TxRow[] }
export interface TxDetail {
  id: string; number: string; queueNumber: string | null; status: string; type: string; source: string; businessDate: string; createdAt: string; paidAt: string | null;
  tableNumber: string | null; customerName: string | null; customerPhone: string | null; note: string | null; platformOrderRef: string | null; discountNote: string | null;
  voidedAt: string | null; voidReason: string | null;
  branch: { code: string; name: string; timezone: string };
  device: { terminalNo: number; name: string } | null;
  cashier: { id: string; name: string } | null;
  channel: { code: string; name: string } | null;
  promotion: { id: string; name: string } | null;
  discountApprovedBy: { id: string; name: string } | null;
  voidedBy: { id: string; name: string } | null;
  refund: { amount: number; reason: string; createdAt: string; approvedBy: { name: string }; processedBy: { name: string } } | null;
  items: {
    id: string; productName: string; quantity: number; unitPrice: number; discountAmount: number; lineTotal: number; note: string | null; voidedAt: string | null; voidReason: string | null;
    modifiers: { groupName: string; optionName: string; priceDelta: number }[];
  }[];
  payments: { id: string; method: string; amount: number; tenderedAmount: number | null; changeAmount: number | null; reference: string | null; paidAt: string | null }[];
  totals: Totals;
  audit: { id: string; action: string; detail: Record<string, unknown> | null; createdAt: string; actor: { id: string; name: string } | null }[];
}

export interface ShiftSummary {
  count: number; refunds: number; voids: number; open: number; total: number; cashSales: number; cashRefunds: number; cashIn: number; cashOut: number;
  expected: number; byMethod: { code: string; method: string; name: string; amount: number; count: number }[];
}
export interface ShiftRow {
  id: string; branchId: string; branchCode: string; branchName: string; deviceId: string | null; terminalNo: number | null; deviceName: string | null;
  status: 'OPEN' | 'CLOSED'; businessDate: string; openedAt: string; openedBy: { id: string; name: string }; closedAt: string | null; closedBy: { id: string; name: string } | null;
  openingCash: number; expectedCash: number | null; countedCash: number | null; difference: number | null; differenceNote: string | null;
  countedDenominations: Record<string, number> | null; denominations: { value: number; count: number; subtotal: number }[]; denominationsTotal: number | null;
  summary: ShiftSummary | null;
}
export interface ShiftDetail extends ShiftRow {
  cashMovements: { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string | null; createdAt: string; createdBy: { id: string; name: string } | null }[];
  orders: TxRow[];
}
