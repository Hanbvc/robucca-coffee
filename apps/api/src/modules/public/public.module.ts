import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { CatalogService } from './catalog.service';
import { CustomerAuthService, CustomerGuard, OptionalCustomerGuard } from './customer-auth';
import { CustomerService } from './customer.service';
import { OrderAccessGuard, PublicController } from './public.controller';
import { PublicOrdersService } from './public-orders.service';

/** API publik untuk PWA pelanggan (/public/*): katalog, OTP WhatsApp, pesanan, status real-time, reservasi, alamat. */
@Module({
  imports: [MenuModule],
  controllers: [PublicController],
  providers: [CatalogService, CustomerAuthService, CustomerGuard, OptionalCustomerGuard, OrderAccessGuard, CustomerService, PublicOrdersService],
})
export class PublicModule {}
