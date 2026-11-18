import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service.js';

const REFERRAL_BONUS = 10;
const MAX_REFERRALS_PER_USER = 10;
const MIN_SESSION_SEC_FOR_REFERRAL = 30;
const VIDEO_BUCKET = 'rehearsal-videos';
const MAX_CLOUD_VIDEO_BYTES = 40 * 1024 * 1024; // จำกัด 40 MB/คลิป
const MAX_CLOUD_VIDEOS_PER_USER = 3; // จำกัด 3 คลิป/คน เพื่อประหยัด Free Tier

export interface SaveParticipantInput {
  userId?: string | null;
  displayName: string;
  role?: string;
  slideIndexes?: number[];
  durationSec?: number;
  avgWpm?: number;
  avgEyeContactPct?: number | null;
  transcript?: string | null;
}

export interface SaveSessionInput {
  sessionId?: string;
  deckName: string;
  audience?: string;
  rehearsalMode?: string;
  isGroup?: boolean;
  roomCode?: string;
  seriesId?: string;
  roundNumber?: number;
  slideCount: number;
  totalDurationSec: number;
  avgWpm: number;
  avgEyeContactPct?: number | null;
  overallScore?: number | null;
  slidesJson?: unknown;
  qaJson?: unknown;
  summaryJson?: unknown;
  participants?: SaveParticipantInput[];
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveSession(userId: string, input: SaveSessionInput) {
    if (input.sessionId) {
      const existing = await this.prisma.rehearsalSession.findFirst({
        where: { id: input.sessionId, userId },
      });
      if (existing) {
        const updated = await this.prisma.rehearsalSession.update({
          where: { id: existing.id },
          data: {
            overallScore: input.overallScore ?? existing.overallScore,
            qaJson: (input.qaJson ?? existing.qaJson) as Prisma.InputJsonValue,
            summaryJson: (input.summaryJson ?? existing.summaryJson) as Prisma.InputJsonValue,
          },
        });
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { tokenBalance: true },
        });
        return {
          session: updated,
          referralBonusAwarded: false,
          tokenBalance: user?.tokenBalance ?? 0,
        };
      }
    }

    const shareId = randomBytes(5).toString('hex');

    return this.prisma.$transaction(async (tx) => {
      const candidateUserIds = Array.isArray(input.participants)
        ? Array.from(
            new Set(
              input.participants
                .map((p) => p?.userId?.trim())
                .filter((id): id is string => Boolean(id && /^[0-9a-fA-F-]{36}$/.test(id))),
            ),
          )
        : [];
      const validUsers =
        candidateUserIds.length > 0
          ? await tx.user.findMany({
              where: { id: { in: candidateUserIds } },
              select: { id: true },
            })
          : [];
      const validUserIdSet = new Set(validUsers.map((u) => u.id));

      const participantsData = Array.isArray(input.participants)
        ? input.participants
            .filter((p) => p?.displayName?.trim())
            .slice(0, 20)
            .map((p) => {
              const uid = p.userId?.trim();
              return {
                userId: uid && validUserIdSet.has(uid) ? uid : null,
                displayName: p.displayName.trim().slice(0, 80),
              role: p.role === 'host' ? 'host' : 'member',
              slideIndexes: Array.isArray(p.slideIndexes) ? p.slideIndexes.filter(Number.isInteger) : [],
              durationSec: Math.round(p.durationSec || 0),
              avgWpm: Math.round(p.avgWpm || 0),
              avgEyeContactPct:
                p.avgEyeContactPct !== undefined && p.avgEyeContactPct !== null
                  ? Math.round(p.avgEyeContactPct)
                  : null,
              transcript: p.transcript ? String(p.transcript).slice(0, 15000) : null,
              };
            })
        : [];

      const session = await tx.rehearsalSession.create({
        data: {
          userId,
          deckName: input.deckName,
          audience: input.audience || 'general',
          rehearsalMode: input.rehearsalMode || 'per_slide',
          isGroup: Boolean(input.isGroup),
          roomCode: input.roomCode ? input.roomCode.trim().slice(0, 20) : null,
          seriesId: input.seriesId ? input.seriesId.trim().slice(0, 80) : null,
          roundNumber: input.roundNumber && input.roundNumber > 0 ? Math.round(input.roundNumber) : 1,
          shareId,
          slideCount: input.slideCount,
          totalDurationSec: Math.round(input.totalDurationSec),
          avgWpm: Math.round(input.avgWpm),
          avgEyeContactPct:
            input.avgEyeContactPct !== undefined && input.avgEyeContactPct !== null
              ? Math.round(input.avgEyeContactPct)
              : null,
          overallScore:
            input.overallScore !== undefined && input.overallScore !== null
              ? Math.round(input.overallScore)
              : null,
          slidesJson: input.slidesJson as Prisma.InputJsonValue,
          qaJson: input.qaJson as Prisma.InputJsonValue,
          summaryJson: input.summaryJson as Prisma.InputJsonValue,
          ...(participantsData.length > 0
            ? { participants: { create: participantsData } }
            : {}),
        },
        include: { participants: true },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          tokenBalance: true,
          referredBy: true,
          referralRewarded: true,
        },
      });

      let referralBonusAwarded = false;
      let tokenBalance = user?.tokenBalance ?? 0;

      if (
        user &&
        user.referredBy &&
        !user.referralRewarded &&
        input.totalDurationSec >= MIN_SESSION_SEC_FOR_REFERRAL &&
        input.slideCount >= 1
      ) {
        const referrerRewardCount = await tx.user.count({
          where: { referredBy: user.referredBy, referralRewarded: true },
        });

        if (referrerRewardCount < MAX_REFERRALS_PER_USER) {
          const marked = await tx.user.updateMany({
            where: { id: user.id, referralRewarded: false },
            data: {
              referralRewarded: true,
              tokenBalance: { increment: REFERRAL_BONUS },
            },
          });

          if (marked.count > 0) {
            await tx.tokenTransaction.create({
              data: {
                userId: user.id,
                amount: REFERRAL_BONUS,
                type: 'REFERRAL_BONUS',
                description: 'โบนัสซ้อมครั้งแรกจากลิงก์ชวนเพื่อน',
              },
            });

            await tx.user.update({
              where: { id: user.referredBy },
              data: { tokenBalance: { increment: REFERRAL_BONUS } },
            });

            await tx.tokenTransaction.create({
              data: {
                userId: user.referredBy,
                amount: REFERRAL_BONUS,
                type: 'REFERRAL_BONUS',
                description: 'โบนัสชวนเพื่อนซ้อมสำเร็จ',
              },
            });

            referralBonusAwarded = true;
            tokenBalance += REFERRAL_BONUS;
          }
        }
      }

      return {
        session,
        referralBonusAwarded,
        tokenBalance,
      };
    });
  }

  listSessions(userId: string) {
    return this.prisma.rehearsalSession.findMany({
      where: {
        OR: [{ userId }, { participants: { some: { userId } } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        deckName: true,
        audience: true,
        rehearsalMode: true,
        isGroup: true,
        roomCode: true,
        seriesId: true,
        roundNumber: true,
        slideCount: true,
        totalDurationSec: true,
        avgWpm: true,
        avgEyeContactPct: true,
        overallScore: true,
        videoPath: true,
        videoUploadedAt: true,
        createdAt: true,
        participants: {
          select: {
            id: true,
            displayName: true,
            role: true,
            durationSec: true,
            avgWpm: true,
            avgEyeContactPct: true,
          },
        },
      },
    });
  }

  async getSession(userId: string, id: string) {
    const session = await this.prisma.rehearsalSession.findFirst({
      where: {
        id,
        OR: [{ userId }, { participants: { some: { userId } } }],
      },
      include: { participants: true },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }
    return session;
  }

  private getStorageClient(bearerToken?: string) {
    const url = process.env.SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
    const key = serviceKey || anonKey;
    if (!url || !key) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า Supabase Storage ในเซิร์ฟเวอร์');
    }
    const headers = !serviceKey && bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined;
    return {
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(headers ? { global: { headers } } : {}),
      }),
      hasServiceKey: Boolean(serviceKey),
    };
  }

  private async ensureVideoBucket(client: SupabaseClient, hasServiceKey: boolean) {
    if (!hasServiceKey) return;
    const { data } = await client.storage.getBucket(VIDEO_BUCKET);
    if (!data) {
      await client.storage.createBucket(VIDEO_BUCKET, {
        public: false,
        fileSizeLimit: MAX_CLOUD_VIDEO_BYTES,
      });
    }
  }

  async prepareCloudVideoUpload(
    userId: string,
    sessionId: string,
    fileSizeBytes: number,
    mimeType: string,
    bearerToken?: string,
  ) {
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new BadRequestException('ขนาดไฟล์วิดีโอไม่ถูกต้อง');
    }
    if (fileSizeBytes > MAX_CLOUD_VIDEO_BYTES) {
      throw new BadRequestException('ไฟล์วิดีโอใหญ่เกิน 40 MB (เกินขีดจำกัดสำหรับคลาวด์)');
    }

    const session = await this.prisma.rehearsalSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }

    const { client, hasServiceKey } = this.getStorageClient(bearerToken);
    await this.ensureVideoBucket(client, hasServiceKey);

    // จำกัดไม่เกิน 3 คลิปต่อคน: ลบคลิปเก่าสุดออกอัตโนมัติถ้าเกินโควตา
    const existingCloud = await this.prisma.rehearsalSession.findMany({
      where: { userId, videoPath: { not: null } },
      orderBy: { videoUploadedAt: 'asc' },
      select: { id: true, videoPath: true },
    });
    const others = existingCloud.filter((s) => s.id !== sessionId);
    if (others.length >= MAX_CLOUD_VIDEOS_PER_USER) {
      const toEvict = others.slice(0, others.length - (MAX_CLOUD_VIDEOS_PER_USER - 1));
      const paths = toEvict.map((s) => s.videoPath).filter((p): p is string => Boolean(p));
      if (paths.length > 0) {
        await client.storage.from(VIDEO_BUCKET).remove(paths).catch(() => {});
      }
      await this.prisma.rehearsalSession.updateMany({
        where: { id: { in: toEvict.map((s) => s.id) } },
        data: { videoPath: null, videoUploadedAt: null },
      });
    }

    if (session.videoPath) {
      await client.storage.from(VIDEO_BUCKET).remove([session.videoPath]).catch(() => {});
    }

    const ext = mimeType?.includes('webm') ? 'webm' : 'mp4';
    const path = `${userId}/${sessionId}_${Date.now()}.${ext}`;
    const { data, error } = await client.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      throw new BadRequestException(
        `ไม่สามารถเตรียมพื้นที่อัปโหลดบน Supabase Storage (${VIDEO_BUCKET}) ได้: ${error?.message || 'กรุณาตรวจสอบ Bucket/Policy'}`,
      );
    }

    return {
      signedUrl: data.signedUrl,
      token: data.token,
      path,
    };
  }

  async confirmCloudVideoUpload(userId: string, sessionId: string, path: string) {
    if (!path || !path.startsWith(`${userId}/${sessionId}_`)) {
      throw new BadRequestException('เส้นทางไฟล์ไม่ถูกต้อง');
    }
    const session = await this.prisma.rehearsalSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }
    return this.prisma.rehearsalSession.update({
      where: { id: sessionId },
      data: {
        videoPath: path,
        videoUploadedAt: new Date(),
      },
      select: { id: true, videoPath: true, videoUploadedAt: true },
    });
  }

  async getCloudVideoUrl(userId: string, sessionId: string, bearerToken?: string) {
    const session = await this.prisma.rehearsalSession.findFirst({
      where: {
        id: sessionId,
        OR: [{ userId }, { participants: { some: { userId } } }],
      },
      select: { id: true, videoPath: true },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }
    if (!session.videoPath) {
      return { url: null };
    }
    const { client } = this.getStorageClient(bearerToken);
    const { data, error } = await client.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(session.videoPath, 3600);
    if (error || !data?.signedUrl) {
      return { url: null };
    }
    return { url: data.signedUrl };
  }

  async deleteCloudVideo(userId: string, sessionId: string, bearerToken?: string) {
    const session = await this.prisma.rehearsalSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, videoPath: true },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }
    if (session.videoPath) {
      const { client } = this.getStorageClient(bearerToken);
      await client.storage.from(VIDEO_BUCKET).remove([session.videoPath]).catch(() => {});
    }
    await this.prisma.rehearsalSession.update({
      where: { id: sessionId },
      data: { videoPath: null, videoUploadedAt: null },
    });
    return { ok: true };
  }

  async deleteSessions(userId: string, ids?: string[], bearerToken?: string) {
    const cleanIds = Array.isArray(ids)
      ? ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    const where = cleanIds.length > 0 ? { userId, id: { in: cleanIds } } : { userId };

    const owned = await this.prisma.rehearsalSession.findMany({
      where,
      select: { id: true, videoPath: true },
    });

    const videoPaths = owned
      .map((s) => s.videoPath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);

    if (videoPaths.length > 0) {
      const { client } = this.getStorageClient(bearerToken);
      await client.storage.from(VIDEO_BUCKET).remove(videoPaths).catch(() => {});
    }

    const result = await this.prisma.rehearsalSession.deleteMany({ where });
    return { ok: true, deletedCount: result.count };
  }
}
