import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@robucca/db';

/** Satu klien Prisma per proses API; dipakai lapisan repository saja. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient = createPrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}
