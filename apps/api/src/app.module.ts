import { Module } from '@nestjs/common';
import { AuthModule } from './common/auth.module';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthHttpModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { DevicesModule } from './modules/devices/devices.module';
import { EventsModule } from './modules/events/events.module';
import { MenuModule } from './modules/menu/menu.module';
import { OfficeModule } from './modules/office/office.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PosModule } from './modules/pos/pos.module';
import { PublicModule } from './modules/public/public.module';
import { StockModule } from './modules/stock/stock.module';
import { PrismaModule } from './prisma/prisma.module';

/* Setiap domain: modules/<domain>/{<domain>.controller.ts → <domain>.service.ts (→ Prisma), *.dto.ts} */
@Module({
  imports: [
    PrismaModule, AuthModule, AuditModule, EventsModule, StockModule,
    AuthHttpModule, DevicesModule, BranchesModule, MenuModule, PosModule, OrdersModule, OfficeModule, PublicModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
