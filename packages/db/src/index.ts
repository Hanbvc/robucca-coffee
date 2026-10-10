/* Klien Prisma bersama untuk apps/api (repositori). Satu instance per proses. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL belum diisi (lihat packages/db/.env.example)');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
