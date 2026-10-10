/* =========================================================
   Backend perangkat POS (port dari pos/js/data/backend.js).
   - Mode demo   : semua data di perangkat ini (IndexedDB) dari snapshot master bawaan, tanpa server.
   - Mode server : perangkat dipasangkan ke API pusat. Transaksi ditulis lokal dulu (tetap jalan
                   saat offline) lalu dikirim lewat outbox ke /pos/sync; pesanan cabang ditarik dari
                   /pos/feed dan notifikasi real-time lewat SSE /pos/stream.
   Aturan sinkron: urutan perubahan memakai `version` (bukan jam perangkat). Dokumen yang masih
   menunggu dikirim menang atas salinan server sampai terkirim; versi lebih lama dari server = konflik.
   ========================================================= */
import { addDays, businessDate, queueNo, receiptNo, uuidv7 } from '@robucca/core';
import bcrypt from 'bcryptjs';
import { ApiClient, ApiError, defaultApiUrl, isOffline } from '../lib/api';
import { bus } from '../lib/bus';
import { db, ss, TX_COLLS, type OutboxEntry, type TxColl } from '../lib/store';
import { fromServerOrder, toServerAudit, toServerCash, toServerKitchen, toServerOrder, toServerShift, type FeedOrder } from './mapping';
import { APPROVE_PERM, can, Master, type ApproveKind } from './master';
import type { AuditDoc, CashMove, DeviceInfo, KitchenMark, MasterSnapshot, MStaff, Order, Shift, SyncErrorEntry } from './types';

const SYNC_EVERY = 15000;
const KEEP_DAYS = 14;
/** Token persetujuan berlaku 5 menit di server; setelah ini kirim sebagai persetujuan offline. */
const APPROVAL_FRESH_MS = 4 * 60e3;

export interface Approval {
  staff: MStaff;
  /** token dari POST /pos/approve (hanya saat online) */
  token?: string;
  at: number;
}

type AnyDoc = { id: string; version: number; updatedAt: number };

interface SyncResponse {
  shifts: { id: string; status: string; errors?: string[] }[];
  cashMovements: { id: string; status: string; errors?: string[] }[];
  orders: { id: string; status: string; errors?: string[]; version?: number; serverStatus?: string }[];
  kitchen: { id: string; status: string; errors?: string[] }[];
  audit: number;
}

export class Backend {
  device: DeviceInfo | null = null;
  master: Master | null = null;
  api: ApiClient | null = null;
  online: boolean | null = null;
  lastSync = 0;
  syncErrors: SyncErrorEntry[] = [];
  isRevoked = false;
  private fails = new Map<string, { n: number; until: number }>();
  /** PIN staf yang sedang login — hanya di memori, untuk membuat sesi server saat koneksi kembali. */
  private loginPin: { staffId: string; pin: string } | null = null;
  private syncStarted = false;
  private inSync = false;
  private again = false;
  private loopT: ReturnType<typeof setTimeout> | null = null;
  private kickT: ReturnType<typeof setTimeout> | null = null;
  private stopStream: (() => void) | null = null;

  static async create(): Promise<Backend> {
    await db.ready();
    const b = new Backend();
    b.device = await db.getMeta<DeviceInfo | null>('device', null);
    if (b.device) {
      await b.loadMaster();
      if (b.isServer) {
        b.api = new ApiClient({ url: b.device.serverUrl ?? defaultApiUrl(), token: b.device.token ?? '' });
        b.restoreSession();
      }
      b.syncErrors = await db.getMeta<SyncErrorEntry[]>('syncErrors', []);
      b.lastSync = await db.getMeta('lastSync', 0);
    }
    return b;
  }

  get isDemo(): boolean {
    return this.device?.mode === 'demo';
  }
  get isServer(): boolean {
    return this.device?.mode === 'server';
  }
  get branch() {
    return this.master?.branch ?? null;
  }
  get tz(): string {
    return this.branch?.timezone ?? 'Asia/Jakarta';
  }
  today(): string {
    return businessDate(Date.now(), this.tz, this.branch?.dayStartMinute ?? 0);
  }
  bizDateOf(ts: number): string {
    return businessDate(ts, this.tz, this.branch?.dayStartMinute ?? 0);
  }

  async loadMaster(): Promise<void> {
    const raw = await db.getMeta<MasterSnapshot | null>('master', null);
    if (!raw) {
      this.master = null;
      return;
    }
    const sold = await db.getMeta<string[]>(`soldout:${this.device?.branchId ?? ''}`, []);
    this.master = new Master(raw, new Set(sold));
    bus.emit('master', {}, false);
  }

  /* =========================================================
     Penyiapan perangkat
     ========================================================= */
  async pair({ url, code, name }: { url: string; code: string; name: string }): Promise<void> {
    const api = new ApiClient({ url });
    const res = await api.post<{ token: string; device: { id: string; name: string; terminalNo: number; branch: { code: string; name: string } | null } }>(
      '/pos/pair', { code: String(code).trim(), name: String(name || '').trim() || undefined },
    );
    await db.clear([...TX_COLLS, 'outbox']);
    await db.setMeta('masterVersion', null);
    await db.setMeta('feedCursor', null);
    this.api = new ApiClient({ url: api.url, token: res.token });
    // Perangkat baru dianggap siap setelah master tersimpan (layar tidak berpindah di tengah jalan).
    const device: DeviceInfo = {
      mode: 'server', id: res.device.id, name: res.device.name, branchId: null, branchCode: res.device.branch?.code ?? null,
      branchName: res.device.branch?.name ?? null, terminalNo: res.device.terminalNo || 1, serverUrl: api.url, token: res.token, pairedAt: Date.now(),
    };
    await this.pullMaster(true, false);
    device.branchId = (await db.getMeta<MasterSnapshot | null>('master', null))?.branch?.id ?? null;
    await db.setMeta('device', device);
    this.device = device;
    await this.loadMaster();
    this.syncErrors = [];
    await db.setMeta('syncErrors', []);
    // Tarik feed sekali sebelum berjualan: nomor struk terminal yang dipasang ulang dilanjutkan, tidak dobel.
    await this.pullFeed().catch((e: unknown) => console.warn('feed awal gagal', e));
  }

  /** Mode demo: snapshot master bawaan (tanpa server) + riwayat contoh. */
  async setupDemo({ branchCode = 'IJN', history = true, onProgress = () => {} }: { branchCode?: string; history?: boolean; onProgress?: (t: string) => void }): Promise<void> {
    onProgress('Menyiapkan menu & cabang…');
    const { demoMaster, generateHistory } = await import('./demo');
    const raw = demoMaster(branchCode);
    await db.clear([...TX_COLLS, 'outbox']);
    await db.setMeta('master', raw);
    const device: DeviceInfo = {
      mode: 'demo', id: uuidv7(), name: 'Perangkat demo', branchId: raw.branch?.id ?? null, branchCode: raw.branch?.code ?? null,
      branchName: raw.branch?.name ?? null, terminalNo: 1, pairedAt: Date.now(),
    };
    if (history) {
      onProgress('Membuat riwayat transaksi contoh…');
      const h = generateHistory(new Master(raw), device);
      await db.put('shifts', h.shifts);
      await db.put('cashMoves', h.cashMoves);
      await db.put('orders', h.orders);
      await db.put('kitchen', h.kitchen);
    }
    await db.setMeta('device', device);
    this.device = device;
    await this.loadMaster();
  }

  /** Mode demo: perangkat ini berpura-pura menjadi kasir cabang lain. */
  async switchBranch(branchCode: string): Promise<void> {
    const { demoMaster, generateHistory } = await import('./demo');
    const raw = demoMaster(branchCode);
    await db.setMeta('master', raw);
    const device: DeviceInfo = { ...this.device!, branchId: raw.branch?.id ?? null, branchCode: raw.branch?.code ?? null, branchName: raw.branch?.name ?? null };
    // Cabang yang belum pernah dipakai di perangkat ini: buat riwayat contohnya.
    if (!(await db.all<Order>('orders')).some((o) => o.branchId === device.branchId)) {
      const h = generateHistory(new Master(raw), device);
      await db.put('shifts', h.shifts);
      await db.put('cashMoves', h.cashMoves);
      await db.put('orders', h.orders);
      await db.put('kitchen', h.kitchen);
    }
    await db.setMeta('device', device);
    this.device = device;
    await this.loadMaster();
  }

  async destroy(): Promise<void> {
    this.stopSync();
    await db.destroy();
  }

  /* =========================================================
     Data master
     ========================================================= */
  async pullMaster(force = false, load = true): Promise<boolean> {
    if (!this.api) return false;
    const ver = force ? null : await db.getMeta<string | null>('masterVersion', null);
    const res = await this.api.get<{ notModified?: boolean; version: string; master: MasterSnapshot }>('/pos/master', { etag: ver });
    if (res.notModified) return false;
    await db.setMeta('master', res.master);
    await db.setMeta('masterVersion', res.version);
    if (load) await this.loadMaster();
    return true;
  }

  /** Tandai menu habis / tersedia di cabang ini (disimpan di perangkat & dicatat ke log server). */
  async setSoldOut(productId: string, out: boolean, actor: MStaff): Promise<void> {
    const key = `soldout:${this.device?.branchId ?? ''}`;
    const cur = new Set(await db.getMeta<string[]>(key, []));
    if (out) cur.add(productId);
    else cur.delete(productId);
    await db.setMeta(key, [...cur]);
    await this.loadMaster();
    const p = this.master?.product(productId);
    await this.audit(out ? 'menu.soldout' : 'menu.available', { productId, name: p?.name ?? productId }, actor);
    bus.emit('soldout', {});
  }

  /* =========================================================
     Login PIN (diverifikasi di perangkat dengan hash dari master; sesi server dibuat bila online)
     ========================================================= */
  lockedFor(staffId: string): number {
    const f = this.fails.get(staffId);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }

  private async checkPin(staff: MStaff, pin: string): Promise<boolean> {
    if (this.lockedFor(staff.id) || !staff.pinHash) return false;
    const ok = await bcrypt.compare(pin, staff.pinHash);
    if (!ok) {
      const f = this.fails.get(staff.id) ?? { n: 0, until: 0 };
      f.n += 1;
      if (f.n >= 5) {
        f.until = Date.now() + 30000;
        f.n = 0;
      }
      this.fails.set(staff.id, f);
      return false;
    }
    this.fails.delete(staff.id);
    return true;
  }

  async login(staff: MStaff, pin: string): Promise<{ ok: boolean; locked: number }> {
    if (this.lockedFor(staff.id)) return { ok: false, locked: this.lockedFor(staff.id) };
    if (!(await this.checkPin(staff, pin))) return { ok: false, locked: this.lockedFor(staff.id) };
    this.loginPin = { staffId: staff.id, pin };
    if (this.api) {
      this.api.session = null;
      // Sesi server untuk approve/refund; gagal saat offline tidak menghalangi kasir.
      await this.serverLogin().catch(() => false);
    }
    return { ok: true, locked: 0 };
  }

  private async serverLogin(): Promise<boolean> {
    if (!this.api || !this.loginPin) return false;
    const r = await this.api.post<{ session: string; expiresIn: number }>('/pos/login', { userId: this.loginPin.staffId, pin: this.loginPin.pin });
    this.api.session = r.session;
    ss.set('pos:session', { s: r.session, staffId: this.loginPin.staffId, exp: Date.now() + r.expiresIn * 1000 - 60e3 });
    return true;
  }

  private restoreSession(): void {
    const x = ss.get<{ s: string; staffId: string; exp: number } | null>('pos:session', null);
    if (x && x.exp > Date.now() && this.api) this.api.session = x.s;
  }

  /** Sesi server untuk staf yang login (dibuat ulang dari PIN di memori bila perlu). */
  async ensureSession(): Promise<boolean> {
    if (!this.api) return false;
    if (this.api.session) return true;
    return this.serverLogin().catch(() => false);
  }

  logout(): void {
    this.loginPin = null;
    if (this.api) this.api.session = null;
    ss.del('pos:session');
  }

  /** Verifikasi PIN penyetuju (manajer/pemilik) untuk void, refund, & diskon. */
  async approve(kind: ApproveKind, staffId: string, pin: string): Promise<Approval | null> {
    const s = this.master?.person(staffId);
    if (!s || !can(s, APPROVE_PERM[kind])) return null;
    if (!(await this.checkPin(s, pin))) return null;
    const out: Approval = { staff: s, at: Date.now() };
    if (this.isServer && this.api && (await this.ensureSession())) {
      try {
        const r = await this.api.post<{ approval: string; approver: { id: string } }>('/pos/approve', { pin, permission: APPROVE_PERM[kind] }, { session: true, timeout: 8000 });
        if (r.approver.id === s.id) out.token = r.approval;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && !/sesi|masuk/i.test(e.message)) return null; // PIN berubah di server
        /* offline: persetujuan dicatat sebagai offline (server memeriksa hak penyetuju) */
      }
    }
    return out;
  }

  /* =========================================================
     Transaksi (selalu ditulis lokal dulu)
     ========================================================= */
  async save<T extends AnyDoc>(coll: TxColl, docs: T | T[]): Promise<T[]> {
    const arr = Array.isArray(docs) ? docs : [docs];
    const now = Date.now();
    const list = arr.map((d) => ({ ...d, version: (d.version || 0) + 1, updatedAt: now }));
    await db.put(coll, list, this.isServer ? (d) => d.version : false);
    bus.emit(coll as 'orders', { ids: list.map((d) => d.id) });
    if (this.isServer) this.kick();
    return list;
  }

  /** Simpan tanpa antre kirim (data dari server). */
  async putLocal<T extends { id: string }>(coll: TxColl, docs: T[]): Promise<void> {
    await db.put(coll, docs, false);
  }

  get<T>(coll: TxColl, id: string): Promise<T | null> {
    return db.get<T>(coll, id);
  }

  async ordersOf(from: string, to: string): Promise<Order[]> {
    const bid = this.device?.branchId;
    return (await db.all<Order>('orders')).filter((o) => o.branchId === bid && o.bizDate >= from && o.bizDate <= to);
  }
  async openOrders(): Promise<Order[]> {
    const bid = this.device?.branchId;
    return (await db.all<Order>('orders')).filter((o) => o.branchId === bid && (o.status === 'OPEN' || o.status === 'AWAITING_PAYMENT'));
  }
  async kitchenMarks(sinceMs: number): Promise<KitchenMark[]> {
    return (await db.all<KitchenMark>('kitchen')).filter((k) => k.at >= sinceMs || !k.done);
  }
  async currentShift(): Promise<Shift | null> {
    const d = this.device;
    if (!d) return null;
    return (await db.all<Shift>('shifts')).find((s) => s.status === 'OPEN' && s.deviceId === d.id && s.branchId === d.branchId) ?? null;
  }
  async shiftOrders(shiftId: string): Promise<Order[]> {
    return (await db.all<Order>('orders')).filter((o) => o.shiftId === shiftId || o.refund?.shiftId === shiftId);
  }
  async cashMovesOf(shiftId: string): Promise<CashMove[]> {
    return (await db.all<CashMove>('cashMoves')).filter((c) => c.shiftId === shiftId);
  }

  async nextNumber(date: string): Promise<{ number: string; queueNo: string; seq: number }> {
    const b = this.branch!;
    const t = this.device!.terminalNo || 1;
    const seq = await db.nextSeq(`seq:${b.id}:${t}:${date}`);
    return { seq, number: receiptNo(b.code, t, date, seq), queueNo: queueNo(t, seq) };
  }

  async audit(action: string, detail: Record<string, unknown>, actor: MStaff | null): Promise<void> {
    const doc: AuditDoc = { id: uuidv7(), action, actorId: actor?.id ?? null, actorName: actor?.name ?? 'Sistem', detail, at: Date.now(), version: 0, updatedAt: 0 };
    await this.save('audit', doc);
  }

  /** Refund penuh. Mode server: langsung ke server (perlu online), sekali per pesanan. */
  async refund(o: Order, reason: string, approval: Approval, shift: Shift | null): Promise<Order> {
    const now = Date.now();
    let amount = o.totals.total;
    if (this.isServer) {
      if (await db.pending(`orders:${o.id}`)) await this.syncOnce();
      if (await db.pending(`orders:${o.id}`)) throw new Error('Pesanan ini belum terkirim ke server. Coba lagi saat online.');
      if (!(await this.ensureSession())) throw new Error('Refund butuh koneksi ke server. Periksa koneksi lalu coba lagi.');
      try {
        const r = await this.api!.post<{ amount: number }>(`/orders/${o.id}/refund`, { reason, ...(approval.token ? { approval: approval.token } : {}) }, { session: true });
        amount = r.amount;
      } catch (e) {
        if (isOffline(e)) throw new Error('Refund butuh koneksi ke server. Periksa koneksi lalu coba lagi.');
        throw e;
      }
    }
    const next: Order = {
      ...o, status: 'REFUNDED', version: o.version + 1, updatedAt: now,
      refund: { amount, reason, at: now, shiftId: shift?.id ?? null, byName: approval.staff.name },
    };
    await db.put('orders', [next], false);
    bus.emit('orders', { ids: [o.id] });
    if (this.isServer) this.kick();
    return next;
  }

  /* =========================================================
     Sinkronisasi (mode server)
     ========================================================= */
  startSync(): void {
    if (!this.isServer || this.syncStarted || !this.api) return;
    this.syncStarted = true;
    const loop = async () => {
      await this.syncOnce();
      this.loopT = setTimeout(loop, SYNC_EVERY);
    };
    void loop();
    this.stopStream = this.api.stream('/pos/stream', (type) => {
      if (type === 'feed' || type === 'order') this.kick();
      else if (type === 'master') this.pullMaster().catch(() => {});
    }, (open) => {
      if (open) {
        this.setOnline(true);
        this.kick();
      } else this.setOnline(false);
    });
    window.addEventListener('online', () => this.kick());
    this.prune().catch(() => {});
  }

  stopSync(): void {
    this.syncStarted = false;
    if (this.loopT) clearTimeout(this.loopT);
    if (this.kickT) clearTimeout(this.kickT);
    this.stopStream?.();
  }

  kick(): void {
    if (this.kickT) clearTimeout(this.kickT);
    this.kickT = setTimeout(() => void this.syncOnce(), 250);
  }

  private setOnline(on: boolean): void {
    if (this.online === on) return;
    this.online = on;
    bus.emit('net', { online: on }, false);
  }

  private revoked(): void {
    if (this.isRevoked) return;
    this.isRevoked = true;
    bus.emit('revoked', {}, false);
  }

  async syncState(): Promise<{ online: boolean | null; pending: number; lastSync: number; errors: number }> {
    return { online: this.online, pending: await db.outboxCount(), lastSync: this.lastSync, errors: this.syncErrors.length };
  }

  async syncOnce(): Promise<void> {
    if (!this.isServer || !this.api || this.isRevoked) return;
    if (this.inSync) {
      this.again = true;
      return;
    }
    this.inSync = true;
    try {
      await this.push();
      await this.pullFeed();
      await this.pullMaster().catch((e: unknown) => {
        if (!isOffline(e)) console.warn('master', e);
        else throw e;
      });
      this.lastSync = Date.now();
      await db.setMeta('lastSync', this.lastSync);
      this.setOnline(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.revoked();
      else if (isOffline(e)) this.setOnline(false);
      else console.warn('sync', e);
    } finally {
      this.inSync = false;
      bus.emit('sync', await this.syncState(), false);
      if (this.again) {
        this.again = false;
        this.kick();
      }
    }
  }

  private async recordErrors(list: SyncErrorEntry[]): Promise<void> {
    if (!list.length) return;
    this.syncErrors = [...list, ...this.syncErrors].slice(0, 50);
    await db.setMeta('syncErrors', this.syncErrors);
  }

  /** Kirim outbox per kiriman (maks. 100 dokumen). Diterima / ditolak permanen → keluar dari antrean. */
  private async push(): Promise<void> {
    for (let round = 0; round < 30; round++) {
      const entries = (await db.outbox()).slice(0, 100);
      if (!entries.length) return;
      const docs = new Map<string, AnyDoc>();
      for (const e of entries) {
        const d = await db.get<AnyDoc>(e.coll, e.id);
        if (d) docs.set(e.k, d);
      }
      const body = this.buildBody(entries, docs);
      let res: SyncResponse;
      try {
        res = await this.api!.post<SyncResponse>('/pos/sync', body, { timeout: 30000 });
      } catch (e) {
        // Satu dokumen tidak lolos validasi DTO → seluruh kiriman 400. Kirim satu per satu.
        if (e instanceof ApiError && e.status === 400) res = await this.pushOneByOne(entries, docs);
        else throw e;
      }
      await this.handleResults(entries, docs, res);
      await db.ack(entries);
    }
  }

  private buildBody(entries: OutboxEntry[], docs: Map<string, AnyDoc>) {
    const body: Record<string, unknown[]> = { shifts: [], cashMovements: [], orders: [], kitchen: [], audit: [] };
    const now = Date.now();
    for (const e of entries) {
      const d = docs.get(e.k);
      if (!d) continue;
      if (e.coll === 'orders') {
        const o = d as unknown as Order;
        const doc = toServerOrder(o);
        // Token persetujuan kedaluwarsa (dibuat lama sebelum terkirim) → kirim sebagai persetujuan offline.
        if (o.approvalAt && now - o.approvalAt > APPROVAL_FRESH_MS) {
          delete doc.discountApproval;
          delete doc.voidApproval;
        }
        body.orders!.push(doc);
      } else if (e.coll === 'shifts') body.shifts!.push(toServerShift(d as unknown as Shift));
      else if (e.coll === 'cashMoves') body.cashMovements!.push(toServerCash(d as unknown as CashMove));
      else if (e.coll === 'kitchen') body.kitchen!.push(toServerKitchen(d as unknown as KitchenMark));
      else if (e.coll === 'audit') body.audit!.push(toServerAudit(d as unknown as AuditDoc));
    }
    return body;
  }

  private async pushOneByOne(entries: OutboxEntry[], docs: Map<string, AnyDoc>): Promise<SyncResponse> {
    const out: SyncResponse = { shifts: [], cashMovements: [], orders: [], kitchen: [], audit: 0 };
    for (const e of entries) {
      if (!docs.has(e.k)) continue;
      const body = this.buildBody([e], docs);
      try {
        const r = await this.api!.post<SyncResponse>('/pos/sync', body);
        out.shifts.push(...r.shifts);
        out.cashMovements.push(...r.cashMovements);
        out.orders.push(...r.orders);
        out.kitchen.push(...r.kitchen);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 400)) throw err;
        const rej = { id: e.coll === 'kitchen' ? (docs.get(e.k) as unknown as KitchenMark).orderId : e.id, status: 'rejected', errors: [err.message] };
        if (e.coll === 'orders') out.orders.push(rej);
        else if (e.coll === 'shifts') out.shifts.push(rej);
        else if (e.coll === 'cashMoves') out.cashMovements.push(rej);
        else if (e.coll === 'kitchen') out.kitchen.push(rej);
      }
    }
    return out;
  }

  private async handleResults(entries: OutboxEntry[], docs: Map<string, AnyDoc>, res: SyncResponse): Promise<void> {
    const errors: SyncErrorEntry[] = [];
    const label = (coll: string, d: AnyDoc | undefined) =>
      coll === 'orders' ? `Pesanan ${(d as unknown as Order | undefined)?.number ?? ''}` : coll === 'shifts' ? 'Shift' : coll === 'cashMoves' ? 'Kas masuk/keluar' : 'Dapur';
    const check = async (coll: TxColl, list: { id: string; status: string; errors?: string[]; version?: number }[]) => {
      for (const r of list) {
        if (r.status === 'saved' || r.status === 'duplicate') continue;
        const e = entries.find((x) => x.coll === coll && (x.id === r.id || (coll === 'kitchen' && (docs.get(x.k) as unknown as KitchenMark | undefined)?.orderId === r.id)));
        const d = e ? docs.get(e.k) : undefined;
        const msgs = r.status === 'conflict' ? ['Diubah di terminal lain lebih dulu — memakai versi server'] : (r.errors ?? ['Ditolak server']);
        errors.push({ coll, id: r.id, label: label(coll, d), errors: msgs, at: Date.now() });
        if (coll === 'orders' && d) {
          if (r.status === 'conflict') await this.refetchOrder(r.id);
          else await db.put('orders', [{ ...(d as unknown as Order), syncError: msgs.join(', ') }], false);
        }
        if (coll === 'shifts' && d) await db.put('shifts', [{ ...(d as unknown as Shift), syncError: msgs.join(', ') }], false);
      }
    };
    await check('orders', res.orders ?? []);
    await check('shifts', res.shifts ?? []);
    await check('cashMoves', res.cashMovements ?? []);
    await check('kitchen', res.kitchen ?? []);
    await this.recordErrors(errors);
    if (errors.length) bus.emit('orders', { remote: true }, false);
  }

  /** Konflik: ambil versi server (sesi staf), atau ulangi feed dari awal. */
  private async refetchOrder(id: string): Promise<void> {
    await db.del('orders', id).catch(() => {});
    if (await this.ensureSession()) {
      try {
        const row = await this.api!.get<FeedOrder>(`/orders/${id}`, { session: true });
        await this.mergeOrders([row]);
        return;
      } catch {
        /* lanjut ke feed penuh */
      }
    }
    await db.setMeta('feedCursor', null);
  }

  private terminalOf = (deviceId: string | null, number?: string): number | null => {
    if (deviceId && deviceId === this.device?.id) return this.device.terminalNo;
    const m = /^[A-Z][A-Z0-9]*?(\d{1,2})-\d{6}-\d{4}$/.exec(number ?? '');
    return m ? Number(m[1]) : null;
  };

  private async mergeOrders(rows: FeedOrder[]): Promise<{ orders: number; kitchen: number }> {
    const m = this.master;
    const d = this.device;
    if (!m || !d?.branchId) return { orders: 0, kitchen: 0 };
    let n1 = 0;
    let n2 = 0;
    for (const row of rows) {
      if (await db.pending(`orders:${row.id}`)) continue; // perubahan lokal menunggu dikirim → menang sampai terkirim
      const prev = await db.get<Order>('orders', row.id);
      if (prev && prev.version > row.version) continue;
      const o = fromServerOrder(row, m, d.branchId, prev, (dev) => this.terminalOf(dev, row.number));
      await db.put('orders', [o], false);
      n1++;
      // status dapur per item
      for (const it of row.items) {
        if (it.station === 'NONE') continue;
        const id = `${row.id}:${it.id}`;
        if (await db.pending(`kitchen:${id}`)) continue;
        const cur = await db.get<KitchenMark>('kitchen', id);
        const done = it.kitchenStatus === 'DONE';
        if ((!cur && done) || (cur && cur.done !== done)) {
          await db.put('kitchen', [{ id, orderId: row.id, lineId: it.id, branchId: d.branchId, done, at: it.kitchenDoneAt ? Date.parse(it.kitchenDoneAt) : Date.now(), version: 1, updatedAt: Date.now() }], false);
          n2++;
        }
      }
      // pasang ulang perangkat: lanjutkan nomor struk dari data server agar tidak dobel
      if (row.deviceId === d.id) {
        const mm = /-(\d{6})-(\d{4})$/.exec(row.number);
        if (mm) {
          const date = String(row.businessDate).slice(0, 10);
          const k = `seq:${d.branchId}:${d.terminalNo}:${date}`;
          if ((await db.getMeta(k, 0)) < Number(mm[2])) await db.setMeta(k, Number(mm[2]));
        }
      }
    }
    return { orders: n1, kitchen: n2 };
  }

  private async pullFeed(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const since = await db.getMeta<string | null>('feedCursor', null);
      const res = await this.api!.get<{ cursor: string; more?: boolean; orders: FeedOrder[] }>(`/pos/feed${since ? `?since=${encodeURIComponent(since)}` : ''}`);
      const n = await this.mergeOrders(res.orders ?? []);
      await db.setMeta('feedCursor', res.cursor || since);
      if (n.orders) bus.emit('orders', { remote: true }, false);
      if (n.kitchen) bus.emit('kitchen', { remote: true }, false);
      if (!res.more) return;
    }
  }

  /** Hapus transaksi lama yang sudah terkirim agar penyimpanan perangkat tidak penuh. */
  async prune(): Promise<void> {
    const cutoff = addDays(this.today(), -KEEP_DAYS);
    for (const o of await db.all<Order>('orders')) {
      if (o.bizDate < cutoff && o.status !== 'OPEN' && !(await db.pending(`orders:${o.id}`))) await db.del('orders', o.id);
    }
    const old = Date.now() - 3 * 864e5;
    for (const k of await db.all<KitchenMark>('kitchen')) {
      if (k.at < old && !(await db.pending(`kitchen:${k.id}`))) await db.del('kitchen', k.id);
    }
  }
}
