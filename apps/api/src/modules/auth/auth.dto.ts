import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';

export class PinLoginDto {
  @IsUUID()
  userId!: string;

  @Matches(/^\d{4,6}$/, { message: 'PIN 4–6 digit' })
  pin!: string;
}

/** Tindakan yang butuh persetujuan manajer (PIN) di kasir. */
export const APPROVAL_PERMISSIONS = ['order.void.approve', 'order.refund.approve', 'discount.approve'] as const;

export class ApproveDto {
  @Matches(/^\d{4,6}$/, { message: 'PIN 4–6 digit' })
  pin!: string;

  @IsIn(APPROVAL_PERMISSIONS)
  permission!: (typeof APPROVAL_PERMISSIONS)[number];
}

export class PasswordLoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 200)
  password!: string;
}
