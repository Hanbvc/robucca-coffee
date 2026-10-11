/* Klien API publik. Semua permintaan dari browser ke NEXT_PUBLIC_API_URL (CORS).
   Token pelanggan (masuk WhatsApp) dikirim sebagai X-Customer-Token; pesanan/reservasi tamu memakai token aksesnya sendiri. */
import { API_URL } from './env';
import { getState, setState } from './store';
import type {
  AppConfig, Banner, Branch, Courier, Customer, Menu, PayOption, PublicOrder, Reservation, SavedAddress,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Pesan ramah untuk pengguna dari galat apa pun. */
export const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Terjadi kesalahan, coba lagi.');

interface Opts {
  body?: unknown;
  headers?: Record<string, string>;
  /** Kirim token pelanggan bila sudah masuk. */
  auth?: boolean;
  timeout?: number;
}

async function req<T>(method: string, path: string, o: Opts = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeout ?? 15000);
  const token = o.auth ? getState().auth?.token : undefined;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-customer-token': token } : {}),
        ...o.headers,
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Tidak bisa terhubung ke Robucca. Periksa koneksi internetmu.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const m = (data as { message?: unknown } | null)?.message;
    const msg = Array.isArray(m) ? String(m[0]) : typeof m === 'string' ? m : `Galat ${res.status}`;
    // Sesi pelanggan berakhir/tidak sah: keluar otomatis, data tamu di perangkat tetap ada.
    if (res.status === 401 && token && getState().auth?.token === token) setState({ auth: null });
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const q = (token: string): string => `?token=${encodeURIComponent(token)}`;

export const api = {
  config: () => req<AppConfig>('GET', '/public/config'),
  branches: () => req<Branch[]>('GET', '/public/branches'),
  menu: (code: string) => req<Menu>('GET', `/public/branches/${encodeURIComponent(code)}/menu`),
  banners: () => req<Banner[]>('GET', '/public/banners'),
  couriers: () => req<Courier[]>('GET', '/public/couriers'),
  payments: () => req<PayOption[]>('GET', '/public/payment-options'),

  otp: (phone: string) => req<{ sent: true; phone: string; expiresIn: number; devCode?: string }>('POST', '/public/auth/otp', { body: { phone } }),
  verify: (phone: string, code: string, name?: string) =>
    req<{ token: string; customer: Customer }>('POST', '/public/auth/verify', { body: { phone, code, ...(name ? { name } : {}) } }),
  me: () => req<Customer>('GET', '/public/me', { auth: true }),
  saveName: (name: string) => req<Customer>('PATCH', '/public/me', { body: { name }, auth: true }),
  myOrders: () => req<PublicOrder[]>('GET', '/public/me/orders', { auth: true }),
  addresses: () => req<SavedAddress[]>('GET', '/public/me/addresses', { auth: true }),
  addAddress: (a: Omit<SavedAddress, 'id' | 'isDefault'> & { isDefault?: boolean }) => req<SavedAddress>('POST', '/public/me/addresses', { body: a, auth: true }),
  deleteAddress: (id: string) => req<{ ok: true }>('DELETE', `/public/me/addresses/${id}`, { auth: true }),

  createOrder: (body: Record<string, unknown>) => req<{ order: PublicOrder; accessToken: string }>('POST', '/public/orders', { body, auth: true, timeout: 25000 }),
  lookupOrders: (refs: { id: string; token: string }[]) => req<PublicOrder[]>('POST', '/public/orders/lookup', { body: { refs } }),
  order: (id: string, token?: string) => req<PublicOrder>('GET', `/public/orders/${id}${token ? q(token) : ''}`, { auth: true }),
  received: (id: string, token?: string) => req<PublicOrder>('POST', `/public/orders/${id}/received${token ? q(token) : ''}`, { auth: true }),
  payAtCashier: (id: string, token?: string) => req<PublicOrder>('POST', `/public/orders/${id}/pay-at-cashier${token ? q(token) : ''}`, { auth: true }),
  /** URL SSE status pesanan (EventSource tidak bisa mengirim header, token lewat query). */
  orderStreamUrl: (id: string, token?: string) => `${API_URL}/public/orders/${id}/stream${token ? q(token) : ''}`,

  myReservations: () => req<Reservation[]>('GET', '/public/reservations', { auth: true }),
  createReservation: (body: Record<string, unknown>) => req<Reservation>('POST', '/public/reservations', { body, auth: true }),
  lookupReservations: (refs: { id: string; token: string }[]) => req<Reservation[]>('POST', '/public/reservations/lookup', { body: { refs } }),
  reservation: (id: string, token?: string) => req<Reservation>('GET', `/public/reservations/${id}${token ? q(token) : ''}`, { auth: true }),
  cancelReservation: (id: string, token?: string) => req<Reservation>('POST', `/public/reservations/${id}/cancel${token ? q(token) : ''}`, { auth: true }),
};
