import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Hidup + database bisa dihubungi. */
  @Get()
  async check(): Promise<{ ok: true; service: string; db: 'up'; time: string }> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, service: 'robucca-api', db: 'down' });
    }
    return { ok: true, service: 'robucca-api', db: 'up', time: new Date().toISOString() };
  }
}
