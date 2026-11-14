import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { TokensService } from './tokens.service.js';

class TopupMockDto {
  @IsString()
  @IsIn(['starter', 'pro'])
  packageId!: string;
}

@Controller('api/tokens')
@UseGuards(SupabaseAuthGuard)
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('wallet')
  getWallet(@Req() req: { user: AuthUserPayload }) {
    return this.tokensService.getWallet(req.user.id);
  }

  @Post('topup-mock')
  topupMock(@Req() req: { user: AuthUserPayload }, @Body() body: TopupMockDto) {
    return this.tokensService.mockTopup(req.user.id, body.packageId);
  }
}
