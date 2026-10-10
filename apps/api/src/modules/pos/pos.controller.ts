import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, Res, Sse, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { CurrentDevice, DeviceGuard, type DeviceCtx } from '../../common/auth';
import { EventsService, type SseMessage } from '../events/events.service';
import { PosService } from './pos.service';
import { SyncDto } from './sync.dto';

/** API perangkat kasir/dapur/antrean. Semua rute butuh token perangkat (X-Device-Token). */
@Controller('pos')
@UseGuards(DeviceGuard)
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly events: EventsService,
  ) {}

  /** Data master; perangkat menyimpan salinannya agar tetap bisa berjualan saat offline. */
  @Get('master')
  async master(@CurrentDevice() device: DeviceCtx, @Headers('if-none-match') etag: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { version, master } = await this.pos.master(device);
    res.setHeader('ETag', `"${version}"`);
    if (etag === `"${version}"`) {
      res.status(304);
      return undefined;
    }
    return { version, master };
  }

  /** Kirim antrean data dari perangkat (outbox). Aman diulang: dokumen yang sama tidak tercatat dua kali. */
  @Post('sync')
  @HttpCode(200)
  sync(@Body() body: SyncDto, @CurrentDevice() device: DeviceCtx) {
    return this.pos.sync(body, device);
  }

  /** Pesanan cabang yang berubah sejak kursor terakhir. */
  @Get('feed')
  feed(@CurrentDevice() device: DeviceCtx, @Query('since') since?: string) {
    const d = since ? new Date(since) : null;
    if (d && Number.isNaN(d.getTime())) throw new BadRequestException('Kursor tidak valid');
    return this.pos.feed(device, d);
  }

  /** Notifikasi real-time (SSE): "feed" = ada perubahan pesanan, "master" = menu/pengaturan berubah. */
  @Sse('stream')
  stream(@CurrentDevice() device: DeviceCtx): Observable<SseMessage> {
    return this.events.stream(device.branchId);
  }
}
