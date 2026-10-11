/* Bahan baku & stok per cabang: terima barang, barang rusak, stok opname, transfer antarcabang, riwayat, stok menipis.
   Saldo InventoryStock.quantity = jumlah semua StockMovement cabang itu (dijaga di transaksi yang sama). */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockMovementType } from '@robucca/db';
import type { StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { assertBranch, branchWhere, dec, OfficeEvents, resolveRange, scopeBranches, todayFor, looseWindow, bizDateOf } from './office.common';
import type { InventoryItemDto, OpnameDto, StockInDto, StockMovesQueryDto, TransferDto, UpdateInventoryItemDto } from './office.dto';

type Tx = Prisma.TransactionClient;
const D = (n: number | Prisma.Decimal) => new Prisma.Decimal(n);

@Injectable()
export class StockAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly office: OfficeEvents,
  ) {}

  // ------------------------------------------------------------ bahan baku

  async items(includeInactive: boolean) {
    const rows = await this.prisma.db.inventoryItem.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { recipeLines: true } } },
    });
    return rows.map(({ _count, ...r }) => ({ ...r, usedInRecipes: _count.recipeLines }));
  }

  async createItem(staff: StaffCtx, b: InventoryItemDto) {
    if (await this.prisma.db.inventoryItem.findUnique({ where: { sku: b.sku } })) throw new ConflictException(`SKU ${b.sku} sudah dipakai`);
    const it = await this.prisma.db.inventoryItem.create({ data: { sku: b.sku, name: b.name, unit: b.unit, isActive: b.isActive ?? true } });
    await this.office.log(staff, 'inventory.create', 'InventoryItem', it.id, null, { sku: it.sku, name: it.name, unit: it.unit });
    return it;
  }

  async updateItem(staff: StaffCtx, id: string, b: UpdateInventoryItemDto) {
    const prev = await this.prisma.db.inventoryItem.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException('Bahan tidak ditemukan');
    if (b.sku && b.sku !== prev.sku && (await this.prisma.db.inventoryItem.findUnique({ where: { sku: b.sku } }))) throw new ConflictException(`SKU ${b.sku} sudah dipakai`);
    if (b.unit && b.unit !== prev.unit && (await this.prisma.db.stockMovement.count({ where: { inventoryItemId: id } }))) {
      throw new BadRequestException('Satuan tidak bisa diubah setelah ada pergerakan stok');
    }
    const it = await this.prisma.db.inventoryItem.update({ where: { id }, data: b });
    await this.office.log(staff, 'inventory.update', 'InventoryItem', id, null, { sku: it.sku, name: it.name, changes: { ...b } });
    this.office.master(null, 'stock');
    return it;
  }

  // ------------------------------------------------------------ saldo

  /** Saldo semua bahan aktif di satu cabang (bahan tanpa baris stok = 0, belum dicatat). */
  async levels(staff: StaffCtx, branchId: string, includeInactive = false) {
    assertBranch(staff, branchId);
    const [items, stocks] = await Promise.all([
      this.prisma.db.inventoryItem.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.db.inventoryStock.findMany({ where: { branchId } }),
    ]);
    const map = new Map(stocks.map((s) => [s.inventoryItemId, s]));
    const rows = items.map((it) => {
      const s = map.get(it.id);
      const quantity = dec(s?.quantity) ?? 0;
      const reorderLevel = dec(s?.reorderLevel);
      return {
        inventoryItemId: it.id, sku: it.sku, name: it.name, unit: it.unit, isActive: it.isActive, tracked: !!s,
        quantity, reorderLevel, updatedAt: s?.updatedAt ?? null,
        status: quantity <= 0 ? (s ? 'OUT' : 'UNTRACKED') : reorderLevel != null && quantity <= reorderLevel ? 'LOW' : 'OK',
      };
    });
    return { branchId, rows, low: rows.filter((r) => r.status === 'LOW' || r.status === 'OUT').length };
  }

  /** Bahan menipis/habis di semua cabang yang boleh dilihat. */
  async low(staff: StaffCtx, branchId?: string) {
    const scope = scopeBranches(staff, branchId ? [branchId] : null);
    const rows = await this.prisma.db.inventoryStock.findMany({
      where: { ...branchWhere(scope), inventoryItem: { isActive: true } },
      include: { inventoryItem: { select: { sku: true, name: true, unit: true } }, branch: { select: { code: true, name: true } } },
    });
    return rows
      .filter((s) => s.quantity.lte(0) || (s.reorderLevel != null && s.quantity.lte(s.reorderLevel)))
      .map((s) => ({
        branchId: s.branchId, branchCode: s.branch.code, branchName: s.branch.name, inventoryItemId: s.inventoryItemId, ...s.inventoryItem,
        quantity: dec(s.quantity), reorderLevel: dec(s.reorderLevel), status: s.quantity.lte(0) ? 'OUT' : 'LOW',
      }))
      .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0));
  }

  async setReorderLevel(staff: StaffCtx, branchId: string, inventoryItemId: string, level: number | null) {
    assertBranch(staff, branchId);
    await this.mustItems([inventoryItemId]);
    const s = await this.prisma.db.inventoryStock.upsert({
      where: { branchId_inventoryItemId: { branchId, inventoryItemId } },
      update: { reorderLevel: level == null ? null : D(level) },
      create: { branchId, inventoryItemId, quantity: 0, reorderLevel: level == null ? null : D(level) },
    });
    await this.office.log(staff, 'stock.reorder_level', 'InventoryItem', inventoryItemId, branchId, { reorderLevel: level });
    return { branchId, inventoryItemId, quantity: dec(s.quantity), reorderLevel: dec(s.reorderLevel) };
  }

  // ------------------------------------------------------------ pergerakan

  private async mustItems(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Bahan dobel');
    const items = await this.prisma.db.inventoryItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sku: true, unit: true } });
    if (items.length !== ids.length) throw new BadRequestException('Bahan baku tidak dikenal');
    return new Map(items.map((i) => [i.id, i]));
  }

  private async mustBranch(id: string) {
    const b = await this.prisma.db.branch.findUnique({ where: { id }, select: { id: true, name: true, code: true, isActive: true } });
    if (!b) throw new NotFoundException('Cabang tidak ditemukan');
    return b;
  }

  /** Kunci baris stok (FOR UPDATE) lalu tambah/kurangi dan catat pergerakan. Mengembalikan saldo sebelum. */
  private async move(tx: Tx, p: { branchId: string; inventoryItemId: string; type: StockMovementType; delta: Prisma.Decimal; note: string | null; transferId?: string | null; actorId: string; at: Date }) {
    await tx.inventoryStock.upsert({
      where: { branchId_inventoryItemId: { branchId: p.branchId, inventoryItemId: p.inventoryItemId } },
      update: {},
      create: { branchId: p.branchId, inventoryItemId: p.inventoryItemId, quantity: 0 },
    });
    const [row] = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`SELECT "quantity" FROM "InventoryStock" WHERE "branchId" = ${p.branchId}::uuid AND "inventoryItemId" = ${p.inventoryItemId}::uuid FOR UPDATE`;
    const before = D(row?.quantity ?? 0);
    if (!p.delta.isZero()) {
      await tx.inventoryStock.update({ where: { branchId_inventoryItemId: { branchId: p.branchId, inventoryItemId: p.inventoryItemId } }, data: { quantity: { increment: p.delta } } });
      await tx.stockMovement.create({
        data: { branchId: p.branchId, inventoryItemId: p.inventoryItemId, type: p.type, quantity: p.delta, note: p.note, transferId: p.transferId ?? null, createdById: p.actorId, createdAt: p.at },
      });
    }
    return before;
  }

  /** Terima barang / pembelian (PURCHASE, +) atau barang rusak/dibuang (WASTE, −). */
  async stockIn(staff: StaffCtx, b: StockInDto) {
    assertBranch(staff, b.branchId);
    await this.mustBranch(b.branchId);
    const items = await this.mustItems(b.lines.map((l) => l.inventoryItemId));
    const type = b.type ?? 'PURCHASE';
    const sign = type === 'WASTE' ? -1 : 1;
    const at = new Date();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const out = [];
      for (const l of b.lines) {
        const delta = D(l.quantity).mul(sign);
        const before = await this.move(tx, { branchId: b.branchId, inventoryItemId: l.inventoryItemId, type, delta, note: b.note || null, actorId: staff.id, at });
        out.push({ inventoryItemId: l.inventoryItemId, name: items.get(l.inventoryItemId)!.name, before: dec(before), change: dec(delta), after: dec(before.add(delta)) });
      }
      await this.office.log(staff, type === 'WASTE' ? 'stock.waste' : 'stock.receive', 'Branch', b.branchId, b.branchId, { lines: out, note: b.note ?? null }, tx);
      return out;
    });
    this.office.master([b.branchId], 'stock');
    return { branchId: b.branchId, type, lines: result };
  }

  /** Stok opname: catat selisih hitung fisik vs sistem sebagai ADJUSTMENT. */
  async opname(staff: StaffCtx, b: OpnameDto) {
    assertBranch(staff, b.branchId);
    await this.mustBranch(b.branchId);
    const items = await this.mustItems(b.lines.map((l) => l.inventoryItemId));
    const at = new Date();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const out = [];
      for (const l of b.lines) {
        // saldo dikunci dulu, lalu selisih dihitung dari saldo terkunci
        const before = await this.move(tx, { branchId: b.branchId, inventoryItemId: l.inventoryItemId, type: 'ADJUSTMENT', delta: D(0), note: null, actorId: staff.id, at });
        const delta = D(l.counted).sub(before);
        const note = b.note || `Opname: ${before.toString()} → ${l.counted}`;
        if (!delta.isZero()) await this.move(tx, { branchId: b.branchId, inventoryItemId: l.inventoryItemId, type: 'ADJUSTMENT', delta, note, actorId: staff.id, at });
        out.push({ inventoryItemId: l.inventoryItemId, name: items.get(l.inventoryItemId)!.name, system: dec(before), counted: l.counted, difference: dec(delta) });
      }
      await this.office.log(staff, 'stock.adjust', 'Branch', b.branchId, b.branchId, { lines: out, note: b.note ?? null }, tx);
      return out;
    });
    this.office.master([b.branchId], 'stock');
    return { branchId: b.branchId, lines: result };
  }

  /** Transfer antarcabang: TRANSFER_OUT di asal dan TRANSFER_IN di tujuan, berpasangan lewat transferId. */
  async transfer(staff: StaffCtx, b: TransferDto) {
    assertBranch(staff, b.fromBranchId);
    if (b.fromBranchId === b.toBranchId) throw new BadRequestException('Cabang asal dan tujuan sama');
    const [from, to] = await Promise.all([this.mustBranch(b.fromBranchId), this.mustBranch(b.toBranchId)]);
    if (!to.isActive) throw new BadRequestException('Cabang tujuan nonaktif');
    const items = await this.mustItems(b.lines.map((l) => l.inventoryItemId));
    const transferId = randomUUID();
    const at = new Date();
    const lines = await this.prisma.db.$transaction(async (tx) => {
      const out = [];
      for (const l of b.lines) {
        const q = D(l.quantity);
        const fromBefore = await this.move(tx, { branchId: from.id, inventoryItemId: l.inventoryItemId, type: 'TRANSFER_OUT', delta: q.neg(), note: b.note || `Ke ${to.name}`, transferId, actorId: staff.id, at });
        const toBefore = await this.move(tx, { branchId: to.id, inventoryItemId: l.inventoryItemId, type: 'TRANSFER_IN', delta: q, note: b.note || `Dari ${from.name}`, transferId, actorId: staff.id, at });
        out.push({ inventoryItemId: l.inventoryItemId, name: items.get(l.inventoryItemId)!.name, quantity: l.quantity, fromAfter: dec(fromBefore.sub(q)), toAfter: dec(toBefore.add(q)), insufficient: fromBefore.lt(q) });
      }
      const detail = { transferId, from: from.code, to: to.code, lines: out, note: b.note ?? null };
      await this.office.log(staff, 'stock.transfer', 'Branch', from.id, from.id, detail, tx);
      await this.office.log(staff, 'stock.transfer', 'Branch', to.id, to.id, detail, tx);
      return out;
    });
    this.office.master([from.id, to.id], 'stock');
    return { transferId, fromBranchId: from.id, toBranchId: to.id, lines };
  }

  async movements(staff: StaffCtx, q: StockMovesQueryDto) {
    const scope = scopeBranches(staff, q.branchId);
    const where: Prisma.StockMovementWhereInput = {
      ...branchWhere(scope),
      ...(q.inventoryItemId ? { inventoryItemId: q.inventoryItemId } : {}),
      ...(q.type ? { type: q.type as StockMovementType } : {}),
      ...(q.transferId ? { transferId: q.transferId } : {}),
    };
    let r: { from: string; to: string } | null = null;
    if (q.from || q.to || q.preset) {
      const branches = scope?.length === 1 ? await this.prisma.db.branch.findUnique({ where: { id: scope[0]! }, select: { timezone: true, dayStartMinute: true } }) : null;
      r = resolveRange(q, todayFor(branches), '7d');
      where.createdAt = looseWindow(r);
    }
    const limit = q.limit ?? 200;
    const offset = q.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.db.stockMovement.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: r ? 5000 : limit,
        include: {
          branch: { select: { code: true, name: true, timezone: true, dayStartMinute: true } },
          stock: { select: { inventoryItem: { select: { sku: true, name: true, unit: true } } } },
          createdBy: { select: { id: true, name: true } },
          order: { select: { number: true } },
        },
      }),
      this.prisma.db.stockMovement.count({ where }),
    ]);
    const inRange = r ? rows.filter((m) => { const d = bizDateOf(m.createdAt, m.branch); return d >= r!.from && d <= r!.to; }) : rows;
    const list = (r ? inRange.slice(0, limit) : rows).map((m) => ({
      id: m.id, branchId: m.branchId, branchCode: m.branch.code, branchName: m.branch.name, inventoryItemId: m.inventoryItemId,
      sku: m.stock.inventoryItem.sku, name: m.stock.inventoryItem.name, unit: m.stock.inventoryItem.unit,
      type: m.type, quantity: dec(m.quantity), note: m.note, transferId: m.transferId, orderId: m.orderId, orderNumber: m.order?.number ?? null,
      createdAt: m.createdAt, createdBy: m.createdBy,
    }));
    return { range: r, total: r ? inRange.length + offset : total, limit, offset, rows: list };
  }
}
