import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module.js';

try {
  process.loadEnvFile();
} catch {
  // ไม่พบไฟล์ .env ใช้ environment variables ของระบบแทน
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });
  app.use(json({ limit: '15mb' }));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
