import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { BranchesModule } from './modules/branches/branches.module';
import { MenuModule } from './modules/menu/menu.module';
import { PrismaModule } from './prisma/prisma.module';

/* Setiap domain: modules/<domain>/{<domain>.controller.ts → <domain>.service.ts → <domain>.repository.ts (Prisma), *.dto.ts} */
@Module({
  imports: [PrismaModule, BranchesModule, MenuModule],
  controllers: [HealthController],
})
export class AppModule {}
