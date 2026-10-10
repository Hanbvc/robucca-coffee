import { Injectable } from '@nestjs/common';
import { BranchesService } from '../branches/branches.service';
import { MenuRepository } from './menu.repository';

@Injectable()
export class MenuService {
  constructor(
    private readonly branches: BranchesService,
    private readonly menu: MenuRepository,
  ) {}

  /** Menu publik satu cabang: harga cabang & tanda habis, tanpa data internal (stok, resep, biaya). */
  async forBranch(code: string) {
    const { id, ...branch } = await this.branches.getActive(code);
    const categories = await this.menu.findForBranch(id);
    return {
      branch,
      categories: categories
        .map((c) => ({
          id: c.id,
          name: c.name,
          group: c.group,
          quickNotes: c.quickNotes,
          products: c.products.map(({ branchSettings, modifierGroups, basePrice, ...p }) => {
            const setting = branchSettings[0];
            return {
              ...p,
              price: setting?.priceOverride ?? basePrice,
              available: setting?.isAvailable ?? true,
              modifierGroups: modifierGroups.map(({ group, showWhenOptionIds }) => ({ ...group, showWhenOptionIds })),
            };
          }),
        }))
        .filter((c) => c.products.length > 0),
    };
  }
}
