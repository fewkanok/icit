import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SupabaseAuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthGuard],
  exports: [AuthService, SupabaseAuthGuard],
})
export class AuthModule {}
