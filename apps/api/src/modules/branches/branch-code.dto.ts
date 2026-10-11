import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/** Kode cabang di URL, mis. /branches/IJN/menu (huruf kecil diterima). */
export class BranchCodeParams {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z0-9]{2,4}$/, { message: 'Kode cabang harus 2–4 huruf/angka' })
  code!: string;
}
