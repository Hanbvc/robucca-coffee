import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Setiap endpoint memakai DTO + class-validator: properti asing ditolak, tipe dikonversi.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  // PWA di origin lain (mis. http://localhost:3001): izinkan origin dari daftar CORS_ORIGINS (dipisah koma).
  // Tanpa CORS_ORIGINS, PWA memakai rewrite Next (/api/* → API) sehingga satu origin.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) {
    app.enableCors({
      origin: origins,
      allowedHeaders: ['content-type', 'x-customer-token', 'x-order-token', 'x-device-token', 'x-session', 'if-none-match'],
      exposedHeaders: ['etag'],
      maxAge: 600,
    });
  }
  // Di belakang proxy (rewrite Next, load balancer): IP klien dari X-Forwarded-For hanya bila proxy dipercaya,
  // mis. TRUST_PROXY=loopback. Tanpa pengaturan ini header itu diabaikan (tidak bisa dipalsukan klien).
  if (process.env.TRUST_PROXY) app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
