import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDeviceDto {
  /** Kosong = komputer kantor pusat (dasbor). */
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z][A-Z0-9]{1,3}$/, { message: 'Kode cabang tidak valid' })
  branchCode?: string;

  @IsInt()
  @Min(0)
  @Max(99)
  terminalNo!: number;

  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;
}

export class PairDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{6}$/, { message: 'Kode pasang 6 digit' })
  code!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;
}
