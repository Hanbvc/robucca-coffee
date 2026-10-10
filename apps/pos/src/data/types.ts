/* Bentuk data: master dari GET /pos/master, dan dokumen transaksi lokal perangkat. */
import type { DiscountType, OrderTotals, RoundingMode, TaxConfig } from '@robucca/core';

export type Station = 'BAR' | 'KITCHEN' | 'NONE';
export type RoleCode = 'SUPER_ADMIN' | 'BRANCH_MANAGER' | 'CASHIER' | 'KITCHEN';
export type PaymentMethod = 'CASH' | 'QRIS' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'E_WALLET' | 'VIRTUAL_ACCOUNT' | 'BANK_TRANSFER';
export type ChannelType = 'DINE_IN' | 'TAKEAWAY' | 'FOOD_PLATFORM';

/* ---------- master ---------- */
export interface MBranch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  dayStartMinute: number;
  openTime: string | null;
  closeTime: string | null;
  taxLabel: string;
  taxRateBp: number;
  taxInclusive: boolean;
  serviceRateBp: number;
  taxOnService: boolean;
  receiptPaperMm: number;
  receiptFooter: string | null;
}

export interface MSettings {
  orgName: string;
  tagline: string | null;
  instagram: string | null;
  roundingUnit: number;
  roundingMode: RoundingMode;
  maxCashierDiscountBp: number;
  autoLockMinutes: number;
  autoPrintReceipt: boolean;
  blockSaleWhenOutOfStock: boolean;
  kdsWarnMinutes: number;
  kdsLateMinutes: number;
  receiptFooter: string | null;
}

export interface MOption {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  imageUrl: string | null;
}

export interface MGroup {
  id: string;
  name: string;
  selection: 'SINGLE' | 'MULTIPLE';
  isRequired: boolean;
  maxSelect: number | null;
  showWhenOptionIds: string[];
  options: MOption[];
}

export interface MProduct {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  station: Station;
  isSignature: boolean;
  basePrice: number;
  price: number;
  available: boolean;
  outOfStock: boolean;
  modifierGroups: MGroup[];
}

export interface MCategory {
  id: string;
  name: string;
  group: string;
  station: Station;
  quickNotes: string[];
  sortOrder: number;
  products: MProduct[];
}

export interface MChannel {
  id: string;
  code: string;
  name: string;
  type: ChannelType;
  markupBp: number;
  sortOrder: number;
  isActive: boolean;
}

export interface MPayOption {
  id: string;
  code: string;
  name: string;
  method: PaymentMethod;
  provider: string | null;
  requiresReference: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface MPromo {
  id: string;
  name: string;
  type: DiscountType;
  value: number;
  requiresApproval: boolean;
  validFrom: string | null;
  validUntil: string | null;
}

export interface MStaff {
  id: string;
  name: string;
  /** null untuk penyetuju (manajer/pemilik) di mode server: hash PIN-nya tidak dikirim ke perangkat. */
  pinHash: string | null;
  /** true = hanya bisa login & menyetujui saat perangkat online (PIN diperiksa server). */
  onlineOnly?: boolean;
  role: RoleCode;
  permissions: string[];
}

export interface MasterSnapshot {
  settings: MSettings | null;
  branch: MBranch | null;
  menu: MCategory[];
  channels: MChannel[];
  paymentOptions: MPayOption[];
  promotions: MPromo[];
  staff: MStaff[];
}

/* ---------- perangkat ---------- */
export interface DeviceInfo {
  mode: 'demo' | 'server';
  id: string;
  name: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  terminalNo: number;
  serverUrl?: string;
  token?: string;
  pairedAt: number;
}

/* ---------- transaksi lokal ---------- */
export interface LineDisc {
  type: DiscountType;
  /** PERCENT: basis poin; AMOUNT: rupiah */
  value: number;
  promotionId?: string;
  approvedById?: string;
  approvedByName?: string;
}

export interface LineVoid {
  reason: string;
  byId: string;
  byName: string;
  at: number;
  /** token persetujuan server (item yang sudah dikirim ke dapur/bar) */
  approval?: string;
}

export interface Line {
  id: string;
  productId: string;
  name: string;
  qty: number;
  /** harga satuan akhir (cabang + opsi + markup kanal) */
  unitPrice: number;
  optionIds: string[];
  /** ringkasan opsi untuk struk/dapur */
  sum: string;
  note: string;
  station: Station;
  disc: LineDisc | null;
  /** waktu dikirim ke dapur/bar (ms) */
  kAt: number | null;
  voided: LineVoid | null;
}

export interface OrderDiscount {
  type: DiscountType;
  value: number;
  name: string;
  promotionId?: string | null;
  byId?: string;
  approvedById?: string;
  approvedByName?: string;
}

export interface Pay {
  id: string;
  /** kode PaymentOption, mis. "cash" */
  code: string;
  name: string;
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  ref?: string;
  at: number;
}

export type OrderStatus = 'DRAFT' | 'OPEN' | 'AWAITING_PAYMENT' | 'PAID' | 'VOIDED' | 'REFUNDED';

export interface Order {
  id: string;
  number: string;
  queueNo: string;
  branchId: string;
  deviceId: string | null;
  terminalNo: number | null;
  source: 'POS' | 'PWA';
  /** DINE_IN | TAKEAWAY | FOOD_PLATFORM | CLICK_COLLECT | DELIVERY (atau tipe lain dari PWA) */
  type: string;
  channelCode: string | null;
  channelName: string;
  status: OrderStatus;
  fulfillment: string | null;
  table: string;
  customerName: string;
  customerPhone: string;
  note: string;
  platformOrderRef: string;
  lines: Line[];
  discount: OrderDiscount | null;
  /** token persetujuan diskon dari /pos/approve (online) */
  discountApproval?: string;
  cfg: TaxConfig;
  markupBp: number;
  deliveryFee: number;
  totals: OrderTotals;
  payments: Pay[];
  change: number;
  createdAt: number;
  paidAt: number | null;
  pickupAt: number | null;
  bizDate: string;
  shiftId: string | null;
  cashierId: string | null;
  cashierName: string;
  voidReason?: string;
  voidedById?: string;
  voidedByName?: string;
  voidedAt?: number;
  voidApproval?: string;
  /** waktu token persetujuan dibuat (token server berlaku 5 menit) */
  approvalAt?: number;
  refund?: { amount: number; reason: string; at: number; shiftId: string | null; byName?: string };
  /** naik setiap perubahan (urutan sinkron; bukan jam perangkat) */
  version: number;
  updatedAt: number;
  demo?: boolean;
  /** pesan bila server menolak dokumen ini */
  syncError?: string;
}

export interface Shift {
  id: string;
  branchId: string;
  deviceId: string;
  terminalNo: number;
  bizDate: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: number;
  openedById: string;
  openedByName: string;
  openingCash: number;
  closedAt?: number;
  closedById?: string;
  closedByName?: string;
  countedCash?: number;
  countedDenominations?: Record<string, number> | null;
  expectedCash?: number;
  differenceNote?: string;
  version: number;
  updatedAt: number;
  demo?: boolean;
  syncError?: string;
}

export interface CashMove {
  id: string;
  branchId: string;
  shiftId: string;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: number;
  reason: string;
  createdById: string;
  createdByName: string;
  createdAt: number;
  version: number;
  updatedAt: number;
  demo?: boolean;
}

export interface KitchenMark {
  /** `${orderId}:${lineId}` */
  id: string;
  orderId: string;
  lineId: string;
  branchId: string;
  done: boolean;
  at: number;
  byName?: string;
  version: number;
  updatedAt: number;
}

export interface AuditDoc {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  detail: Record<string, unknown>;
  at: number;
  version: number;
  updatedAt: number;
}

export interface SyncErrorEntry {
  coll: string;
  id: string;
  label: string;
  errors: string[];
  at: number;
}

export type { OrderTotals, TaxConfig };
