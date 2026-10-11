import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Data publik cabang: tanpa pengaturan internal. */
const PUBLIC_BRANCH = {
  code: true,
  name: true,
  address: true,
  phone: true,
  openTime: true,
  closeTime: true,
  timezone: true,
  taxLabel: true,
  taxRateBp: true,
  taxInclusive: true,
  serviceRateBp: true,
  acceptsPwa: true,
  acceptsDelivery: true,
  acceptsReservations: true,
} as const;

@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive() {
    return this.prisma.db.branch.findMany({ where: { isActive: true }, select: PUBLIC_BRANCH, orderBy: { name: 'asc' } });
  }

  findActiveByCode(code: string) {
    return this.prisma.db.branch.findFirst({ where: { code, isActive: true }, select: { id: true, ...PUBLIC_BRANCH } });
  }
}
