import { defineConfig, env } from 'prisma/config';

try {
  process.loadEnvFile(new URL('./.env', import.meta.url));
} catch {
  // ใช้ environment variables ของระบบหากไม่มีไฟล์ .env
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
  },
});
