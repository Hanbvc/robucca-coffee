import { Injectable } from '@nestjs/common';
import type { Prisma } from '@robucca/db';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  branchId?: string | null;
  actorId?: string | null;
  detail?: Prisma.InputJsonValue;
}

/** Log aktivitas: void, refund, diskon disetujui, shift, kas, stok, perangkat, perubahan data. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(e: AuditEntry, tx: Prisma.TransactionClient = this.prisma.db) {
    return tx.auditLog.create({
      data: { action: e.action, entity: e.entity, entityId: e.entityId ?? null, branchId: e.branchId ?? null, actorId: e.actorId ?? null, detail: e.detail ?? {} },
    });
  }
}
