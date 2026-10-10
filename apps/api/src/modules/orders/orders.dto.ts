import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

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
