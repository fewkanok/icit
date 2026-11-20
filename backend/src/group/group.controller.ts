import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupGateway } from './group.gateway.js';

const ALLOWED_MEDIA_MIME_BASES = new Set([
  'video/webm',
  'video/mp4',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
]);

function sanitizeMediaMimeType(raw?: string): string {
  const cleaned = String(raw || 'video/webm').trim().slice(0, 80);
  const base = cleaned.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_MIME_BASES.has(base)) {
    return 'video/webm';
  }
  return cleaned;
}

interface UploadGroupClipBody {
  slideIndex?: number;
  memberId?: string;
  memberName?: string;
  mimeType?: string;
  mediaBase64?: string;
  analysis?: Record<string, unknown>;
}

@Controller('group')
export class GroupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GroupGateway,
  ) {}

  @Post(':code/clips')
  async uploadClip(
    @Param('code') rawCode: string,
    @Body() body: UploadGroupClipBody,
  ) {
    const roomCode = rawCode.trim().toUpperCase();
    const slideIndex = Number(body?.slideIndex);
    if (!roomCode || !Number.isInteger(slideIndex) || slideIndex < 0) {
      throw new BadRequestException('ข้อมูลสไลด์ไม่ถูกต้อง');
    }
    if (!this.gateway.hasRoom(roomCode)) {
      throw new NotFoundException('ไม่พบห้องซ้อมกลุ่มนี้ หรือห้องปิดไปแล้ว');
    }
    const memberId = String(body.memberId || '').trim().slice(0, 80);
    if (!this.gateway.isMemberInRoom(roomCode, memberId)) {
      throw new ForbiddenException('เฉพาะสมาชิกที่อยู่ในห้องซ้อมเท่านั้นที่อัปโหลดคลิปได้');
    }
    if (!body?.mediaBase64 || typeof body.mediaBase64 !== 'string') {
      throw new BadRequestException('ไม่พบข้อมูลไฟล์คลิป');
    }

    const base64Marker = ';base64,';
    const markerIdx = body.mediaBase64.indexOf(base64Marker);
    const base64Clean =
      markerIdx !== -1
        ? body.mediaBase64.slice(markerIdx + base64Marker.length)
        : body.mediaBase64.includes(',')
          ? body.mediaBase64.slice(body.mediaBase64.lastIndexOf(',') + 1)
          : body.mediaBase64;
    const buffer = Buffer.from(base64Clean, 'base64');
    if (!buffer.length) {
      throw new BadRequestException('ไฟล์คลิปว่างเปล่า');
    }

    // ตัวกันเหนียว: ลบคลิปเก่าที่ค้างเกิน 4 ชั่วโมงอัตโนมัติ
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await this.prisma.groupClip
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch(() => {});

    const memberName = String(body.memberName || 'สมาชิก').slice(0, 40);
    const mimeType = sanitizeMediaMimeType(body.mimeType);

    await this.prisma.groupClip.upsert({
      where: {
        roomCode_slideIndex: { roomCode, slideIndex },
      },
      create: {
        roomCode,
        slideIndex,
        memberId,
        memberName,
        mimeType,
        mediaData: buffer,
        analysis: (body.analysis ?? {}) as object,
      },
      update: {
        memberId,
        memberName,
        mimeType,
        mediaData: buffer,
        analysis: (body.analysis ?? {}) as object,
        createdAt: new Date(),
      },
    });

    this.gateway.notifyClipUploaded(roomCode, slideIndex);
    return { ok: true, roomCode, slideIndex };
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':code/clips')
  async listClips(@Param('code') rawCode: string) {
    const roomCode = rawCode.trim().toUpperCase();
    if (!this.gateway.hasRoom(roomCode)) {
      throw new NotFoundException('ไม่พบห้องซ้อมกลุ่มนี้');
    }
    const clips = await this.prisma.groupClip.findMany({
      where: { roomCode },
      orderBy: { slideIndex: 'asc' },
      select: {
        id: true,
        roomCode: true,
        slideIndex: true,
        memberId: true,
        memberName: true,
        mimeType: true,
        analysis: true,
        createdAt: true,
      },
    });

    return clips.map((c) => ({
      ...c,
      mediaPath: `/group/${roomCode}/clips/${c.slideIndex}/media`,
    }));
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':code/clips/:slideIndex/media')
  async getClipMedia(
    @Param('code') rawCode: string,
    @Param('slideIndex', ParseIntPipe) slideIndex: number,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const roomCode = rawCode.trim().toUpperCase();
    if (!this.gateway.hasRoom(roomCode)) {
      throw new NotFoundException('ไม่พบห้องซ้อมกลุ่มนี้');
    }
    const clip = await this.prisma.groupClip.findUnique({
      where: { roomCode_slideIndex: { roomCode, slideIndex } },
      select: { mimeType: true, mediaData: true },
    });

    if (!clip) {
      throw new NotFoundException('ไม่พบคลิปของสไลด์นี้');
    }

    const buf = Buffer.from(clip.mediaData);
    const total = buf.length;
    const contentType = sanitizeMediaMimeType(clip.mimeType);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      const start = startStr ? Math.max(0, Number.parseInt(startStr, 10) || 0) : 0;
      const end = endStr ? Math.min(total - 1, Number.parseInt(endStr, 10) || total - 1) : total - 1;
      if (start <= end && start < total) {
        const chunk = buf.subarray(start, end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(chunk.length));
        res.send(chunk);
        return;
      }
    }

    res.setHeader('Content-Length', String(total));
    res.send(buf);
  }

  @Delete(':code/clips')
  async deleteRoomClips(@Param('code') rawCode: string) {
    const roomCode = rawCode.trim().toUpperCase();
    if (!this.gateway.hasRoom(roomCode)) {
      throw new NotFoundException('ไม่พบห้องซ้อมกลุ่มนี้');
    }
    const result = await this.prisma.groupClip.deleteMany({
      where: { roomCode },
    });
    return { ok: true, deleted: result.count };
  }
}
