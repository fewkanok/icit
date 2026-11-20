import { Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { TokensService } from './tokens.service.js';

@Controller('api/tokens')
@UseGuards(SupabaseAuthGuard)
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('wallet')
  getWallet(@Req() req: { user: AuthUserPayload }) {
    return this.tokensService.getWallet(req.user.id);
  }

  @Post('topup-mock')
  topupMock() {
    throw new ForbiddenException('ระบบเติม Token จำลองถูกปิดใช้งานแล้ว');
  }
}
