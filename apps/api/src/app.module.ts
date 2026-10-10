import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/* Lapisan modul berikutnya (setelah skema disetujui):
   modules/<domain>/{<domain>.controller.ts → <domain>.service.ts → <domain>.repository.ts (Prisma), dto/} */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
