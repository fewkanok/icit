import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const REFERRAL_BONUS = 10;
const MAX_REFERRALS_PER_USER = 10;
const MIN_SESSION_SEC_FOR_REFERRAL = 30;

export interface SaveSessionInput {
  sessionId?: string;
  deckName: string;
  audience?: string;
  rehearsalMode?: string;
  isGroup?: boolean;
  slideCount: number;
  totalDurationSec: number;
  avgWpm: number;
  avgEyeContactPct?: number | null;
  overallScore?: number | null;
  slidesJson?: unknown;
  qaJson?: unknown;
  summaryJson?: unknown;
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
      const session = await tx.rehearsalSession.create({
        data: {
          userId,
          deckName: input.deckName,
          audience: input.audience || 'general',
          rehearsalMode: input.rehearsalMode || 'per_slide',
          isGroup: Boolean(input.isGroup),
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
        },
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
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        deckName: true,
        audience: true,
        rehearsalMode: true,
        isGroup: true,
        slideCount: true,
        totalDurationSec: true,
        avgWpm: true,
        avgEyeContactPct: true,
        overallScore: true,
        createdAt: true,
      },
    });
  }

  async getSession(userId: string, id: string) {
    const session = await this.prisma.rehearsalSession.findFirst({
      where: { id, userId },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบประวัติการซ้อมนี้');
    }
    return session;
  }
}
