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
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (configured && configured.length > 0) {
    return Array.from(
      new Set([
        ...configured,
        'https://langmind.in.th',
        'https://www.langmind.in.th',
      ]),
    );
  }
  // ช่วงพัฒนาในเครื่อง (รวมถึงมือถือสแกน QR ผ่าน LAN IP)
  return process.env.NODE_ENV === 'production' ? false : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const httpAdapter = app.getHttpAdapter().getInstance();
  if (typeof httpAdapter?.disable === 'function') {
    httpAdapter.disable('x-powered-by');
  }
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.enableCors({ origin: getCorsOrigin(), credentials: true });
  app.use(json({ limit: '25mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
