import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CurrentStaff, StaffGuard, type AuthedRequest, type StaffCtx } from '../../common/auth';
import { RefundDto } from './orders.dto';
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
}
