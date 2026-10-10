/* Bagian bersama API kantor (back-office): cakupan cabang, rentang tanggal, log + siaran "master". */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { addDays, businessDate, dayDiff, presetRange, PRESETS, zonedEpoch, type DateRange, type PresetKey } from '@robucca/core';
import type { Prisma } from '@robucca/db';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { can, canBranch, type StaffCtx } from '../../common/auth';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';

export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 400;
export const DEFAULT_TZ = 'Asia/Jakarta';
export const PRESET_KEYS = PRESETS.map(([k]) => k);

/** Super Admin = akses semua cabang. */
export const isSuper = (s: StaffCtx): boolean => s.branchIds === null;

/** Salah satu hak akses ini cukup. */
export function needAny(staff: StaffCtx, perms: string[]): void {
  if (!perms.some((p) => can(staff, p))) throw new ForbiddenException('Anda tidak punya akses untuk tindakan ini');
}

export function assertBranch(staff: StaffCtx, branchId: string): void {
  if (!canBranch(staff, branchId)) throw new ForbiddenException('Cabang di luar akses Anda');
}

/** Cabang yang diminta ∩ cabang yang boleh dilihat. null = semua cabang (Super Admin tanpa filter). */
export function scopeBranches(staff: StaffCtx, requested?: string[] | null): string[] | null {
  if (requested?.length) {
    for (const b of requested) assertBranch(staff, b);
    return [...new Set(requested)];
  }
  return staff.branchIds;
}

export const branchWhere = (ids: string[] | null): { branchId?: { in: string[] } } => (ids ? { branchId: { in: ids } } : {});

/** 'YYYY-MM-DD' → nilai kolom @db.Date. */
export const dateCol = (d: string): Date => new Date(`${d}T00:00:00Z`);
export const ymdOfCol = (d: Date): string => d.toISOString().slice(0, 10);

/** Batas waktu kasar (UTC) yang pasti mencakup hari bisnis from..to di zona mana pun; saring lagi dengan bizDateOf. */
export const looseWindow = (r: DateRange): { gte: Date; lt: Date } => ({
  gte: new Date(zonedEpoch(addDays(r.from, -1), '00:00', DEFAULT_TZ)),
  lt: new Date(zonedEpoch(addDays(r.to, 2), '00:00', DEFAULT_TZ)),
});

export interface BranchTz {
  timezone: string;
  dayStartMinute: number;
}
export const bizDateOf = (at: Date, b: BranchTz | undefined): string => businessDate(at.getTime(), b?.timezone ?? DEFAULT_TZ, b?.dayStartMinute ?? 0);

const csv = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return value;
};

/** Filter periode & cabang yang dipakai laporan, transaksi, shift, log. */
export class RangeQueryDto {
  @IsOptional()
  @IsIn(PRESET_KEYS)
  preset?: PresetKey;

  @IsOptional()
  @Matches(YMD, { message: 'from harus YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(YMD, { message: 'to harus YYYY-MM-DD' })
  to?: string;

  /** Satu atau beberapa ID cabang (dipisah koma). Kosong = semua cabang yang boleh dilihat. */
  @IsOptional()
  @Transform(csv)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchId?: string[];
}

export class PageQueryDto extends RangeQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Rentang dari from/to (keduanya) atau preset (relatif ke `today`). */
export function resolveRange(q: { preset?: PresetKey | undefined; from?: string | undefined; to?: string | undefined }, today: string, fallback: PresetKey): DateRange {
  if (q.from || q.to) {
    if (!q.from || !q.to) throw new BadRequestException('Isi from dan to sekaligus');
    const r = q.from <= q.to ? { from: q.from, to: q.to } : { from: q.to, to: q.from };
    if (Number.isNaN(Date.parse(r.from)) || Number.isNaN(Date.parse(r.to))) throw new BadRequestException('Tanggal tidak valid');
    if (dayDiff(r.from, r.to) > MAX_RANGE_DAYS) throw new BadRequestException(`Rentang maksimal ${MAX_RANGE_DAYS} hari`);
    return r;
  }
  return presetRange(q.preset ?? fallback, today);
}

/** "Hari ini" menurut cabang (bila hanya satu cabang dipilih) atau WIB. */
export const todayFor = (b?: BranchTz | null): string => businessDate(Date.now(), b?.timezone ?? DEFAULT_TZ, b?.dayStartMinute ?? 0);

export const dec = (v: Prisma.Decimal | number | null | undefined): number | null => (v == null ? null : Number(v));

/** Tulis log aktivitas dan beri tahu perangkat cabang agar menarik ulang /pos/master. */
@Injectable()
export class OfficeEvents {
  constructor(
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async log(staff: StaffCtx, action: string, entity: string, entityId: string | null, branchId: string | null, detail: Record<string, unknown> = {}, tx?: Prisma.TransactionClient): Promise<void> {
    await this.audit.log({ action, entity, entityId, branchId, actorId: staff.id, detail: detail as Prisma.InputJsonValue }, tx);
  }

  /** branchIds null = semua cabang. */
  master(branchIds: (string | null)[] | null, reason: string): void {
    const at = Date.now();
    if (branchIds === null || branchIds.includes(null)) {
      this.events.emit({ branchId: null, type: 'master', data: { reason, at } });
      return;
    }
    for (const b of new Set(branchIds)) if (b) this.events.emit({ branchId: b, type: 'master', data: { reason, at } });
  }
}

/** CSV dengan pemisah titik koma (langsung rapi di Excel berbahasa Indonesia), sama dengan POS lama. */
export function toCSV<T>(rows: T[], cols: { label: string; get: (r: T) => unknown }[]): string {
  const cell = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.label)).join(';'), ...rows.map((r) => cols.map((c) => cell(c.get(r))).join(';'))].join('\r\n');
}
