import { Global, Module } from '@nestjs/common';
import { StockService } from './stock.service';

@Global()
@Module({ providers: [StockService], exports: [StockService] })
export class StockModule {}
