import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUserPayload } from './auth.guard.js';

const WELCOME_BONUS_TOKENS = 30;

function makeReferralCode(): string {
  return `SQ${randomBytes(3).toString('hex').toUpperCase()}`;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async syncUser(authUser: AuthUserPayload, refCode?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });

    if (existing) {
      const needsUpdate =
        existing.email !== authUser.email ||
        (authUser.name && existing.name !== authUser.name) ||
        (authUser.avatarUrl && existing.avatarUrl !== authUser.avatarUrl);

      if (!needsUpdate) {
        return existing;
      }

      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          email: authUser.email || existing.email,
          name: authUser.name ?? existing.name,
          avatarUrl: authUser.avatarUrl ?? existing.avatarUrl,
        },
      });
    }

    const cleanRef = refCode?.trim().toUpperCase();
    let referrerId: string | null = null;
    if (cleanRef) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: cleanRef },
        select: { id: true },
      });
      if (referrer && referrer.id !== authUser.id) {
        referrerId = referrer.id;
      }
    }

    let referralCode = makeReferralCode();
    while (await this.prisma.user.findUnique({ where: { referralCode }, select: { id: true } })) {
      referralCode = makeReferralCode();
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name,
          avatarUrl: authUser.avatarUrl,
          tokenBalance: WELCOME_BONUS_TOKENS,
          referralCode,
          referredBy: referrerId,
        },
      });

      await tx.tokenTransaction.create({
        data: {
          userId: created.id,
          amount: WELCOME_BONUS_TOKENS,
          type: 'WELCOME_BONUS',
          description: 'โบนัสต้อนรับสมาชิกใหม่',
        },
      });

      return created;
    });
  }
}
