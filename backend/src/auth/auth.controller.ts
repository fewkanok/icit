import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard, type AuthUserPayload } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Controller('api/auth')
@UseGuards(SupabaseAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  async getMe(
    @Req() req: { user: AuthUserPayload },
    @Query('ref') ref?: string,
  ) {
    const user = await this.authService.syncUser(req.user, ref);
    return { user };
  }
}
