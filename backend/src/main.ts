import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module.js';

try {
  process.loadEnvFile();
} catch {
  // ไม่พบไฟล์ .env ใช้ environment variables ของระบบแทน
}

function getCorsOrigin(): boolean | string[] {
  const configured = process.env.FRONTEND_URL?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) {
    return configured;
  }
  // ช่วงพัฒนาในเครื่อง (รวมถึงมือถือสแกน QR ผ่าน LAN IP)
  return process.env.NODE_ENV === 'production' ? false : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: getCorsOrigin(), credentials: true });
  app.use(json({ limit: '8mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
