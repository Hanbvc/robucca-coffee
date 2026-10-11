import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentStaff, RequirePermission, StaffGuard, type StaffCtx } from '../../common/auth';
import { RateLimiter } from '../../common/rate-limit';
import { CreateDeviceDto, PairDto } from './devices.dto';
import { DevicesService } from './devices.service';

const pairLimit = new RateLimiter(10, 15 * 60_000, 15 * 60_000);

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Perangkat baru memasukkan kode pasang dari kantor. */
  @Post('pos/pair')
  @HttpCode(200)
  async pair(@Body() body: PairDto, @Ip() ip: string) {
    pairLimit.check(ip);
    const r = await this.devices.pair(body.code, body.name);
    if (!r) {
      pairLimit.fail(ip);
      throw new BadRequestException('Kode pasang salah atau sudah kedaluwarsa');
    }
    pairLimit.ok(ip);
    return r;
  }

  @Get('devices')
  @UseGuards(StaffGuard)
  @RequirePermission('device.manage')
  list(@CurrentStaff() staff: StaffCtx) {
    return this.devices.list(staff.branchIds);
  }

  @Post('devices')
  @UseGuards(StaffGuard)
  @RequirePermission('device.manage')
  async create(@Body() body: CreateDeviceDto, @CurrentStaff() staff: StaffCtx) {
    await this.devices.assertAccess(staff, { branchCode: body.branchCode });
    return this.devices.create(body, staff.id);
  }

  @Post('devices/:id/pairing-code')
  @UseGuards(StaffGuard)
  @RequirePermission('device.manage')
  async pairingCode(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffCtx) {
    await this.devices.assertAccess(staff, { deviceId: id });
    return this.devices.newPairingCode(id, staff.id);
  }

  @Delete('devices/:id')
  @UseGuards(StaffGuard)
  @RequirePermission('device.manage')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffCtx) {
    await this.devices.assertAccess(staff, { deviceId: id });
    return this.devices.revoke(id, staff.id);
  }
}
