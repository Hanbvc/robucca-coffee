/* Menu pusat (kategori, produk, grup opsi), harga & ketersediaan per cabang, dan resep (BoM).
   Setiap perubahan dicatat di log aktivitas dan memicu event "master" agar POS menarik ulang /pos/master. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@robucca/db';
import { can, type StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { assertBranch, dec, needAny, OfficeEvents, scopeBranches } from './office.common';
import type {
  CategoryDto, ModifierGroupDto, ModifierOptionDto, ProductBranchDto, ProductDto, ProductModifierLinkDto, RecipeDto, UpdateCategoryDto, UpdateModifierGroupDto,
  UpdateModifierOptionDto, UpdateProductDto,
} from './office.dto';

const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'menu';

const strip = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

@Injectable()
export class MenuAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly office: OfficeEvents,
  ) {}

  /** Seluruh menu (termasuk nonaktif) + pengaturan cabang yang boleh dilihat. */
  async menu(staff: StaffCtx, branchId?: string) {
    const scope = scopeBranches(staff, branchId ? [branchId] : null);
    const db = this.prisma.db;
    const [categories, products, modifierGroups, branchSettings, recipes, branches] = await Promise.all([
      db.category.findMany({ orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }] }),
      db.product.findMany({
        orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
        include: { modifierGroups: { orderBy: { sortOrder: 'asc' }, select: { groupId: true, sortOrder: true, showWhenOptionIds: true } } },
      }),
      db.modifierGroup.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { options: { orderBy: { sortOrder: 'asc' } }, _count: { select: { products: true } } } }),
      db.productBranch.findMany({ where: scope ? { branchId: { in: scope } } : {} }),
      db.recipe.findMany({ select: { productId: true, modifierOptionId: true, _count: { select: { lines: true } } } }),
      db.branch.findMany({ where: scope ? { id: { in: scope } } : {}, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, isActive: true } }),
    ]);
    const recipeOf = new Map(recipes.filter((r) => r.productId).map((r) => [r.productId!, r._count.lines]));
    const optRecipe = new Map(recipes.filter((r) => r.modifierOptionId).map((r) => [r.modifierOptionId!, r._count.lines]));
    return {
      branches,
      categories,
      products: products.map((p) => ({
        ...p,
        recipeLines: recipeOf.get(p.id) ?? 0,
        branchSettings: branchSettings.filter((s) => s.productId === p.id).map((s) => ({ branchId: s.branchId, priceOverride: s.priceOverride, isAvailable: s.isAvailable, updatedAt: s.updatedAt })),
      })),
      modifierGroups: modifierGroups.map(({ _count, options, ...g }) => ({ ...g, productCount: _count.products, options: options.map((o) => ({ ...o, recipeLines: optRecipe.get(o.id) ?? 0 })) })),
    };
  }

  // ------------------------------------------------------------ kategori

  /** Kode kategori untuk tautan PWA (/menu#kode): dibuat sekali dari nama, tidak berubah saat nama diganti. */
  private async uniqueCategorySlug(base: string): Promise<string> {
    let slug = base || 'kategori';
    for (let i = 2; await this.prisma.db.category.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
    return slug;
  }

  async createCategory(staff: StaffCtx, b: CategoryDto) {
    const c = await this.prisma.db.category.create({
      data: {
        slug: await this.uniqueCategorySlug(slugify(b.name)), name: b.name, description: b.description || null, imageUrl: b.imageUrl || null, group: b.group,
        station: b.station ?? (b.group === 'DRINKS' || b.group === 'PASTRY' ? 'BAR' : 'KITCHEN'), quickNotes: b.quickNotes ?? [], isSignature: b.isSignature ?? false,
        sortOrder: b.sortOrder ?? 0, isActive: b.isActive ?? true,
      },
    });
    await this.office.log(staff, 'menu.category.create', 'Category', c.id, null, { name: c.name });
    this.office.master(null, 'menu');
    return c;
  }

  async updateCategory(staff: StaffCtx, id: string, b: UpdateCategoryDto) {
    await this.prisma.db.category.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException('Kategori tidak ditemukan');
    });
    const data = strip({ ...b, description: b.description === '' ? null : b.description, imageUrl: b.imageUrl === '' ? null : b.imageUrl });
    const c = await this.prisma.db.category.update({ where: { id }, data });
    await this.office.log(staff, 'menu.category.update', 'Category', id, null, { name: c.name, changes: data });
    this.office.master(null, 'menu');
    return c;
  }

  // ------------------------------------------------------------ produk

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let i = 2; await this.prisma.db.product.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
    return slug;
  }

  /** Validasi tautan grup opsi: grup ada, tidak dobel, opsi showWhen milik grup lain di menu yang sama. */
  private async checkLinks(links: ProductModifierLinkDto[]): Promise<void> {
    const ids = links.map((l) => l.groupId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Grup opsi dobel');
    const groups = await this.prisma.db.modifierGroup.findMany({ where: { id: { in: ids } }, select: { id: true, options: { select: { id: true } } } });
    if (groups.length !== ids.length) throw new BadRequestException('Grup opsi tidak dikenal');
    for (const l of links) {
      for (const o of l.showWhenOptionIds ?? []) {
        const owner = groups.find((g) => g.options.some((x) => x.id === o));
        if (!owner || owner.id === l.groupId) throw new BadRequestException('Syarat tampil grup harus opsi dari grup lain di menu ini');
      }
    }
  }

  async createProduct(staff: StaffCtx, b: ProductDto) {
    const cat = await this.prisma.db.category.findUnique({ where: { id: b.categoryId } });
    if (!cat) throw new BadRequestException('Kategori tidak dikenal');
    if (b.modifierGroups) await this.checkLinks(b.modifierGroups);
    const slug = b.slug ? b.slug : await this.uniqueSlug(slugify(b.name));
    if (b.slug && (await this.prisma.db.product.findUnique({ where: { slug } }))) throw new ConflictException(`Slug ${slug} sudah dipakai`);
    const p = await this.prisma.db.product.create({
      data: {
        slug, categoryId: b.categoryId, name: b.name, description: b.description ?? null, imageUrl: b.imageUrl ?? null, basePrice: b.basePrice,
        station: b.station ?? null, isSignature: b.isSignature ?? false, sortOrder: b.sortOrder ?? 0, isActive: b.isActive ?? true,
        modifierGroups: { create: (b.modifierGroups ?? []).map((l, i) => ({ groupId: l.groupId, sortOrder: l.sortOrder ?? i + 1, showWhenOptionIds: l.showWhenOptionIds ?? [] })) },
      },
      include: { modifierGroups: true },
    });
    await this.office.log(staff, 'menu.product.create', 'Product', p.id, null, { name: p.name, basePrice: p.basePrice });
    this.office.master(null, 'menu');
    return p;
  }

  async updateProduct(staff: StaffCtx, id: string, b: UpdateProductDto) {
    const prev = await this.prisma.db.product.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException('Menu tidak ditemukan');
    if (b.basePrice !== undefined && b.basePrice !== prev.basePrice && !can(staff, 'price.manage')) throw new ForbiddenException('Mengubah harga butuh hak price.manage');
    if (b.categoryId && !(await this.prisma.db.category.findUnique({ where: { id: b.categoryId } }))) throw new BadRequestException('Kategori tidak dikenal');
    if (b.slug && b.slug !== prev.slug && (await this.prisma.db.product.findUnique({ where: { slug: b.slug } }))) throw new ConflictException(`Slug ${b.slug} sudah dipakai`);
    const p = await this.prisma.db.product.update({ where: { id }, data: strip(b) });
    if (b.basePrice !== undefined && b.basePrice !== prev.basePrice) {
      await this.office.log(staff, 'menu.price.update', 'Product', id, null, { name: p.name, from: prev.basePrice, to: p.basePrice });
    }
    await this.office.log(staff, 'menu.product.update', 'Product', id, null, { name: p.name, changes: strip(b) });
    this.office.master(null, 'menu');
    return p;
  }

  async setProductModifiers(staff: StaffCtx, id: string, links: ProductModifierLinkDto[]) {
    const p = await this.prisma.db.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Menu tidak ditemukan');
    await this.checkLinks(links);
    await this.prisma.db.$transaction([
      this.prisma.db.productModifierGroup.deleteMany({ where: { productId: id } }),
      this.prisma.db.productModifierGroup.createMany({ data: links.map((l, i) => ({ productId: id, groupId: l.groupId, sortOrder: l.sortOrder ?? i + 1, showWhenOptionIds: l.showWhenOptionIds ?? [] })) }),
    ]);
    await this.office.log(staff, 'menu.product.modifiers', 'Product', id, null, { name: p.name, groups: links.map((l) => l.groupId) });
    this.office.master(null, 'menu');
    return this.prisma.db.productModifierGroup.findMany({ where: { productId: id }, orderBy: { sortOrder: 'asc' } });
  }

  /** Harga khusus & ketersediaan (habis) per cabang. Ketersediaan: menu.availability; harga: price.manage. */
  async setProductBranch(staff: StaffCtx, productId: string, branchId: string, b: ProductBranchDto) {
    assertBranch(staff, branchId);
    if (b.isAvailable === undefined && b.priceOverride === undefined) throw new BadRequestException('Isi isAvailable dan/atau priceOverride');
    const [p, branch, prev] = await Promise.all([
      this.prisma.db.product.findUnique({ where: { id: productId }, select: { name: true, basePrice: true } }),
      this.prisma.db.branch.findUnique({ where: { id: branchId }, select: { id: true } }),
      this.prisma.db.productBranch.findUnique({ where: { productId_branchId: { productId, branchId } } }),
    ]);
    if (!p || !branch) throw new NotFoundException('Menu atau cabang tidak ditemukan');
    const priceChanged = b.priceOverride !== undefined && (prev?.priceOverride ?? null) !== b.priceOverride;
    if (priceChanged && !can(staff, 'price.manage')) throw new ForbiddenException('Harga khusus cabang butuh hak price.manage');
    if (b.isAvailable !== undefined) needAny(staff, ['menu.availability', 'menu.manage']);
    const data = strip({ isAvailable: b.isAvailable, priceOverride: b.priceOverride });
    const row = await this.prisma.db.productBranch.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: data,
      create: { productId, branchId, isAvailable: b.isAvailable ?? true, priceOverride: b.priceOverride ?? null },
    });
    if (priceChanged) await this.office.log(staff, 'menu.price.branch', 'Product', productId, branchId, { name: p.name, from: prev?.priceOverride ?? null, to: row.priceOverride, basePrice: p.basePrice });
    if (b.isAvailable !== undefined && (prev?.isAvailable ?? true) !== b.isAvailable) {
      await this.office.log(staff, b.isAvailable ? 'menu.available' : 'menu.soldout', 'Product', productId, branchId, { name: p.name });
    }
    this.office.master([branchId], 'menu');
    return row;
  }

  // ------------------------------------------------------------ grup & opsi

  private defaults(selection: string, opts: { isDefault?: boolean | undefined }[]): void {
    if (selection === 'SINGLE' && opts.filter((o) => o.isDefault).length > 1) throw new BadRequestException('Grup "pilih satu" hanya boleh punya satu pilihan bawaan');
  }

  async createGroup(staff: StaffCtx, b: ModifierGroupDto) {
    const selection = b.selection ?? 'SINGLE';
    this.defaults(selection, b.options);
    const names = b.options.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new BadRequestException('Nama pilihan dobel');
    const g = await this.prisma.db.modifierGroup.create({
      data: {
        name: b.name, selection, isRequired: b.isRequired ?? false, maxSelect: b.maxSelect ?? null, sortOrder: b.sortOrder ?? 0, isActive: b.isActive ?? true,
        options: { create: b.options.map((o, i) => ({ name: o.name, priceDelta: o.priceDelta ?? 0, isDefault: o.isDefault ?? false, imageUrl: o.imageUrl ?? null, sortOrder: o.sortOrder ?? i + 1, isActive: o.isActive ?? true })) },
      },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.office.log(staff, 'menu.modifier.create', 'ModifierGroup', g.id, null, { name: g.name, options: g.options.length });
    this.office.master(null, 'menu');
    return g;
  }

  async updateGroup(staff: StaffCtx, id: string, b: UpdateModifierGroupDto) {
    const prev = await this.prisma.db.modifierGroup.findUnique({ where: { id }, include: { options: true } });
    if (!prev) throw new NotFoundException('Grup opsi tidak ditemukan');
    if (b.selection === 'SINGLE') this.defaults('SINGLE', prev.options.filter((o) => o.isActive));
    const g = await this.prisma.db.modifierGroup.update({ where: { id }, data: strip(b), include: { options: { orderBy: { sortOrder: 'asc' } } } });
    await this.office.log(staff, 'menu.modifier.update', 'ModifierGroup', id, null, { name: g.name, changes: strip(b) });
    this.office.master(null, 'menu');
    return g;
  }

  async addOption(staff: StaffCtx, groupId: string, b: ModifierOptionDto) {
    const g = await this.prisma.db.modifierGroup.findUnique({ where: { id: groupId } });
    if (!g) throw new NotFoundException('Grup opsi tidak ditemukan');
    const o = await this.prisma.db.$transaction(async (tx) => {
      if (b.isDefault && g.selection === 'SINGLE') await tx.modifierOption.updateMany({ where: { groupId }, data: { isDefault: false } });
      return tx.modifierOption.create({ data: { groupId, name: b.name, priceDelta: b.priceDelta ?? 0, isDefault: b.isDefault ?? false, imageUrl: b.imageUrl ?? null, sortOrder: b.sortOrder ?? 99, isActive: b.isActive ?? true } });
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Nama pilihan sudah ada di grup ini');
      throw e;
    });
    await this.office.log(staff, 'menu.option.create', 'ModifierOption', o.id, null, { group: g.name, name: o.name, priceDelta: o.priceDelta });
    this.office.master(null, 'menu');
    return o;
  }

  /** Opsi yang pernah terjual tidak dihapus; nonaktifkan dengan isActive=false. */
  async updateOption(staff: StaffCtx, id: string, b: UpdateModifierOptionDto) {
    const prev = await this.prisma.db.modifierOption.findUnique({ where: { id }, include: { group: true } });
    if (!prev) throw new NotFoundException('Pilihan tidak ditemukan');
    const o = await this.prisma.db.$transaction(async (tx) => {
      if (b.isDefault && prev.group.selection === 'SINGLE') await tx.modifierOption.updateMany({ where: { groupId: prev.groupId, id: { not: id } }, data: { isDefault: false } });
      return tx.modifierOption.update({ where: { id }, data: strip(b) });
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Nama pilihan sudah ada di grup ini');
      throw e;
    });
    if (b.priceDelta !== undefined && b.priceDelta !== prev.priceDelta) {
      await this.office.log(staff, 'menu.price.option', 'ModifierOption', id, null, { group: prev.group.name, name: o.name, from: prev.priceDelta, to: o.priceDelta });
    }
    await this.office.log(staff, 'menu.option.update', 'ModifierOption', id, null, { group: prev.group.name, name: o.name, changes: strip(b) });
    this.office.master(null, 'menu');
    return o;
  }

  // ------------------------------------------------------------ resep (BoM)

  async recipes() {
    const rows = await this.prisma.db.recipe.findMany({
      include: {
        product: { select: { id: true, name: true, slug: true } },
        modifierOption: { select: { id: true, name: true, group: { select: { id: true, name: true } } } },
        lines: { include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
    });
    return rows.map((r) => ({ ...r, lines: r.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: dec(l.quantity), item: l.inventoryItem })) }));
  }

  async recipe(target: { productId?: string; modifierOptionId?: string }) {
    const r = await this.prisma.db.recipe.findUnique({
      where: target.productId ? { productId: target.productId } : { modifierOptionId: target.modifierOptionId! },
      include: { lines: { include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } } } },
    });
    if (!r) return { note: null, lines: [] };
    return { id: r.id, note: r.note, updatedAt: r.updatedAt, lines: r.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: dec(l.quantity), item: l.inventoryItem })) };
  }

  async setRecipe(staff: StaffCtx, target: { productId?: string; modifierOptionId?: string }, b: RecipeDto) {
    const isProduct = !!target.productId;
    const owner = isProduct
      ? await this.prisma.db.product.findUnique({ where: { id: target.productId! }, select: { name: true } })
      : await this.prisma.db.modifierOption.findUnique({ where: { id: target.modifierOptionId! }, select: { name: true } });
    if (!owner) throw new NotFoundException(isProduct ? 'Menu tidak ditemukan' : 'Pilihan tidak ditemukan');
    const ids = b.lines.map((l) => l.inventoryItemId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Bahan dobel di resep');
    for (const l of b.lines) {
      if (l.quantity === 0) throw new BadRequestException('Jumlah bahan tidak boleh 0');
      if (isProduct && l.quantity < 0) throw new BadRequestException('Jumlah bahan resep menu harus lebih dari 0');
    }
    const found = await this.prisma.db.inventoryItem.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Bahan baku tidak dikenal');
    const where = isProduct ? { productId: target.productId! } : { modifierOptionId: target.modifierOptionId! };
    await this.prisma.db.$transaction(async (tx) => {
      const r = await tx.recipe.upsert({ where, update: { note: b.note ?? null }, create: { ...where, note: b.note ?? null } });
      await tx.recipeLine.deleteMany({ where: { recipeId: r.id } });
      if (b.lines.length) await tx.recipeLine.createMany({ data: b.lines.map((l) => ({ recipeId: r.id, inventoryItemId: l.inventoryItemId, quantity: new Prisma.Decimal(l.quantity) })) });
    });
    await this.office.log(staff, 'recipe.update', isProduct ? 'Product' : 'ModifierOption', target.productId ?? target.modifierOptionId!, null, { name: owner.name, lines: b.lines });
    this.office.master(null, 'recipe');
    return this.recipe(target);
  }

  async deleteRecipe(staff: StaffCtx, target: { productId?: string; modifierOptionId?: string }) {
    const where = target.productId ? { productId: target.productId } : { modifierOptionId: target.modifierOptionId! };
    const r = await this.prisma.db.recipe.deleteMany({ where });
    if (!r.count) throw new NotFoundException('Resep tidak ditemukan');
    await this.office.log(staff, 'recipe.delete', target.productId ? 'Product' : 'ModifierOption', target.productId ?? target.modifierOptionId!, null, {});
    this.office.master(null, 'recipe');
    return { ok: true };
  }
}
