import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: true; service: string; time: string } {
    return { ok: true, service: 'robucca-api', time: new Date().toISOString() };
  }
}
