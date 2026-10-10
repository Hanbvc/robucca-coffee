import { Injectable } from '@nestjs/common';
import { Prisma, type StockMovementType } from '@robucca/db';
import { PrismaService } from '../../prisma/prisma.service';

export interface SoldItem {
  productId: string;
  quantity: number;
  optionIds: string[];
}

/** Stok bahan baku per cabang & pemotongan otomatis sesuai resep (BoM). */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kebutuhan bahan untuk item terjual: resep produk + penyesuaian resep opsi, dikali jumlah. */
  async requirements(tx: Prisma.TransactionClient, items: SoldItem[]): Promise<Map<string, Prisma.Decimal>> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const optionIds = [...new Set(items.flatMap((i) => i.optionIds))];
    if (!productIds.length) return new Map();
    const recipes = await tx.recipe.findMany({
      where: { OR: [{ productId: { in: productIds } }, { modifierOptionId: { in: optionIds } }] },
      select: { productId: true, modifierOptionId: true, lines: { select: { inventoryItemId: true, quantity: true } } },
    });
    const byProduct = new Map(recipes.filter((r) => r.productId).map((r) => [r.productId!, r.lines]));
    const byOption = new Map(recipes.filter((r) => r.modifierOptionId).map((r) => [r.modifierOptionId!, r.lines]));
    const need = new Map<string, Prisma.Decimal>();
    const add = (lines: { inventoryItemId: string; quantity: Prisma.Decimal }[] | undefined, qty: number) => {
      for (const l of lines ?? []) {
        need.set(l.inventoryItemId, (need.get(l.inventoryItemId) ?? new Prisma.Decimal(0)).add(l.quantity.mul(qty)));
      }
    };
    for (const i of items) {
      add(byProduct.get(i.productId), i.quantity);
      for (const o of i.optionIds) add(byOption.get(o), i.quantity);
    }
    return need;
  }

  /**
   * Catat pergerakan stok untuk sebuah pesanan. sign −1 = penjualan (SALE), +1 = pembatalan/refund (SALE_REVERSAL).
   * Baris stok cabang dibuat otomatis bila belum ada (stok boleh minus: penjualan tidak diblokir saat data stok belum rapi).
   */
  async applyOrder(
    tx: Prisma.TransactionClient,
    p: { branchId: string; orderId: string; items: SoldItem[]; sign: 1 | -1; actorId: string | null; at: Date },
  ): Promise<void> {
    const need = await this.requirements(tx, p.items);
    const type: StockMovementType = p.sign < 0 ? 'SALE' : 'SALE_REVERSAL';
    for (const [inventoryItemId, qty] of need) {
      if (qty.isZero()) continue;
      const delta = qty.mul(p.sign);
      await tx.inventoryStock.upsert({
        where: { branchId_inventoryItemId: { branchId: p.branchId, inventoryItemId } },
        update: { quantity: { increment: delta } },
        create: { branchId: p.branchId, inventoryItemId, quantity: delta },
      });
      await tx.stockMovement.create({
        data: { branchId: p.branchId, inventoryItemId, type, quantity: delta, orderId: p.orderId, createdById: p.actorId, createdAt: p.at },
      });
    }
  }
}
