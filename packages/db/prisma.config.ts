/* Konfigurasi Prisma CLI (Prisma 7: alamat database dibaca di sini, bukan di schema.prisma). */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Contoh: postgresql://robucca:rahasia@localhost:5432/robucca  (lihat .env.example)
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/robucca',
  },
});
