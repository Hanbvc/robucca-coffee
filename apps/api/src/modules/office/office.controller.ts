/* API kantor (back-office) — kontrak lengkap di apps/api/docs/office-api.md.
   Semua rute: StaffGuard (X-Session dari /pos/login di perangkat terpasang, atau dari /auth/login) + hak akses per tindakan.
   Cakupan cabang: Super Admin semua cabang; staf lain hanya cabang miliknya (UserBranch). */
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentStaff, RequirePermission, StaffGuard, type AuthedRequest, type StaffCtx } from '../../common/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { MenuAdminService } from './menu-admin.service';
import { needAny, toCSV } from './office.common';
import {
  AuditQueryDto, BannerDto, BranchDto, CategoryDto, ChannelDto, CourierDto, InventoryItemDto, LowStockQueryDto, ModifierGroupDto, ModifierOptionDto,
  OfficeDeviceDto, OpnameDto, PaymentOptionDto, ProductBranchDto, ProductDto, ProductModifiersDto, PromoDto, RecipeDto, ReorderLevelDto, ReportQueryDto,
  SettingsDto, ShiftQueryDto, StaffDto, StaffPasswordDto, StaffPinDto, StaffQueryDto, StockInDto, StockMovesQueryDto, StockQueryDto, TransactionQueryDto,
  TransferDto, UpdateBannerDto, UpdateBranchDto, UpdateCategoryDto, UpdateChannelDto, UpdateCourierDto, UpdateInventoryItemDto, UpdateModifierGroupDto,
  UpdateModifierOptionDto, UpdatePaymentOptionDto, UpdateProductDto, UpdatePromoDto, UpdateStaffDto,
} from './office.dto';
import { OrgAdminService } from './org-admin.service';
import { ReportService, type Report } from './report.service';
import { SalesService } from './sales.service';
import { StockAdminService } from './stock-admin.service';

const csvOut = (res: Response, name: string, body: string): string => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  return `﻿${body}`;
};

/** Kolom CSV per bagian laporan (angka mentah, rupiah bulat). */
function reportCsv(d: Report, view: string): string {
  const k = d.kpi;
  switch (view) {
    case 'items': return toCSV(d.items, [{ label: 'Menu', get: (r) => r.name }, { label: 'Kategori', get: (r) => r.categoryName }, { label: 'Terjual', get: (r) => r.qty }, { label: 'Kotor', get: (r) => r.gross }, { label: 'Diskon', get: (r) => r.disc }, { label: 'Penjualan', get: (r) => r.amount }]);
    case 'categories': return toCSV(d.categories, [{ label: 'Kategori', get: (r) => r.name }, { label: 'Terjual', get: (r) => r.qty }, { label: 'Penjualan', get: (r) => r.amount }]);
    case 'payments': return toCSV(d.payments, [{ label: 'Metode', get: (r) => r.name }, { label: 'Kode', get: (r) => r.code }, { label: 'Transaksi', get: (r) => r.count }, { label: 'Nominal', get: (r) => r.amount }]);
    case 'channels': return toCSV(d.channels, [{ label: 'Tipe pesanan', get: (r) => r.name }, { label: 'Transaksi', get: (r) => r.orders }, { label: 'Omzet', get: (r) => r.total }]);
    case 'cashiers': return toCSV(d.cashiers, [{ label: 'Kasir', get: (r) => r.name }, { label: 'Transaksi', get: (r) => r.orders }, { label: 'Omzet', get: (r) => r.total }, { label: 'Rata-rata', get: (r) => (r.orders ? Math.round(r.total / r.orders) : 0) }]);
    case 'days': return toCSV(d.days, [{ label: 'Tanggal', get: (r) => r.date }, { label: 'Transaksi', get: (r) => r.orders }, { label: 'Bersih (DPP)', get: (r) => r.net }, { label: 'Pajak', get: (r) => r.tax }, { label: 'Omzet', get: (r) => r.total }]);
    case 'hours': return toCSV(d.hours, [{ label: 'Jam', get: (r) => r.hour }, { label: 'Transaksi', get: (r) => r.orders }, { label: 'Item', get: (r) => r.items }, { label: 'Omzet', get: (r) => r.total }]);
    case 'branches': return toCSV(d.branches, [{ label: 'Cabang', get: (r) => r.name }, { label: 'Kode', get: (r) => r.code }, { label: 'Transaksi', get: (r) => r.orders }, { label: 'Item', get: (r) => r.items }, { label: 'Bersih', get: (r) => r.net }, { label: 'Omzet', get: (r) => r.total }]);
    case 'discounts': return toCSV(d.discounts, [{ label: 'Diskon', get: (r) => r.name }, { label: 'Dipakai', get: (r) => r.count }, { label: 'Nominal', get: (r) => r.amount }]);
    case 'voids': return toCSV([...d.voids, ...d.refunds], [{ label: 'Jenis', get: (r) => (r.kind === 'refund' ? 'Refund' : 'Void') }, { label: 'Nomor', get: (r) => r.number }, { label: 'Tanggal bisnis', get: (r) => r.bizDate }, { label: 'Waktu', get: (r) => r.at }, { label: 'Oleh', get: (r) => r.by }, { label: 'Alasan', get: (r) => r.reason }, { label: 'Nominal', get: (r) => Math.abs(r.total) }]);
    default:
      return toCSV(
        [
          ['Penjualan kotor', k.gross], ['Diskon', -k.discount], ['Penjualan bersih', k.net], ['Biaya layanan', k.service], ['Pajak', k.tax], ['Ongkir', k.deliveryFee],
          ['Pembulatan', k.rounding], ['Total diterima (omzet)', k.total], ['Jumlah transaksi', k.orders], ['Rata-rata per transaksi', k.avg], ['Item terjual', k.items],
          [`Refund (${k.refunds})`, -k.refundTotal], [`Void (${k.voids}, tidak dihitung)`, k.voidTotal],
        ] as [string, number][],
        [{ label: 'Keterangan', get: (r) => r[0] }, { label: 'Nilai', get: (r) => r[1] }],
      );
  }
}

@Controller('office')
@UseGuards(StaffGuard)
export class OfficeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
    private readonly sales: SalesService,
    private readonly menu: MenuAdminService,
    private readonly stock: StockAdminService,
    private readonly org: OrgAdminService,
  ) {}

  // ================================================================ sesi

  /** Profil staf + cabang yang boleh diakses (untuk menyusun menu & filter UI kantor). */
  @Get('me')
  async me(@CurrentStaff() staff: StaffCtx, @Req() req: AuthedRequest) {
    const branches = await this.prisma.db.branch.findMany({
      where: staff.branchIds ? { id: { in: staff.branchIds } } : {},
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, timezone: true, dayStartMinute: true, isActive: true },
    });
    return { staff, allBranches: staff.branchIds === null, branches, device: req.device ?? null };
  }

  // ================================================================ dasbor & laporan

  @Get('dashboard')
  @RequirePermission('report.view')
  dashboard(@CurrentStaff() staff: StaffCtx, @Query() q: ReportQueryDto) {
    return this.reports.dashboard(staff, q);
  }

  @Get('branch-status')
  @RequirePermission('report.view')
  branchStatus(@CurrentStaff() staff: StaffCtx) {
    return this.reports.branchStatus(staff);
  }

  @Get('reports')
  @RequirePermission('report.view')
  async report(@CurrentStaff() staff: StaffCtx, @Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const d = await this.reports.report(staff, q);
    if (q.format === 'csv') return csvOut(res, `robucca-laporan-${q.view ?? 'summary'}-${d.range.from}_${d.range.to}`, reportCsv(d, q.view ?? 'summary'));
    return d;
  }

  // ================================================================ transaksi & shift

  @Get('transactions')
  @RequirePermission('report.view')
  async transactions(@CurrentStaff() staff: StaffCtx, @Query() q: TransactionQueryDto, @Res({ passthrough: true }) res: Response) {
    if (q.format !== 'csv') return this.sales.transactions(staff, q);
    const d = await this.sales.transactions(staff, { ...q, limit: q.limit ?? 5000, offset: q.offset ?? 0 });
    return csvOut(res, `robucca-transaksi-${d.range.from}_${d.range.to}`, toCSV(d.rows, [
      { label: 'Nomor', get: (o) => o.number }, { label: 'Jenis', get: (o) => (o.refund ? 'Penjualan (direfund)' : 'Penjualan') }, { label: 'Status', get: (o) => o.status },
      { label: 'Tanggal bisnis', get: (o) => o.businessDate }, { label: 'Waktu', get: (o) => (o.paidAt ?? o.createdAt).toISOString() }, { label: 'Cabang', get: (o) => o.branchName },
      { label: 'Terminal', get: (o) => o.terminalNo }, { label: 'Kasir', get: (o) => o.cashierName }, { label: 'Tipe', get: (o) => o.channelName ?? o.type }, { label: 'Meja', get: (o) => o.tableNumber },
      { label: 'Pelanggan', get: (o) => o.customerName }, { label: 'Item', get: (o) => o.totals.items }, { label: 'Kotor', get: (o) => o.totals.gross }, { label: 'Diskon', get: (o) => o.totals.discount },
      { label: 'Bersih', get: (o) => o.totals.net }, { label: 'Layanan', get: (o) => o.totals.service }, { label: 'Pajak', get: (o) => o.totals.tax }, { label: 'Pembulatan', get: (o) => o.totals.rounding },
      { label: 'Total', get: (o) => o.totals.total }, { label: 'Pembayaran', get: (o) => o.payments.map((p) => `${p.name}:${p.amount}`).join(' + ') },
      { label: 'Alasan void/refund', get: (o) => o.voidReason ?? o.refund?.reason ?? '' },
    ]));
  }

  @Get('transactions/:id')
  @RequirePermission('report.view')
  transaction(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.transaction(staff, id);
  }

  @Get('shifts')
  @RequirePermission('report.view')
  async shifts(@CurrentStaff() staff: StaffCtx, @Query() q: ShiftQueryDto, @Res({ passthrough: true }) res: Response) {
    const d = await this.sales.shifts(staff, q);
    if (q.format !== 'csv') return d;
    return csvOut(res, `robucca-shift-${d.range.from}_${d.range.to}`, toCSV(d.rows, [
      { label: 'Cabang', get: (s) => s.branchName }, { label: 'Terminal', get: (s) => s.terminalNo }, { label: 'Tanggal', get: (s) => s.businessDate },
      { label: 'Dibuka', get: (s) => s.openedAt.toISOString() }, { label: 'Dibuka oleh', get: (s) => s.openedBy.name }, { label: 'Ditutup', get: (s) => s.closedAt?.toISOString() ?? '' },
      { label: 'Ditutup oleh', get: (s) => s.closedBy?.name ?? '' }, { label: 'Kas awal', get: (s) => s.openingCash }, { label: 'Penjualan', get: (s) => s.summary?.total ?? '' },
      { label: 'Kas seharusnya', get: (s) => s.expectedCash }, { label: 'Kas dihitung', get: (s) => s.countedCash }, { label: 'Selisih', get: (s) => s.difference }, { label: 'Catatan', get: (s) => s.differenceNote },
    ]));
  }

  @Get('shifts/:id')
  @RequirePermission('report.view')
  shift(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.shift(staff, id);
  }

  // ================================================================ menu

  @Get('menu')
  menuAll(@CurrentStaff() staff: StaffCtx, @Query() q: LowStockQueryDto) {
    needAny(staff, ['menu.manage', 'menu.availability', 'price.manage', 'report.view']);
    return this.menu.menu(staff, q.branchId);
  }

  @Post('categories')
  @RequirePermission('menu.manage')
  createCategory(@CurrentStaff() staff: StaffCtx, @Body() b: CategoryDto) {
    return this.menu.createCategory(staff, b);
  }

  @Patch('categories/:id')
  @RequirePermission('menu.manage')
  updateCategory(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateCategoryDto) {
    return this.menu.updateCategory(staff, id, b);
  }

  @Post('products')
  @RequirePermission('menu.manage')
  createProduct(@CurrentStaff() staff: StaffCtx, @Body() b: ProductDto) {
    return this.menu.createProduct(staff, b);
  }

  @Patch('products/:id')
  @RequirePermission('menu.manage')
  updateProduct(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateProductDto) {
    return this.menu.updateProduct(staff, id, b);
  }

  @Put('products/:id/modifier-groups')
  @RequirePermission('menu.manage')
  productModifiers(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: ProductModifiersDto) {
    return this.menu.setProductModifiers(staff, id, b.groups);
  }

  /** Ketersediaan/habis (menu.availability) dan harga khusus cabang (price.manage). */
  @Put('products/:id/branches/:branchId')
  productBranch(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() b: ProductBranchDto) {
    return this.menu.setProductBranch(staff, id, branchId, b);
  }

  @Post('modifier-groups')
  @RequirePermission('menu.manage')
  createGroup(@CurrentStaff() staff: StaffCtx, @Body() b: ModifierGroupDto) {
    return this.menu.createGroup(staff, b);
  }

  @Patch('modifier-groups/:id')
  @RequirePermission('menu.manage')
  updateGroup(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateModifierGroupDto) {
    return this.menu.updateGroup(staff, id, b);
  }

  @Post('modifier-groups/:id/options')
  @RequirePermission('menu.manage')
  addOption(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: ModifierOptionDto) {
    return this.menu.addOption(staff, id, b);
  }

  @Patch('modifier-options/:id')
  @RequirePermission('menu.manage')
  updateOption(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateModifierOptionDto) {
    return this.menu.updateOption(staff, id, b);
  }

  // ================================================================ resep (BoM)

  @Get('recipes')
  recipes(@CurrentStaff() staff: StaffCtx) {
    needAny(staff, ['menu.manage', 'stock.manage', 'inventory.manage']);
    return this.menu.recipes();
  }

  @Get('products/:id/recipe')
  productRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    needAny(staff, ['menu.manage', 'stock.manage', 'inventory.manage']);
    return this.menu.recipe({ productId: id });
  }

  @Put('products/:id/recipe')
  @RequirePermission('menu.manage')
  setProductRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: RecipeDto) {
    return this.menu.setRecipe(staff, { productId: id }, b);
  }

  @Delete('products/:id/recipe')
  @RequirePermission('menu.manage')
  deleteProductRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteRecipe(staff, { productId: id });
  }

  @Get('modifier-options/:id/recipe')
  optionRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    needAny(staff, ['menu.manage', 'stock.manage', 'inventory.manage']);
    return this.menu.recipe({ modifierOptionId: id });
  }

  @Put('modifier-options/:id/recipe')
  @RequirePermission('menu.manage')
  setOptionRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: RecipeDto) {
    return this.menu.setRecipe(staff, { modifierOptionId: id }, b);
  }

  @Delete('modifier-options/:id/recipe')
  @RequirePermission('menu.manage')
  deleteOptionRecipe(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteRecipe(staff, { modifierOptionId: id });
  }

  // ================================================================ bahan baku & stok

  @Get('inventory-items')
  inventoryItems(@CurrentStaff() staff: StaffCtx, @Query() q: StockQueryDto) {
    needAny(staff, ['stock.manage', 'inventory.manage', 'menu.manage', 'report.view']);
    return this.stock.items(!!q.includeInactive);
  }

  @Post('inventory-items')
  @RequirePermission('inventory.manage')
  createItem(@CurrentStaff() staff: StaffCtx, @Body() b: InventoryItemDto) {
    return this.stock.createItem(staff, b);
  }

  @Patch('inventory-items/:id')
  @RequirePermission('inventory.manage')
  updateItem(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateInventoryItemDto) {
    return this.stock.updateItem(staff, id, b);
  }

  @Get('stock')
  levels(@CurrentStaff() staff: StaffCtx, @Query() q: StockQueryDto) {
    needAny(staff, ['stock.manage', 'report.view']);
    return this.stock.levels(staff, q.branchId, !!q.includeInactive);
  }

  @Get('stock/low')
  low(@CurrentStaff() staff: StaffCtx, @Query() q: LowStockQueryDto) {
    needAny(staff, ['stock.manage', 'report.view']);
    return this.stock.low(staff, q.branchId);
  }

  @Get('stock/movements')
  movements(@CurrentStaff() staff: StaffCtx, @Query() q: StockMovesQueryDto) {
    needAny(staff, ['stock.manage', 'report.view']);
    return this.stock.movements(staff, q);
  }

  @Put('stock/:branchId/:itemId/reorder-level')
  @RequirePermission('stock.manage')
  reorder(@CurrentStaff() staff: StaffCtx, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() b: ReorderLevelDto) {
    return this.stock.setReorderLevel(staff, branchId, itemId, b.reorderLevel);
  }

  @Post('stock/in')
  @RequirePermission('stock.manage')
  stockIn(@CurrentStaff() staff: StaffCtx, @Body() b: StockInDto) {
    return this.stock.stockIn(staff, b);
  }

  @Post('stock/opname')
  @RequirePermission('stock.manage')
  opname(@CurrentStaff() staff: StaffCtx, @Body() b: OpnameDto) {
    return this.stock.opname(staff, b);
  }

  @Post('stock/transfer')
  @RequirePermission('stock.manage')
  transfer(@CurrentStaff() staff: StaffCtx, @Body() b: TransferDto) {
    return this.stock.transfer(staff, b);
  }

  // ================================================================ promo

  @Get('promos')
  @RequirePermission('promo.manage')
  promos(@CurrentStaff() staff: StaffCtx) {
    return this.org.promos(staff);
  }

  @Post('promos')
  @RequirePermission('promo.manage')
  createPromo(@CurrentStaff() staff: StaffCtx, @Body() b: PromoDto) {
    return this.org.createPromo(staff, b);
  }

  @Patch('promos/:id')
  @RequirePermission('promo.manage')
  updatePromo(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdatePromoDto) {
    return this.org.updatePromo(staff, id, b);
  }

  @Delete('promos/:id')
  @RequirePermission('promo.manage')
  deletePromo(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deletePromo(staff, id);
  }

  // ================================================================ karyawan

  @Get('roles')
  @RequirePermission('staff.manage')
  roles(@CurrentStaff() staff: StaffCtx) {
    return this.org.roles(staff);
  }

  @Get('staff')
  @RequirePermission('staff.manage')
  staffList(@CurrentStaff() staff: StaffCtx, @Query() q: StaffQueryDto) {
    return this.org.staffList(staff, q);
  }

  @Post('staff')
  @RequirePermission('staff.manage')
  createStaff(@CurrentStaff() staff: StaffCtx, @Body() b: StaffDto) {
    return this.org.createStaff(staff, b);
  }

  @Patch('staff/:id')
  @RequirePermission('staff.manage')
  updateStaff(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateStaffDto) {
    return this.org.updateStaff(staff, id, b);
  }

  @Put('staff/:id/pin')
  @RequirePermission('staff.manage')
  staffPin(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: StaffPinDto) {
    return this.org.setPin(staff, id, b.pin);
  }

  @Put('staff/:id/password')
  @RequirePermission('staff.manage')
  staffPassword(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: StaffPasswordDto) {
    return this.org.setPassword(staff, id, b.password);
  }

  /** Nonaktifkan karyawan (data & riwayat tetap ada). */
  @Delete('staff/:id')
  @RequirePermission('staff.manage')
  deactivateStaff(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.updateStaff(staff, id, { isActive: false });
  }

  // ================================================================ perangkat

  @Get('devices')
  @RequirePermission('device.manage')
  devices(@CurrentStaff() staff: StaffCtx) {
    return this.org.deviceList(staff);
  }

  @Post('devices')
  @RequirePermission('device.manage')
  createDevice(@CurrentStaff() staff: StaffCtx, @Body() b: OfficeDeviceDto) {
    return this.org.createDevice(staff, b);
  }

  @Post('devices/:id/pairing-code')
  @HttpCode(200)
  @RequirePermission('device.manage')
  pairingCode(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.devicePairingCode(staff, id);
  }

  @Delete('devices/:id')
  @RequirePermission('device.manage')
  revokeDevice(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.org.revokeDevice(staff, id, req.device?.id);
  }

  // ================================================================ cabang

  @Get('branches')
  branches(@CurrentStaff() staff: StaffCtx) {
    needAny(staff, ['branch.manage', 'settings.manage', 'report.view']);
    return this.org.branchList(staff);
  }

  @Post('branches')
  @RequirePermission('branch.manage')
  createBranch(@CurrentStaff() staff: StaffCtx, @Body() b: BranchDto) {
    return this.org.createBranch(staff, b);
  }

  @Patch('branches/:id')
  @RequirePermission('branch.manage')
  updateBranch(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateBranchDto) {
    return this.org.updateBranch(staff, id, b);
  }

  // ================================================================ pengaturan

  @Get('settings')
  settings(@CurrentStaff() staff: StaffCtx) {
    needAny(staff, ['settings.manage', 'report.view']);
    return this.org.settings();
  }

  @Patch('settings')
  @RequirePermission('settings.manage')
  updateSettings(@CurrentStaff() staff: StaffCtx, @Body() b: SettingsDto) {
    return this.org.updateSettings(staff, b);
  }

  @Post('channels')
  @RequirePermission('settings.manage')
  createChannel(@CurrentStaff() staff: StaffCtx, @Body() b: ChannelDto) {
    return this.org.createChannel(staff, b);
  }

  @Patch('channels/:id')
  @RequirePermission('settings.manage')
  updateChannel(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateChannelDto) {
    return this.org.updateChannel(staff, id, b);
  }

  @Post('payment-options')
  @RequirePermission('settings.manage')
  createPaymentOption(@CurrentStaff() staff: StaffCtx, @Body() b: PaymentOptionDto) {
    return this.org.createPaymentOption(staff, b);
  }

  @Patch('payment-options/:id')
  @RequirePermission('settings.manage')
  updatePaymentOption(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdatePaymentOptionDto) {
    return this.org.updatePaymentOption(staff, id, b);
  }

  @Post('couriers')
  @RequirePermission('settings.manage')
  createCourier(@CurrentStaff() staff: StaffCtx, @Body() b: CourierDto) {
    return this.org.createCourier(staff, b);
  }

  @Patch('couriers/:id')
  @RequirePermission('settings.manage')
  updateCourier(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateCourierDto) {
    return this.org.updateCourier(staff, id, b);
  }

  @Post('banners')
  @RequirePermission('settings.manage')
  createBanner(@CurrentStaff() staff: StaffCtx, @Body() b: BannerDto) {
    return this.org.createBanner(staff, b);
  }

  @Patch('banners/:id')
  @RequirePermission('settings.manage')
  updateBanner(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateBannerDto) {
    return this.org.updateBanner(staff, id, b);
  }

  @Delete('banners/:id')
  @RequirePermission('settings.manage')
  deleteBanner(@CurrentStaff() staff: StaffCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deleteBanner(staff, id);
  }

  // ================================================================ log aktivitas

  @Get('audit')
  @RequirePermission('audit.view')
  async audit(@CurrentStaff() staff: StaffCtx, @Query() q: AuditQueryDto, @Res({ passthrough: true }) res: Response) {
    const d = await this.org.audit(staff, q);
    if (q.format !== 'csv') return d;
    return csvOut(res, `robucca-log-${d.range.from}_${d.range.to}`, toCSV(d.rows, [
      { label: 'Waktu', get: (a) => a.createdAt.toISOString() }, { label: 'Cabang', get: (a) => a.branchName ?? 'Pusat' }, { label: 'Oleh', get: (a) => a.actorName ?? '-' },
      { label: 'Aktivitas', get: (a) => a.action }, { label: 'Objek', get: (a) => `${a.entity}${a.entityId ? `:${a.entityId}` : ''}` }, { label: 'Detail', get: (a) => JSON.stringify(a.detail) },
    ]));
  }

  @Get('audit/actions')
  @RequirePermission('audit.view')
  auditActions(@CurrentStaff() staff: StaffCtx) {
    return this.org.auditActions(staff);
  }
}
