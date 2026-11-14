import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const TOKEN_COSTS = {
  SLIDE_CHECK: 1,
  INTERRUPT: 1,
  QA_GENERATE: 1,
  QA_EVALUATE: 1,
  TTS: 1,
  SUMMARY_ANALYZE: 2,
} as const;

const TOPUP_PACKAGES: Record<string, { amount: number; label: string }> = {
  starter: { amount: 50, label: 'แพ็กเกจทดลอง Starter (+50 Tokens)' },
  pro: { amount: 150, label: 'แพ็กเกจซ้อมจุใจ Pro (+150 Tokens)' },
};

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async spendTokens(
    userId: string,
    cost: number,
    type: string,
    description: string,
  ): Promise<number> {
    if (cost <= 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
      });
      return user?.tokenBalance ?? 0;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, tokenBalance: { gte: cost } },
        data: { tokenBalance: { decrement: cost } },
      });

      if (updated.count === 0) {
        throw new ForbiddenException({
          error: 'INSUFFICIENT_TOKENS',
          message: 'Token ของคุณไม่เพียงพอ กรุณากดที่ยอด Token เพื่อเติมจำลองหรือชวนเพื่อนรับเพิ่ม',
        });
      }

      await tx.tokenTransaction.create({
        data: {
          userId,
          amount: -cost,
          type,
          description,
        },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
      });
      return user?.tokenBalance ?? 0;
    });
  }

  async refundTokens(
    userId: string,
    amount: number,
    type: string,
    description: string,
  ): Promise<number> {
    if (amount <= 0) return 0;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: { increment: amount } },
        select: { tokenBalance: true },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          amount,
          type,
          description,
        },
      });

      return user.tokenBalance;
    });
  }

  async getWallet(userId: string) {
    const [user, transactions, referralCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          tokenBalance: true,
          referralCode: true,
        },
      }),
      this.prisma.tokenTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.prisma.user.count({
        where: {
          referredBy: userId,
          referralRewarded: true,
        },
      }),
    ]);

    return {
      tokenBalance: user?.tokenBalance ?? 0,
      referralCode: user?.referralCode ?? '',
      referralCount,
      maxReferrals: 10,
      transactions,
    };
  }

  async mockTopup(userId: string, packageId: string) {
    const pkg = TOPUP_PACKAGES[packageId];
    if (!pkg) {
      throw new BadRequestException('ไม่พบแพ็กเกจเติม Token ที่เลือก');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: { increment: pkg.amount } },
        select: { tokenBalance: true },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          amount: pkg.amount,
          type: 'TOPUP_MOCK',
          description: pkg.label,
        },
      });

      return {
        tokenBalance: user.tokenBalance,
        added: pkg.amount,
      };
    });
  }
}
