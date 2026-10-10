/* Dokumen yang dikirim perangkat POS saat sinkron (bisa dibuat offline lalu dikirim belakangan). */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';

export class DiscountDto {
  @IsIn(['PERCENT', 'AMOUNT'])
  type!: 'PERCENT' | 'AMOUNT';

  /** PERCENT: basis poin (1000 = 10%); AMOUNT: rupiah. */
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  value!: number;
}

export class ItemVoidDto {
  @IsString()
  @Length(1, 300)
  reason!: string;

  @IsOptional()
  @IsUUID()
  byId?: string;

  /** Token POST /pos/approve (order.void.approve): wajib untuk item yang sudah dikirim ke dapur/bar. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  approval?: string;

  @IsDateString()
  at!: string;
}

export class OrderItemDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number;

  /** Harga satuan akhir di perangkat (cabang + opsi + markup kanal). */
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unitPrice!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  optionIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto;

  @IsOptional()
  @IsUUID()
  promotionId?: string;

  @IsOptional()
  @IsDateString()
  sentToKitchenAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ItemVoidDto)
  voided?: ItemVoidDto;
}

export class PaymentDto {
  @IsUUID()
  id!: string;

  /** Kode PaymentOption, mis. "cash", "qris", "gopay". */
  @Matches(/^[a-z0-9_-]{1,20}$/)
  optionCode!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  tendered?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @IsDateString()
  at!: string;
}

export class OrderDocDto {
  @IsUUID()
  id!: string;

  @Matches(/^[A-Z0-9-]{6,40}$/)
  number!: string;

  @Matches(/^[A-Z0-9]{1,8}$/)
  queueNumber!: string;

  @IsIn(['DINE_IN', 'TAKEAWAY', 'FOOD_PLATFORM', 'CLICK_COLLECT', 'DELIVERY'])
  type!: 'DINE_IN' | 'TAKEAWAY' | 'FOOD_PLATFORM' | 'CLICK_COLLECT' | 'DELIVERY';

  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,20}$/)
  channelCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  tableNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  platformOrderRef?: string;

  @IsIn(['OPEN', 'PAID', 'VOIDED'])
  status!: 'OPEN' | 'PAID' | 'VOIDED';

  @IsOptional()
  @IsIn(['RECEIVED', 'PREPARING', 'READY', 'COMPLETED'])
  fulfillment?: 'RECEIVED' | 'PREPARING' | 'READY' | 'COMPLETED';

  @IsDateString()
  createdAt!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsUUID()
  cashierId!: string;

  /** Naik setiap kali perangkat mengubah pesanan. */
  @IsInt()
  @Min(1)
  version!: number;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto;

  @IsOptional()
  @IsUUID()
  promotionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  discountNote?: string;

  /** Token dari POST /pos/approve (online). Persetujuan offline (hanya discountApprovedById) ditolak server. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  discountApproval?: string;

  @IsOptional()
  @IsUUID()
  discountApprovedById?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments!: PaymentDto[];

  @IsOptional()
  @IsString()
  @Length(1, 300)
  voidReason?: string;

  @IsOptional()
  @IsUUID()
  voidedById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  voidApproval?: string;

  @IsOptional()
  @IsDateString()
  voidedAt?: string;
}

export class ShiftDocDto {
  @IsUUID()
  id!: string;

  @IsIn(['OPEN', 'CLOSED'])
  status!: 'OPEN' | 'CLOSED';

  @IsDateString()
  openedAt!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  openingCash!: number;

  @IsUUID()
  openedById!: string;

  @IsOptional()
  @IsDateString()
  closedAt?: string;

  @IsOptional()
  @IsUUID()
  closedById?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  countedCash?: number;

  @IsOptional()
  @IsObject()
  countedDenominations?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  differenceNote?: string;
}

export class CashMovementDocDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  shiftId!: string;

  @IsIn(['CASH_IN', 'CASH_OUT'])
  type!: 'CASH_IN' | 'CASH_OUT';

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsString()
  @Length(1, 200)
  reason!: string;

  @IsUUID()
  createdById!: string;

  @IsDateString()
  createdAt!: string;
}

export class KitchenDocDto {
  @IsUUID()
  orderId!: string;

  /** Kosong = seluruh tiket. */
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsBoolean()
  done!: boolean;

  @IsDateString()
  at!: string;
}

export class FulfillmentDocDto {
  @IsUUID()
  orderId!: string;

  @IsIn(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED'])
  fulfillment!: 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED';

  @IsDateString()
  at!: string;
}

export class AuditDocDto {
  @IsString()
  @Matches(/^[a-z0-9_.-]{2,60}$/)
  action!: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsObject()
  detail?: Record<string, unknown>;

  @IsDateString()
  at!: string;
}

export class SyncDto {
  /** Token sesi (POST /pos/login) staf yang login online di perangkat ini: bukti pelaku untuk penyetuju. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(1000, { each: true })
  staffSessions?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ShiftDocDto)
  shifts?: ShiftDocDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CashMovementDocDto)
  cashMovements?: CashMovementDocDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => OrderDocDto)
  orders?: OrderDocDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => KitchenDocDto)
  kitchen?: KitchenDocDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => FulfillmentDocDto)
  fulfillment?: FulfillmentDocDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AuditDocDto)
  audit?: AuditDocDto[];
}
