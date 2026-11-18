import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { GoogleGenAI } from '@google/genai';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_LINE_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';

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

  @SkipThrottle()
  @Get('line-pdf/:id')
  async streamLinePdf(@Param('id') rawId: string, @Res() res: Response) {
    const messageId = String(rawId || '')
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '');
    if (!messageId) {
      res.status(400).json({ message: 'รหัสไฟล์ PDF ไม่ถูกต้อง' });
      return;
    }

    const token = (
      process.env.LINE_CHANNEL_ACCESS_TOKEN || DEFAULT_LINE_CHANNEL_ACCESS_TOKEN
    ).trim();

    try {
      const lineRes = await fetch(
        `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!lineRes.ok || !lineRes.body) {
        res.status(lineRes.status || 404).json({
          message: 'ไม่สามารถดึงไฟล์ PDF จาก LINE ได้',
        });
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      const contentLen = lineRes.headers.get('content-length');
      if (contentLen) {
        res.setHeader('Content-Length', contentLen);
      }

      Readable.fromWeb(lineRes.body as unknown as import('node:stream/web').ReadableStream).pipe(
        res,
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          message: (err as Error)?.message || 'เกิดข้อผิดพลาดในการสตรีมไฟล์ PDF',
        });
      }
    }
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('evaluate-voice')
  async evaluateVoiceAnswer(
    @Body()
    body: {
      audioBase64?: string;
      mimeType?: string;
      durationSec?: number;
      question?: string;
      deckTitle?: string;
    },
  ) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey || !body?.audioBase64) {
      return { ok: false, message: 'ไม่พบข้อมูลเสียงหรือ API Key' };
    }

    const ai = new GoogleGenAI({ apiKey });
    const questionText = String(body.question || 'จงอธิบายจุดเด่นและที่มาของโครงงานนี้').trim();
    const deckTitle = String(body.deckTitle || 'โครงงานวิจัย').trim();
    const durationSec = Math.max(1, Number(body.durationSec || 15));

    const prompt = `คุณคือกรรมการสอบโครงงานระดับมหาวิทยาลัย
หัวข้อสไลด์: "${deckTitle}"
คำถามที่ถามผู้เรียน: "${questionText}"
ความยาวเสียงที่พูด: ${durationSec} วินาที

กรุณาฟังไฟล์เสียงคำตอบของผู้เรียนแล้วตอบกลับเป็น JSON เท่านั้น ตามโครงสร้างนี้:
{
  "transcript": "ถอดข้อความภาษาไทยที่ผู้เรียนพูดแบบคำต่อคำ (รวมคำติดปาก เช่น เอ่อ อ่า แบบว่า ถ้ามี)",
  "score": 8,
  "fillers": ["เอ่อ", "แบบว่า"],
  "strengths": "จุดที่ตอบได้ดี กระชับ 1 ประโยค",
  "improvement": "จุดที่ควรปรับปรุง 1 ประโยค",
  "betterAnswer": "ตัวอย่างคำตอบที่คมชัดตามหลัก A-R-E (Answer-Reason-Evidence) ความยาว 2-3 ประโยค"
}`;

    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: body.mimeType || 'audio/mp4',
                  data: body.audioBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
      });

      const raw = (response.text || '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { ok: true, ...parsed };
      }
      return { ok: false, message: 'ไม่สามารถแปลงผลลัพธ์ JSON ได้' };
    } catch (err) {
      return { ok: false, message: (err as Error)?.message || 'AI evaluation failed' };
    }
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
