import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LangmindSlideInput {
  id?: number;
  title?: string;
  points?: string[] | string;
  bullets?: string[] | string;
  script?: string;
  text?: string;
}

export interface CreateLangmindPresetBody {
  deckName?: string;
  title?: string;
  topic?: string;
  audience?: string;
  rehearsalMode?: string;
  mode?: string;
  presentMinutes?: number | string;
  qaMinutes?: number | string;
  slides?: LangmindSlideInput[];
}

export interface NormalizedLangmindSlide {
  id: number;
  title: string;
  points: string[];
  script: string;
  text: string;
}

export interface StoredLangmindPreset {
  presetId: string;
  deckName: string;
  audience: 'general' | 'teacher' | 'executive';
  rehearsalMode: 'per_slide' | 'continuous';
  timeBudget: {
    presentMinutes: number;
    qaMinutes: number;
  };
  slides: NormalizedLangmindSlide[];
  createdAt: string;
}

const PRESET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // เก็บไว้ 7 วัน
const DB_ROOM_PREFIX = 'LM_';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePresetCode(len = 6): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return out;
}

function normalizeAudience(raw?: string): 'general' | 'teacher' | 'executive' {
  const val = String(raw || '').trim().toLowerCase();
  if (
    val === 'teacher' ||
    val === 'advisor' ||
    val === 'committee' ||
    val.includes('อาจารย์') ||
    val.includes('กรรมการ')
  ) {
    return 'teacher';
  }
  if (
    val === 'executive' ||
    val === 'investor' ||
    val.includes('ผู้บริหาร') ||
    val.includes('นักลงทุน')
  ) {
    return 'executive';
  }
  return 'general';
}

function normalizeMode(raw?: string): 'per_slide' | 'continuous' {
  const val = String(raw || '').trim().toLowerCase();
  if (
    val === 'continuous' ||
    val === 'full' ||
    val.includes('ต่อเนื่อง') ||
    val.includes('ซ้อมใหญ่')
  ) {
    return 'continuous';
  }
  return 'per_slide';
}

function normalizePoints(rawPoints?: string[] | string): string[] {
  if (Array.isArray(rawPoints)) {
    return rawPoints
      .map((item) => String(item || '').trim().replace(/^[-•*]\s*/, ''))
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof rawPoints === 'string' && rawPoints.trim()) {
    return rawPoints
      .split(/\r?\n|•/)
      .map((item) => item.trim().replace(/^[-*]\s*/, ''))
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

@Controller('api/langmind')
export class LangmindController {
  private readonly memoryStore = new Map<
    string,
    { data: StoredLangmindPreset; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('preset')
  async createPreset(@Body() body: CreateLangmindPresetBody) {
    const rawSlides = Array.isArray(body?.slides) ? body.slides : [];
    if (rawSlides.length === 0) {
      throw new BadRequestException(
        'กรุณาส่งรายการสไลด์ (slides) อย่างน้อย 1 หน้า',
      );
    }
    if (rawSlides.length > 40) {
      throw new BadRequestException('รองรับจำนวนสไลด์สูงสุดไม่เกิน 40 หน้า');
    }

    const deckName = String(
      body?.deckName || body?.title || body?.topic || 'สไลด์จาก LangMind AI',
    )
      .trim()
      .slice(0, 200);

    const audience = normalizeAudience(body?.audience);
    const rehearsalMode = normalizeMode(body?.rehearsalMode || body?.mode);

    const rawPresentMin = Number(body?.presentMinutes);
    const presentMinutes = Number.isFinite(rawPresentMin)
      ? Math.max(0, Math.min(30, Math.round(rawPresentMin)))
      : 5;

    const rawQaMin = Number(body?.qaMinutes);
    const qaMinutes = Number.isFinite(rawQaMin)
      ? Math.max(0, Math.min(15, Math.round(rawQaMin)))
      : 5;

    const slides: NormalizedLangmindSlide[] = rawSlides.map((s, idx) => {
      const title = String(s?.title || `สไลด์หน้าที่ ${idx + 1}`)
        .trim()
        .slice(0, 200);
      const script = String(s?.script || s?.text || '')
        .trim()
        .slice(0, 4000);
      let points = normalizePoints(s?.points ?? s?.bullets);

      if (points.length === 0 && script) {
        points = script
          .split(/(?<=[.!?])\s+|\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 4)
          .map((line) => (line.length > 110 ? `${line.slice(0, 107)}...` : line));
      }
      if (points.length === 0) {
        points = [title];
      }

      const combinedText = [
        title,
        points.length > 0 ? `ประเด็นสำคัญ: ${points.join(' | ')}` : '',
        script ? `บทพูด: ${script}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        id: idx + 1,
        title,
        points,
        script,
        text: combinedText,
      };
    });

    const presetId = generatePresetCode(6);
    const preset: StoredLangmindPreset = {
      presetId,
      deckName,
      audience,
      rehearsalMode,
      timeBudget: {
        presentMinutes,
        qaMinutes,
      },
      slides,
      createdAt: new Date().toISOString(),
    };

    this.pruneExpiredMemory();
    this.memoryStore.set(presetId, {
      data: preset,
      expiresAt: Date.now() + PRESET_TTL_MS,
    });

    // บันทึกสำรองลงฐานข้อมูล (ตาราง GroupClip โดยใช้ Prefix LM_ เพื่อไม่ให้ชนกับห้องซ้อมกลุ่ม)
    const dbKey = `${DB_ROOM_PREFIX}${presetId}`;
    await this.prisma.groupClip
      .upsert({
        where: {
          roomCode_slideIndex: { roomCode: dbKey, slideIndex: 0 },
        },
        create: {
          roomCode: dbKey,
          slideIndex: 0,
          memberId: 'langmind-agent',
          memberName: deckName.slice(0, 40),
          mimeType: 'application/json',
          mediaData: Buffer.from('LM'),
          analysis: preset as unknown as object,
        },
        update: {
          memberName: deckName.slice(0, 40),
          analysis: preset as unknown as object,
          createdAt: new Date(),
        },
      })
      .catch(() => {
        // หาก DB ไม่พร้อมใช้งาน ให้ใช้ memoryStore ต่อไปได้โดยไม่เกิด Error
      });

    const frontendBase = (
      process.env.FRONTEND_URL?.split(',')[0]?.trim().replace(/\/+$/, '') ||
      'https://icit-gamma.vercel.app'
    );
    const rehearsalUrl = `${frontendBase}/?preset=${presetId}`;
    const autoStartUrl = `${frontendBase}/?preset=${presetId}&autoStart=1`;

    return {
      ok: true,
      presetId,
      deckName,
      audience,
      rehearsalMode,
      presentMinutes,
      qaMinutes,
      slideCount: slides.length,
      rehearsalUrl,
      autoStartUrl,
      message: `สร้างห้องซ้อมพรีเซนต์สำเร็จ กดลิงก์เพื่อเข้าซ้อมได้ทันที: ${rehearsalUrl}`,
    };
  }

  @SkipThrottle()
  @Get('preset/:code')
  async getPreset(@Param('code') rawCode: string) {
    const presetId = String(rawCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!presetId) {
      throw new BadRequestException('รหัสชุดสไลด์ไม่ถูกต้อง');
    }

    this.pruneExpiredMemory();
    const cached = this.memoryStore.get(presetId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const dbKey = `${DB_ROOM_PREFIX}${presetId}`;
    const record = await this.prisma.groupClip
      .findUnique({
        where: {
          roomCode_slideIndex: { roomCode: dbKey, slideIndex: 0 },
        },
        select: { analysis: true },
      })
      .catch(() => null);

    if (record?.analysis && typeof record.analysis === 'object') {
      const preset = record.analysis as unknown as StoredLangmindPreset;
      this.memoryStore.set(presetId, {
        data: preset,
        expiresAt: Date.now() + PRESET_TTL_MS,
      });
      return preset;
    }

    throw new NotFoundException(
      'ไม่พบข้อมูลสไลด์สำหรับลิงก์นี้ หรือลิงก์อาจหมดอายุแล้ว',
    );
  }

  private pruneExpiredMemory() {
    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryStore.delete(key);
      }
    }
  }
}
