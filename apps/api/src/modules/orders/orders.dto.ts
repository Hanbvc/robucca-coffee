import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Teks kosong = tidak diisi. */
const blank = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class RefundDto {
  @IsString()
  @Length(3, 300)
  reason!: string;

  /** Token dari POST /pos/approve bila staf yang login tidak punya hak refund. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  approval?: string;
}

/** Driver yang mengambil pesanan delivery. Setiap kiriman mengganti data driver sebelumnya (kolom kosong = dihapus). */
export class DispatchDto {
  /** Dari aplikasi GoSend / GrabExpress, atau nama kurir cabang. */
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  driverName!: string;

  @IsOptional()
  @Transform(blank)
  @Matches(/^\+?[\d\s-]{9,18}$/, { message: 'Nomor driver belum valid' })
  driverPhone?: string;

  @IsOptional()
  @Transform(blank)
  @IsString()
  @Length(3, 15)
  vehiclePlate?: string;

  /** Tautan lacak dari aplikasi kurir. Hanya https (dibuka pelanggan sebagai tautan). */
  @IsOptional()
  @Transform(blank)
  @Matches(/^https:\/\/[^\s<>"']+$/, { message: 'Tautan lacak harus diawali https://' })
  @MaxLength(300)
  trackingUrl?: string;

  /** Perkiraan tiba dalam menit dari sekarang. Kosong: kiriman pertama memakai perkiraan jarak, kiriman ulang mempertahankan perkiraan lama. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  etaMinutes?: number;
}
