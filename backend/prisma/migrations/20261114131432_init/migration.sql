-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "tokenBalance" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT NOT NULL,
    "referredBy" UUID,
    "lastShareBonusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RehearsalSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deckName" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'general',
    "rehearsalMode" TEXT NOT NULL DEFAULT 'per_slide',
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "roomCode" TEXT,
    "shareId" TEXT,
    "slideCount" INTEGER NOT NULL DEFAULT 0,
    "totalDurationSec" INTEGER NOT NULL DEFAULT 0,
    "avgWpm" INTEGER NOT NULL DEFAULT 0,
    "avgEyeContactPct" INTEGER,
    "overallScore" INTEGER,
    "slidesJson" JSONB,
    "qaJson" JSONB,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RehearsalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RehearsalParticipant" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "slideIndexes" INTEGER[],
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "avgWpm" INTEGER NOT NULL DEFAULT 0,
    "avgEyeContactPct" INTEGER,
    "transcript" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RehearsalParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "TokenTransaction_userId_createdAt_idx" ON "TokenTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RehearsalSession_shareId_key" ON "RehearsalSession"("shareId");

-- CreateIndex
CREATE INDEX "RehearsalSession_userId_createdAt_idx" ON "RehearsalSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RehearsalParticipant_sessionId_idx" ON "RehearsalParticipant"("sessionId");

-- CreateIndex
CREATE INDEX "RehearsalParticipant_userId_idx" ON "RehearsalParticipant"("userId");

-- AddForeignKey
ALTER TABLE "TokenTransaction" ADD CONSTRAINT "TokenTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehearsalSession" ADD CONSTRAINT "RehearsalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehearsalParticipant" ADD CONSTRAINT "RehearsalParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RehearsalSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehearsalParticipant" ADD CONSTRAINT "RehearsalParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
