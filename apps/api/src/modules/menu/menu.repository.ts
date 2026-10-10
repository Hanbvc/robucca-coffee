import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MenuRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Kategori aktif (urut kelompok Minuman → Snack → Makanan Berat → Pastry, lalu sortOrder)
      beserta menu, pengaturan cabang, dan opsinya. */
  findForBranch(branchId: string) {
    return this.prisma.db.category.findMany({
      where: { isActive: true },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        name: true,
        group: true,
        quickNotes: true,
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            imageUrl: true,
            basePrice: true,
            isSignature: true,
            branchSettings: { where: { branchId }, select: { priceOverride: true, isAvailable: true } },
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              where: { group: { isActive: true } },
              select: {
                showWhenOptionIds: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    selection: true,
                    isRequired: true,
                    maxSelect: true,
                    options: {
                      where: { isActive: true },
                      orderBy: { sortOrder: 'asc' },
                      select: { id: true, name: true, priceDelta: true, isDefault: true, imageUrl: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
