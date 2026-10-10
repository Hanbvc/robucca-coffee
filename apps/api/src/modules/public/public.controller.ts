/* API publik PWA pelanggan: /public/* tanpa login staf.
   Identitas pelanggan: X-Customer-Token (OTP WhatsApp). Pesanan tamu: token akses per pesanan (?token=). */
import {
  Body, type CanActivate, Controller, Delete, type ExecutionContext, Get, HttpCode, Injectable, NotFoundException, Param, Patch, Post, Req, Sse, UseGuards,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { BranchCodeParams } from '../branches/branch-code.dto';
import type { SseMessage } from '../events/events.service';
import { CatalogService } from './catalog.service';
import {
  clientIp, CurrentCustomer, CustomerAuthService, type CustomerCtx, CustomerGuard, type CustomerRequest, OptionalCustomerGuard, orderTokenValid,
} from './customer-auth';
import { CustomerService } from './customer.service';
import { AddressDto, CreateOrderDto, LookupDto, OrderIdParams, OtpRequestDto, OtpVerifyDto, ProfileDto, ReservationDto } from './public.dto';
import { PublicOrdersService } from './public-orders.service';

/** Akses satu pesanan: token akses pesanan (?token= / X-Order-Token) atau pelanggan pemiliknya (X-Customer-Token). */
@Injectable()
export class OrderAccessGuard implements CanActivate {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly orders: PublicOrdersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<CustomerRequest>();
    const id = String(req.params.id ?? '');
    const q = req.query.token;
    const h = req.headers['x-order-token'];
    const token = typeof h === 'string' && h ? h : typeof q === 'string' ? q : undefined;
    if (orderTokenValid(token, id)) return true;
    const ct = req.headers['x-customer-token'];
    const customer = typeof ct === 'string' ? await this.auth.fromToken(ct) : null;
    if (customer && (await this.orders.ownedBy(id, customer.id))) return true;
    // Sama untuk "tidak ada" & "bukan milikmu": ID pesanan orang lain tidak bisa dipastikan ada.
    throw new NotFoundException('Pesanan tidak ditemukan');
  }
}

@Controller('public')
export class PublicController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly auth: CustomerAuthService,
    private readonly orders: PublicOrdersService,
    private readonly customers: CustomerService,
  ) {}

  // --- Katalog ---------------------------------------------------------------

  @Get('branches')
  branches() {
    return this.catalog.branches();
  }

  @Get('branches/:code/menu')
  menu(@Param() { code }: BranchCodeParams) {
    return this.catalog.menuFor(code);
  }

  @Get('banners')
  banners() {
    return this.catalog.banners();
  }

  @Get('couriers')
  couriers() {
    return this.catalog.couriers();
  }

  @Get('payment-options')
  paymentOptions() {
    return this.catalog.paymentOptions();
  }

  // --- Masuk dengan nomor WhatsApp (OTP) -------------------------------------------

  @Post('auth/otp')
  @HttpCode(200)
  otp(@Body() body: OtpRequestDto, @Req() req: CustomerRequest) {
    return this.auth.requestOtp(body.phone, clientIp(req));
  }

  @Post('auth/verify')
  @HttpCode(200)
  verify(@Body() body: OtpVerifyDto) {
    return this.auth.verifyOtp(body.phone, body.code, body.name);
  }

  @Get('me')
  @UseGuards(CustomerGuard)
  me(@CurrentCustomer() c: CustomerCtx) {
    return this.customers.me(c);
  }

  @Patch('me')
  @UseGuards(CustomerGuard)
  profile(@CurrentCustomer() c: CustomerCtx, @Body() body: ProfileDto) {
    return this.customers.updateProfile(c, body.name);
  }

  @Get('me/orders')
  @UseGuards(CustomerGuard)
  myOrders(@CurrentCustomer() c: CustomerCtx) {
    return this.orders.mine(c);
  }

  // --- Alamat tersimpan --------------------------------------------------------------

  @Get('me/addresses')
  @UseGuards(CustomerGuard)
  addresses(@CurrentCustomer() c: CustomerCtx) {
    return this.customers.addresses(c);
  }

  @Post('me/addresses')
  @UseGuards(CustomerGuard)
  addAddress(@CurrentCustomer() c: CustomerCtx, @Body() body: AddressDto) {
    return this.customers.addAddress(c, body);
  }

  @Patch('me/addresses/:id')
  @UseGuards(CustomerGuard)
  updateAddress(@CurrentCustomer() c: CustomerCtx, @Param() { id }: OrderIdParams, @Body() body: AddressDto) {
    return this.customers.updateAddress(c, id, body);
  }

  @Delete('me/addresses/:id')
  @UseGuards(CustomerGuard)
  deleteAddress(@CurrentCustomer() c: CustomerCtx, @Param() { id }: OrderIdParams) {
    return this.customers.deleteAddress(c, id);
  }

  // --- Pesanan -----------------------------------------------------------------------

  /** Click & Collect / Delivery / pre-order. Tamu boleh; token pelanggan (bila ada) menautkan pesanan ke akun. */
  @Post('orders')
  @UseGuards(OptionalCustomerGuard)
  createOrder(@Body() body: CreateOrderDto, @CurrentCustomer() c: CustomerCtx | null, @Req() req: CustomerRequest) {
    return this.orders.create(body, c, clientIp(req));
  }

  /** Status beberapa pesanan sekaligus (riwayat di perangkat tamu). Ref dengan token tidak sah diabaikan. */
  @Post('orders/lookup')
  @HttpCode(200)
  lookup(@Body() body: LookupDto) {
    return this.orders.lookup(body.refs.filter((r) => orderTokenValid(r.token, r.id)).map((r) => r.id));
  }

  @Get('orders/:id')
  @UseGuards(OrderAccessGuard)
  order(@Param() { id }: OrderIdParams) {
    return this.orders.get(id);
  }

  /** Status real-time (Server-Sent Events): event "status" berisi pesanan terbaru. */
  @Sse('orders/:id/stream')
  @UseGuards(OrderAccessGuard)
  stream(@Param() { id }: OrderIdParams): Observable<SseMessage> {
    return this.orders.stream(id);
  }

  @Post('orders/:id/received')
  @HttpCode(200)
  @UseGuards(OrderAccessGuard)
  received(@Param() { id }: OrderIdParams) {
    return this.orders.received(id);
  }

  // --- Reservasi ---------------------------------------------------------------------

  @Get('reservations')
  @UseGuards(CustomerGuard)
  reservations(@CurrentCustomer() c: CustomerCtx) {
    return this.customers.reservations(c);
  }

  @Post('reservations')
  @UseGuards(CustomerGuard)
  createReservation(@CurrentCustomer() c: CustomerCtx, @Body() body: ReservationDto) {
    return this.customers.createReservation(c, body);
  }

  @Get('reservations/:id')
  @UseGuards(CustomerGuard)
  reservation(@CurrentCustomer() c: CustomerCtx, @Param() { id }: OrderIdParams) {
    return this.customers.reservation(c, id);
  }

  @Post('reservations/:id/cancel')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  cancelReservation(@CurrentCustomer() c: CustomerCtx, @Param() { id }: OrderIdParams) {
    return this.customers.cancelReservation(c, id);
  }
}
