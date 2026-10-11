/* Masukan API publik (PWA pelanggan). Properti asing ditolak oleh ValidationPipe global. */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class OtpRequestDto {
  @Transform(trim)
  @Matches(/^\+?[\d\s-]{9,18}$/, { message: 'Nomor WhatsApp belum valid' })
  phone!: string;
}

export class OtpVerifyDto extends OtpRequestDto {
  @Matches(/^\d{6}$/, { message: 'Kode OTP 6 digit' })
  code!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class ProfileDto {
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;
}

export class OrderLineDto {
  @IsUUID()
  productId!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  optionIds!: string[];

  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  /** Harga satuan yang tampil di PWA. Bila beda dengan harga server, pesanan ditolak (menu berubah / dimanipulasi). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unitPrice?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class DeliveryInputDto {
  @Matches(/^[a-z0-9_-]{1,20}$/)
  courierCode!: string;

  @Transform(trim)
  @IsString()
  @Length(5, 300)
  addressText!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressNote?: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  /** Simpan alamat ini ke akun (butuh login). */
  @IsOptional()
  @IsBoolean()
  saveAddress?: boolean;
}

export class CreateOrderDto {
  /** UUIDv7 dari perangkat; kirim ulang dengan ID sama aman (tidak dobel). */
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(upper)
  @Matches(/^[A-Z0-9]{2,4}$/)
  branchCode!: string;

  @IsIn(['CLICK_COLLECT', 'DELIVERY'])
  type!: 'CLICK_COLLECT' | 'DELIVERY';

  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @Transform(trim)
  @Matches(/^\+?[\d\s-]{9,18}$/, { message: 'Nomor WhatsApp belum valid' })
  phone!: string;

  /** Kode metode: qris, gopay, ovo, dana, shopeepay, atau cashier (bayar di kasir). */
  @Matches(/^[a-z0-9_-]{1,20}$/)
  payment!: string;

  /** Click & Collect terjadwal; kosong = secepatnya. */
  @IsOptional()
  @IsDateString()
  pickupAt?: string;

  @IsOptional()
  @IsBoolean()
  cutlery?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;

  /** Pre-order untuk reservasi: milik pelanggan yang masuk, atau dengan token akses reservasi (tamu). */
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  reservationToken?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryInputDto)
  delivery?: DeliveryInputDto;

  /** Total yang tampil di PWA; bila beda dengan hitungan server, pesanan ditolak. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTotal?: number;
}

export class OrderRefDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MaxLength(400)
  token!: string;
}

export class LookupDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderRefDto)
  refs!: OrderRefDto[];
}

export class OrderIdParams {
  @IsUUID()
  id!: string;
}

export class ReservationDto {
  @Transform(upper)
  @Matches(/^[A-Z0-9]{2,4}$/)
  branchCode!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsInt()
  @Min(1)
  @Max(200)
  guests!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  area?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  occasion?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @Transform(trim)
  @Matches(/^\+?[\d\s-]{9,18}$/, { message: 'Nomor WhatsApp belum valid' })
  phone!: string;
}

export class AddressDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  label?: string;

  @Transform(trim)
  @IsString()
  @Length(5, 300)
  addressText!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressNote?: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  recipientName!: string;

  @Transform(trim)
  @Matches(/^\+?[\d\s-]{9,18}$/, { message: 'Nomor WhatsApp belum valid' })
  recipientPhone!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
