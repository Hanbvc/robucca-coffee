import { Module } from '@nestjs/common';
import { OrderSyncService } from './order-sync.service';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  controllers: [PosController],
  providers: [PosService, OrderSyncService],
  exports: [PosService],
})
export class PosModule {}
