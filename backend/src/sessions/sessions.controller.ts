import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { SessionsService } from './sessions.service.js';

class SaveParticipantDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsArray()
  slideIndexes?: number[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  avgWpm?: number;

  @IsOptional()
  @IsNumber()
  avgEyeContactPct?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(15000)
  transcript?: string | null;
}

class PrepareVideoUploadDto {
  @IsNumber()
  @Min(1)
  fileSizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;
}

class ConfirmVideoUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  path!: string;
}

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

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seriesId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roundNumber?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SaveParticipantDto)
  participants?: SaveParticipantDto[];

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
    const payloadSize = Buffer.byteLength(
      JSON.stringify({
        slidesJson: body.slidesJson ?? null,
        qaJson: body.qaJson ?? null,
        summaryJson: body.summaryJson ?? null,
      }),
      'utf8',
    );
    if (payloadSize > 512 * 1024) {
      throw new BadRequestException('ข้อมูลประวัติการซ้อมมีขนาดใหญ่เกินกำหนด (สูงสุด 512KB)');
    }
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

  private extractBearer(req: { headers?: { authorization?: string } }): string | undefined {
    const auth = req.headers?.authorization || '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  }

  @Post(':id/video/prepare')
  prepareVideoUpload(
    @Req() req: { user: AuthUserPayload; headers?: { authorization?: string } },
    @Param('id') id: string,
    @Body() body: PrepareVideoUploadDto,
  ) {
    return this.sessionsService.prepareCloudVideoUpload(
      req.user.id,
      id,
      body.fileSizeBytes,
      body.mimeType || 'video/mp4',
      this.extractBearer(req),
    );
  }

  @Post(':id/video/confirm')
  confirmVideoUpload(
    @Req() req: { user: AuthUserPayload },
    @Param('id') id: string,
    @Body() body: ConfirmVideoUploadDto,
  ) {
    return this.sessionsService.confirmCloudVideoUpload(req.user.id, id, body.path);
  }

  @Get(':id/video-url')
  getCloudVideoUrl(
    @Req() req: { user: AuthUserPayload; headers?: { authorization?: string } },
    @Param('id') id: string,
  ) {
    return this.sessionsService.getCloudVideoUrl(req.user.id, id, this.extractBearer(req));
  }

  @Delete(':id/video')
  deleteCloudVideo(
    @Req() req: { user: AuthUserPayload; headers?: { authorization?: string } },
    @Param('id') id: string,
  ) {
    return this.sessionsService.deleteCloudVideo(req.user.id, id, this.extractBearer(req));
  }
}
