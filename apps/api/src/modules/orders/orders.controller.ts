import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CurrentStaff, RequirePermission, StaffGuard, type AuthedRequest, type StaffCtx } from '../../common/auth';
import { DispatchDto, RefundDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(StaffGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffCtx) {
    return this.orders.get(id, staff);
  }

  @Post(':id/refund')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() body: RefundDto, @CurrentStaff() staff: StaffCtx, @Req() req: AuthedRequest) {
    return this.orders.refund(id, body.reason, body.approval, staff, req.device);
  }

  /** Delivery: driver mengambil pesanan (atau data driver dibetulkan). */
  @Post(':id/dispatch')
  @HttpCode(200)
  @RequirePermission('order.sell')
  dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: DispatchDto, @CurrentStaff() staff: StaffCtx, @Req() req: AuthedRequest) {
    return this.orders.dispatch(id, body, staff, req.device);
  }

  /** Delivery: pesanan tiba di pelanggan. */
  @Post(':id/delivered')
  @HttpCode(200)
  @RequirePermission('order.sell')
  delivered(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffCtx, @Req() req: AuthedRequest) {
    return this.orders.delivered(id, staff, req.device);
  }
}
