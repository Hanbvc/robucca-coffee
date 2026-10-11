/* Bentuk data dari API publik (/public/*). Sumber: apps/api/src/modules/public. */
import type { TaxConfig } from '@robucca/core';

export interface Org {
  name: string;
  tagline: string | null;
  instagram: string | null;
  tiktok: string | null;
}

export interface AppConfig {
  org: Org;
  /** Masuk dengan WhatsApp (OTP) tersedia di server. */
  otpLogin: boolean;
}

export interface Branch {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  openTime: string | null;
  closeTime: string | null;
  lat: number | null;
  lng: number | null;
  acceptsPwa: boolean;
  acceptsDelivery: boolean;
  deliveryMaxKm: number | null;
  acceptsReservations: boolean;
  maxReservationGuests: number;
  reservationAreas: string[];
  taxLabel: string;
  taxRateBp: number;
  taxInclusive: boolean;
  qrisImageUrl?: string | null;
}

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  imageUrl: string | null;
}

export interface MenuGroup {
  id: string;
  name: string;
  selection: 'SINGLE' | 'MULTIPLE';
  isRequired: boolean;
  maxSelect: number | null;
  showWhenOptionIds: string[];
  options: MenuOption[];
}

export interface Product {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isSignature: boolean;
  price: number;
  available: boolean;
  modifierGroups: MenuGroup[];
}

export type GroupKey = 'DRINKS' | 'SNACK' | 'FOOD' | 'PASTRY';

export interface Category {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isSignature: boolean;
  group: GroupKey;
  quickNotes: string[];
  products: Product[];
}

export interface Menu {
  branch: Branch;
  taxConfig: TaxConfig;
  org: Org;
  categories: Category[];
}

export interface Banner {
  id: string;
  imageUrl: string;
  label: string;
  categoryId: string | null;
  objectPosition: string | null;
}

export interface Courier {
  code: string;
  name: string;
  provider: string;
  baseFee: number;
  perKmFee: number;
  minFee: number;
}

export interface PayOption {
  code: string;
  name: string;
  method: string | null;
  provider: string | null;
  online: boolean;
}

export type Stage = 'awaiting_payment' | 'scheduled' | 'received' | 'preparing' | 'ready' | 'on_delivery' | 'completed' | 'cancelled';

export interface OrderItem {
  id: string;
  productId: string | null;
  optionIds: string[];
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
  imageUrl: string | null;
  summary: string;
}

export interface OrderDelivery {
  status: string;
  courierCode: string;
  courierName: string;
  provider: string;
  recipientName: string;
  recipientPhone: string;
  addressText: string;
  addressNote: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  fee: number;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  trackingUrl: string | null;
  estimatedAt: string | null;
}

export interface PublicOrder {
  id: string;
  number: string;
  queueNumber: string | null;
  branch: { code: string; name: string };
  type: 'CLICK_COLLECT' | 'DELIVERY' | string;
  status: string;
  fulfillment: string | null;
  stage: Stage;
  payment: { code: string | null; name: string; online: boolean; state: 'paid' | 'pending' | 'void' | 'cashier' };
  customerName: string | null;
  customerPhone: string | null;
  pickupAt: string | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  version: number;
  items: OrderItem[];
  subtotal: number;
  discountTotal: number;
  serviceCharge: number;
  taxTotal: number;
  taxLabel: string;
  taxInclusive: boolean;
  deliveryFee: number;
  rounding: number;
  total: number;
  reservation: { id: string; code: string; reservedFor: string } | null;
  delivery: OrderDelivery | null;
  /** Hanya di daftar milik pelanggan (/public/me/orders). */
  accessToken?: string;
}

export type RsvStatus = 'PENDING' | 'CONFIRMED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';

export interface Reservation {
  id: string;
  code: string;
  name: string;
  phone: string;
  reservedFor: string;
  guests: number;
  area: string | null;
  occasion: string | null;
  note: string | null;
  status: RsvStatus;
  createdAt: string;
  branch: { code: string; name: string; address: string | null; timezone: string };
  preOrders: { id: string; number: string; total: number; status: string }[];
  accessToken?: string;
}

export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
}

export interface SavedAddress {
  id: string;
  label: string | null;
  addressText: string;
  addressNote: string | null;
  recipientName: string;
  recipientPhone: string;
  isDefault: boolean;
  lat: number;
  lng: number;
}
