/* DTO API kantor. Uang = rupiah bulat; persen = basis poin (1000 = 10%); jumlah bahan = angka (maks. 3 desimal). */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max,
  MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { TIMEZONES } from '@robucca/core';
import { PageQueryDto, RangeQueryDto, YMD } from './office.common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
/** URL gambar: http(s)://… atau jalur relatif seperti assets/img/kopi.jpg. */
const IMAGE_URL = /^(https?:\/\/[^\s]+|[A-Za-z0-9_][A-Za-z0-9_./-]*\.(jpg|jpeg|png|webp|avif|gif|svg))$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE = /^[a-z0-9][a-z0-9_-]{1,19}$/;

// ============================================================== laporan, transaksi, shift

export class ReportQueryDto extends RangeQueryDto {
  /** Bagian laporan untuk format=csv. */
  @IsOptional()
  @IsIn(['summary', 'items', 'categories', 'payments', 'channels', 'cashiers', 'days', 'branches', 'hours', 'discounts', 'voids'])
  view?: string;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class TransactionQueryDto extends PageQueryDto {
  /** paid | open | void | refunded | refund (punya dokumen refund) */
  @IsOptional()
  @IsIn(['paid', 'open', 'void', 'refunded', 'refund'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsIn(['DINE_IN', 'TAKEAWAY', 'CLICK_COLLECT', 'FOOD_PLATFORM', 'DELIVERY'])
  type?: 'DINE_IN' | 'TAKEAWAY' | 'CLICK_COLLECT' | 'FOOD_PLATFORM' | 'DELIVERY';

  @IsOptional()
  @IsIn(['POS', 'PWA'])
  source?: 'POS' | 'PWA';

  /** Kode kanal, mis. gofood. */
  @IsOptional()
  @Matches(CODE)
  channel?: string;

  /** Kode metode bayar, mis. qris. */
  @IsOptional()
  @Matches(CODE)
  payment?: string;

  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class ShiftQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class AuditQueryDto extends PageQueryDto {
  /** Awalan aksi, mis. "order." atau "menu.price.update". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** true = hanya log tingkat pusat (tanpa cabang). Khusus Super Admin. */
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  central?: boolean;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

// ============================================================== menu

export class CategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsIn(['DRINKS', 'SNACK', 'FOOD', 'PASTRY'])
  group!: 'DRINKS' | 'SNACK' | 'FOOD' | 'PASTRY';

  @IsOptional()
  @IsIn(['BAR', 'KITCHEN', 'NONE'])
  station?: 'BAR' | 'KITCHEN' | 'NONE';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  quickNotes?: string[];

  @IsOptional()
  @IsBoolean()
  isSignature?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsIn(['DRINKS', 'SNACK', 'FOOD', 'PASTRY']) group?: 'DRINKS' | 'SNACK' | 'FOOD' | 'PASTRY';
  @IsOptional() @IsIn(['BAR', 'KITCHEN', 'NONE']) station?: 'BAR' | 'KITCHEN' | 'NONE';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) quickNotes?: string[];
  @IsOptional() @IsBoolean() isSignature?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductModifierLinkDto {
  @IsUUID()
  groupId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  /** Grup tampil hanya bila salah satu opsi ini dipilih (opsi dari grup lain milik menu yang sama). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  showWhenOptionIds?: string[];
}

export class ProductDto {
  /** Kode stabil, mis. "caffe-latte". Kosong = dibuat dari nama. */
  @IsOptional()
  @Transform(lower)
  @Matches(/^[a-z0-9][a-z0-9-]{1,59}$/, { message: 'Slug: huruf kecil, angka, tanda hubung' })
  slug?: string;

  @IsUUID()
  categoryId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' })
  @MaxLength(500)
  imageUrl?: string | null;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  basePrice!: number;

  /** null = ikut stasiun kategori. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['BAR', 'KITCHEN', 'NONE'])
  station?: 'BAR' | 'KITCHEN' | 'NONE' | null;

  @IsOptional() @IsBoolean() isSignature?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductModifierLinkDto)
  modifierGroups?: ProductModifierLinkDto[];
}

export class UpdateProductDto {
  @IsOptional() @Transform(lower) @Matches(/^[a-z0-9][a-z0-9-]{1,59}$/) slug?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' }) @MaxLength(500) imageUrl?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) basePrice?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['BAR', 'KITCHEN', 'NONE']) station?: 'BAR' | 'KITCHEN' | 'NONE' | null;
  @IsOptional() @IsBoolean() isSignature?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductModifiersDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductModifierLinkDto)
  groups!: ProductModifierLinkDto[];
}

export class ProductBranchDto {
  /** false = tidak dijual / habis (sold out) di cabang ini. */
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  /** null = pakai harga pusat. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceOverride?: number | null;
}

export class ModifierOptionDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional() @IsInt() @Min(-10_000_000) @Max(10_000_000) priceDelta?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' }) @MaxLength(500) imageUrl?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateModifierOptionDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsInt() @Min(-10_000_000) @Max(10_000_000) priceDelta?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' }) @MaxLength(500) imageUrl?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ModifierGroupDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional() @IsIn(['SINGLE', 'MULTIPLE']) selection?: 'SINGLE' | 'MULTIPLE';
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(50) maxSelect?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options!: ModifierOptionDto[];
}

export class UpdateModifierGroupDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsIn(['SINGLE', 'MULTIPLE']) selection?: 'SINGLE' | 'MULTIPLE';
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(50) maxSelect?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ============================================================== resep & stok

export class RecipeLineDto {
  @IsUUID()
  inventoryItemId!: string;

  /** Satuan bahan (gram/ml/pcs). Resep produk: > 0. Resep opsi: boleh negatif (bukan 0). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-1_000_000)
  @Max(1_000_000)
  quantity!: number;
}

export class RecipeDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines!: RecipeLineDto[];
}

export class InventoryItemDto {
  @Transform(upper)
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, { message: 'SKU: huruf besar, angka, - atau _' })
  sku!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsIn(['GRAM', 'MILLILITER', 'PIECE'])
  unit!: 'GRAM' | 'MILLILITER' | 'PIECE';

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateInventoryItemDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/) sku?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsIn(['GRAM', 'MILLILITER', 'PIECE']) unit?: 'GRAM' | 'MILLILITER' | 'PIECE';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StockQueryDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  includeInactive?: boolean;
}

export class LowStockQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class StockMovesQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() inventoryItemId?: string;
  @IsOptional() @IsIn(['SALE', 'SALE_REVERSAL', 'PURCHASE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT']) type?: string;
  @IsOptional() @IsUUID() transferId?: string;
}

export class StockQtyLineDto {
  @IsUUID()
  inventoryItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;
}

export class StockInDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockQtyLineDto)
  lines!: StockQtyLineDto[];

  /** Pembelian/terima barang (PURCHASE) atau barang rusak/dibuang (WASTE, jumlah mengurangi stok). */
  @IsOptional()
  @IsIn(['PURCHASE', 'WASTE'])
  type?: 'PURCHASE' | 'WASTE';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class OpnameLineDto {
  @IsUUID()
  inventoryItemId!: string;

  /** Hasil hitung fisik. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  counted!: number;
}

export class OpnameDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OpnameLineDto)
  lines!: OpnameLineDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class TransferDto {
  @IsUUID()
  fromBranchId!: string;

  @IsUUID()
  toBranchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockQtyLineDto)
  lines!: StockQtyLineDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReorderLevelDto {
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  reorderLevel!: number | null;
}

// ============================================================== promo

export class PromoDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsIn(['PERCENT', 'AMOUNT'])
  type!: 'PERCENT' | 'AMOUNT';

  /** PERCENT: basis poin 1–10000; AMOUNT: rupiah. */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  value!: number;

  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() allBranches?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  /** ISO 8601, atau YYYY-MM-DD (awal hari WIB untuk validFrom, akhir hari untuk validUntil). */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) validUntil?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePromoDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) type?: 'PERCENT' | 'AMOUNT';
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) value?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() allBranches?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) branchIds?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) validUntil?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ============================================================== karyawan

const PIN = /^\d{4,6}$/;
export const ROLE_CODES = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'KITCHEN'] as const;
export type RoleCodeDto = (typeof ROLE_CODES)[number];

export class StaffQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Transform(bool) @IsBoolean() includeInactive?: boolean;
}

export class StaffDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsIn(ROLE_CODES)
  role!: RoleCodeDto;

  /** Wajib minimal satu untuk selain SUPER_ADMIN. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @IsOptional()
  @Matches(PIN, { message: 'PIN 4–6 digit' })
  pin?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(lower)
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(8, 200)
  password?: string;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateStaffDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsIn(ROLE_CODES) role?: RoleCodeDto;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) branchIds?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @Transform(lower) @IsEmail() email?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StaffPinDto {
  @Matches(PIN, { message: 'PIN 4–6 digit' })
  pin!: string;
}

export class StaffPasswordDto {
  @IsString()
  @Length(8, 200)
  password!: string;
}

// ============================================================== perangkat

export class OfficeDeviceDto {
  /** Kosong/null = komputer kantor pusat (khusus Super Admin). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId?: string | null;

  @IsInt()
  @Min(0)
  @Max(99)
  terminalNo!: number;

  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;
}

// ============================================================== cabang

const TZ_IDS = TIMEZONES.map((t) => t.id);

export class BranchDto {
  @Transform(upper)
  @Matches(/^[A-Z][A-Z0-9]{1,3}$/, { message: 'Kode cabang 2–4 karakter, diawali huruf (mis. IJN, CB2)' })
  code!: string;

  @Transform(trim) @IsString() @Length(1, 80) name!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsIn(TZ_IDS) timezone?: string;
  /** Menit setelah 00:00 hari bisnis berganti (0–360). */
  @IsOptional() @IsInt() @Min(0) @Max(360) dayStartMinute?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM) openTime?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM) closeTime?: string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 20) taxLabel?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBp?: number;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) serviceRateBp?: number;
  @IsOptional() @IsBoolean() taxOnService?: boolean;
  @IsOptional() @IsIn([58, 80]) receiptPaperMm?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) receiptFooter?: string | null;
  @IsOptional() @IsBoolean() acceptsPwa?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) deliveryMaxKm?: number | null;
  @IsOptional() @IsBoolean() acceptsReservations?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(500) maxReservationGuests?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) reservationAreas?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBranchDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z][A-Z0-9]{1,3}$/, { message: 'Kode cabang 2–4 karakter, diawali huruf' }) code?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsIn(TZ_IDS) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(360) dayStartMinute?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM) openTime?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM) closeTime?: string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 20) taxLabel?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBp?: number;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) serviceRateBp?: number;
  @IsOptional() @IsBoolean() taxOnService?: boolean;
  @IsOptional() @IsIn([58, 80]) receiptPaperMm?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) receiptFooter?: string | null;
  @IsOptional() @IsBoolean() acceptsPwa?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) deliveryMaxKm?: number | null;
  @IsOptional() @IsBoolean() acceptsReservations?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(500) maxReservationGuests?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) reservationAreas?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ============================================================== pengaturan

export class SettingsDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60) orgName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) tagline?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) instagram?: string | null;
  @IsOptional() @IsIn([1, 100, 500, 1000]) roundingUnit?: number;
  @IsOptional() @IsIn(['DOWN', 'NEAREST', 'UP']) roundingMode?: 'DOWN' | 'NEAREST' | 'UP';
  @IsOptional() @IsInt() @Min(0) @Max(10000) maxCashierDiscountBp?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) autoLockMinutes?: number;
  @IsOptional() @IsBoolean() autoPrintReceipt?: boolean;
  @IsOptional() @IsBoolean() blockSaleWhenOutOfStock?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(240) kdsWarnMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(240) kdsLateMinutes?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) receiptFooter?: string | null;
}

export class ChannelDto {
  @Transform(lower) @Matches(CODE, { message: 'Kode: huruf kecil/angka, 2–20 karakter' }) code!: string;
  @Transform(trim) @IsString() @Length(1, 40) name!: string;
  @IsIn(['DINE_IN', 'TAKEAWAY', 'FOOD_PLATFORM']) type!: 'DINE_IN' | 'TAKEAWAY' | 'FOOD_PLATFORM';
  @IsOptional() @IsInt() @Min(0) @Max(10000) markupBp?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateChannelDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) markupBp?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export const PAYMENT_METHODS = ['CASH', 'QRIS', 'DEBIT_CARD', 'CREDIT_CARD', 'E_WALLET', 'VIRTUAL_ACCOUNT', 'BANK_TRANSFER'] as const;

export class PaymentOptionDto {
  @Transform(lower) @Matches(CODE, { message: 'Kode: huruf kecil/angka, 2–20 karakter' }) code!: string;
  @Transform(trim) @IsString() @Length(1, 40) name!: string;
  @IsIn(PAYMENT_METHODS) method!: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) provider?: string | null;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePaymentOptionDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) provider?: string | null;
  @IsOptional() @IsBoolean() requiresReference?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CourierDto {
  @Transform(lower) @Matches(CODE) code!: string;
  @Transform(trim) @IsString() @Length(1, 40) name!: string;
  @Transform(trim) @IsString() @Length(1, 40) provider!: string;
  @IsInt() @Min(0) @Max(10_000_000) baseFee!: number;
  @IsInt() @Min(0) @Max(10_000_000) perKmFee!: number;
  @IsInt() @Min(0) @Max(10_000_000) minFee!: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCourierDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) name?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) provider?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) baseFee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) perKmFee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) minFee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BannerDto {
  @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' }) @MaxLength(500) imageUrl!: string;
  @Transform(trim) @IsString() @Length(1, 80) label!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) objectPosition?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBannerDto {
  @IsOptional() @Matches(IMAGE_URL, { message: 'URL gambar tidak valid' }) @MaxLength(500) imageUrl?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) label?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) objectPosition?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}


