import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentDevice, DeviceGuard, type DeviceCtx } from '../../common/auth';
import { SalesService } from './sales.service';

/** Perangkat yang dipasang ulang / kehilangan data lokal melanjutkan shift yang masih terbuka di server. */
@Controller('pos')
@UseGuards(DeviceGuard)
export class PosShiftController {
  constructor(private readonly sales: SalesService) {}

  /** Shift OPEN terakhir milik terminal ini (beserta kas masuk/keluar), atau { shift: null }. */
  @Get('shift/open')
  async open(@CurrentDevice() device: DeviceCtx) {
    return { shift: await this.sales.openShiftForDevice(device.id, device.branchId, device.terminalNo) };
  }
}
