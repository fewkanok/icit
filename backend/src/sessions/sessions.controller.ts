import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { SessionsService } from './sessions.service.js';

class SaveSessionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  deckName!: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  rehearsalMode?: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsInt()
  @Min(0)
  slideCount!: number;

  @IsNumber()
  @Min(0)
  totalDurationSec!: number;

  @IsNumber()
  @Min(0)
  avgWpm!: number;

  @IsOptional()
  @IsNumber()
  avgEyeContactPct?: number | null;

  @IsOptional()
  @IsNumber()
  overallScore?: number | null;

  @IsOptional()
  slidesJson?: unknown;

  @IsOptional()
  qaJson?: unknown;

  @IsOptional()
  summaryJson?: unknown;
}

@Controller('api/sessions')
@UseGuards(SupabaseAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  saveSession(@Req() req: { user: AuthUserPayload }, @Body() body: SaveSessionDto) {
    return this.sessionsService.saveSession(req.user.id, body);
  }

  @Get()
  listSessions(@Req() req: { user: AuthUserPayload }) {
    return this.sessionsService.listSessions(req.user.id);
  }

  @Get(':id')
  getSession(@Req() req: { user: AuthUserPayload }, @Param('id') id: string) {
    return this.sessionsService.getSession(req.user.id, id);
  }
}
