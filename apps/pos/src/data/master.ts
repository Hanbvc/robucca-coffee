/* Data master (menu, kanal, metode bayar, promo, staf) dengan indeks siap pakai untuk tampilan. */
import { taxConfigFor, type MenuProduct, type TaxConfig } from '@robucca/core';
import type {
  MBranch, MCategory, MChannel, MPayOption, MProduct, MPromo, MSettings, MStaff, MasterSnapshot, RoleCode,
} from './types';

export const DEFAULT_SETTINGS: MSettings = {
  orgName: 'Robucca',
  tagline: null,
  instagram: null,
  roundingUnit: 100,
  roundingMode: 'DOWN',
  maxCashierDiscountBp: 1000,
  autoLockMinutes: 0,
  autoPrintReceipt: false,
  blockSaleWhenOutOfStock: true,
  kdsWarnMinutes: 8,
  kdsLateMinutes: 15,
  receiptFooter: null,
};

export const ROLES: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Pemilik',
  BRANCH_MANAGER: 'Manajer',
  CASHIER: 'Kasir',
  KITCHEN: 'Dapur / Bar',
};
export const roleName = (r: string): string => ROLES[r as RoleCode] ?? r;

/** Hak akses tampilan POS → hak akses server (salah satu cukup). */
const PERMS = {
  sell: ['order.sell'],
  kds: ['kds.view', 'order.sell'],
  office: ['report.view'],
  'approve.void': ['order.void.approve'],
  'approve.refund': ['order.refund.approve'],
  'approve.discount': ['discount.approve'],
  soldout: ['menu.availability'],
  shift: ['shift.open', 'shift.manage', 'order.sell'],
  cash: ['cash.manage'],
} as const;
export type Perm = keyof typeof PERMS;
/** Hak server untuk tiap jenis persetujuan PIN. */
export const APPROVE_PERM = {
  void: 'order.void.approve',
  refund: 'order.refund.approve',
  discount: 'discount.approve',
} as const;
export type ApproveKind = keyof typeof APPROVE_PERM;

export function can(staff: Pick<MStaff, 'permissions'> | null | undefined, perm: Perm | string): boolean {
  if (!staff) return false;
  const p = staff.permissions ?? [];
  if (p.includes('*')) return true;
  const need = (PERMS as Record<string, readonly string[]>)[perm] ?? [perm];
  return need.some((x) => p.includes(x));
}

const COLORS = ['#01512C', '#9A6A3B', '#2F6E8F', '#8A3B5C', '#5B6B2E', '#B5651D', '#4E4A8C', '#2E7D6B'];
export function staffColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

const CHANNEL_TYPE_NAMES: Record<string, string> = {
  DINE_IN: 'Dine In',
  TAKEAWAY: 'Take Away',
  FOOD_PLATFORM: 'Ojol',
  CLICK_COLLECT: 'Pick Up (aplikasi)',
  PICKUP: 'Pick Up (aplikasi)',
  DELIVERY: 'Delivery (aplikasi)',
};
export const typeName = (t: string): string => CHANNEL_TYPE_NAMES[t] ?? t;

export class Master {
  readonly raw: MasterSnapshot;
  readonly settings: MSettings;
  readonly branch: MBranch | null;
  readonly categories: MCategory[];
  readonly products: MProduct[];
  private readonly productMap: Map<string, MProduct>;
  private readonly productCat: Map<string, MCategory>;
  readonly channels: MChannel[];
  readonly payOptions: MPayOption[];
  readonly promotions: MPromo[];
  readonly staff: MStaff[];
  private readonly people: Map<string, MStaff>;

  constructor(raw: MasterSnapshot, private readonly soldOut: Set<string> = new Set()) {
    this.raw = raw;
    this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
    this.branch = raw.branch;
    this.categories = [...(raw.menu ?? [])];
    this.products = this.categories.flatMap((c) => c.products);
    this.productMap = new Map(this.products.map((p) => [p.id, p]));
    this.productCat = new Map(this.categories.flatMap((c) => c.products.map((p) => [p.id, c] as const)));
    this.channels = [...(raw.channels ?? [])].filter((c) => c.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
    this.payOptions = [...(raw.paymentOptions ?? [])].filter((p) => p.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
    this.promotions = [...(raw.promotions ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'id'));
    this.staff = [...(raw.staff ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'id'));
    this.people = new Map(this.staff.map((s) => [s.id, s]));
  }

  withSoldOut(soldOut: Set<string>): Master {
    return new Master(this.raw, soldOut);
  }

  product(id: string): MProduct | undefined {
    return this.productMap.get(id);
  }
  categoryOf(productId: string): MCategory | undefined {
    return this.productCat.get(productId);
  }
  person(id: string | null | undefined): MStaff | undefined {
    return id ? this.people.get(id) : undefined;
  }
  /** Ditandai habis di perangkat ini (Kasir › Lainnya › Tandai menu habis). */
  isSoldOut(id: string): boolean {
    return this.soldOut.has(id);
  }
  available(p: MProduct): boolean {
    return p.available !== false && !this.soldOut.has(p.id);
  }
  blocked(p: MProduct): boolean {
    return !this.available(p) || (p.outOfStock && this.settings.blockSaleWhenOutOfStock !== false);
  }

  channel(code: string | null | undefined): MChannel | undefined {
    return code ? this.channels.find((c) => c.code === code) : undefined;
  }
  channelById(id: string | null | undefined): MChannel | undefined {
    return id ? (this.raw.channels ?? []).find((c) => c.id === id) : undefined;
  }
  platformCodes(): Set<string> {
    return new Set(this.channels.filter((c) => c.type === 'FOOD_PLATFORM').map((c) => c.code));
  }
  /** Metode bayar biasa (bukan "dibayar platform" ojol). */
  regularPays(): MPayOption[] {
    const plat = this.platformCodes();
    return this.payOptions.filter((p) => !plat.has(p.code));
  }
  pay(code: string): MPayOption | undefined {
    return (this.raw.paymentOptions ?? []).find((p) => p.code === code);
  }
  payById(id: string | null | undefined): MPayOption | undefined {
    return id ? (this.raw.paymentOptions ?? []).find((p) => p.id === id) : undefined;
  }
  promo(id: string | null | undefined): MPromo | undefined {
    return id ? this.promotions.find((p) => p.id === id) : undefined;
  }
  /** Promo yang berlaku sekarang. */
  activePromos(now = Date.now()): MPromo[] {
    return this.promotions.filter((p) => (!p.validFrom || Date.parse(p.validFrom) <= now) && (!p.validUntil || Date.parse(p.validUntil) >= now));
  }

  taxConfig(): TaxConfig {
    const b = this.branch;
    if (!b) return { taxRateBp: 0, taxInclusive: true, taxOnService: true, serviceRateBp: 0, roundingUnit: this.settings.roundingUnit, roundingMode: this.settings.roundingMode };
    return taxConfigFor(b, this.settings);
  }

  /** Staf yang boleh menyetujui (PIN) tindakan tertentu. */
  approvers(kind: ApproveKind): MStaff[] {
    return this.staff.filter((s) => can(s, APPROVE_PERM[kind]));
  }
}

/** Bentuk @robucca/core untuk fungsi opsi. */
export const menuOf = (p: MProduct): MenuProduct => ({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, modifierGroups: p.modifierGroups });
