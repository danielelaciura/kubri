-- CreateEnum
CREATE TYPE "bot"."OptInStatus" AS ENUM ('opted_in', 'opted_out');

-- CreateEnum
CREATE TYPE "bot"."SessionStatus" AS ENUM ('active', 'completed', 'stopped', 'abandoned', 'needs_attention');

-- CreateEnum
CREATE TYPE "bot"."TurnOutcome" AS ENUM ('replied', 'ignored_media', 'no_campaign', 'failed');

-- CreateEnum
CREATE TYPE "bot"."MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "bot"."MessageType" AS ENUM ('text', 'audio', 'image', 'document', 'location', 'unsupported');

-- CreateEnum
CREATE TYPE "bot"."MessageStatus" AS ENUM ('received', 'processed', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "bot"."ChangeSource" AS ENUM ('extraction', 'edit', 'system');

-- CreateEnum
CREATE TYPE "bot"."ConsentOutcome" AS ENUM ('accepted', 'declined');

-- CreateTable
CREATE TABLE "bot"."Contact" (
    "id" UUID NOT NULL,
    "channel" "bot"."Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "preferredLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."ContactChannelState" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "senderNumberId" UUID NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "optInStatus" "bot"."OptInStatus" NOT NULL DEFAULT 'opted_in',
    "optInSource" TEXT,
    "optInAt" TIMESTAMP(3),
    "optOutAt" TIMESTAMP(3),

    CONSTRAINT "ContactChannelState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Session" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "senderNumberId" UUID NOT NULL,
    "campaignVersionId" UUID NOT NULL,
    "status" "bot"."SessionStatus" NOT NULL DEFAULT 'active',
    "engineState" JSONB NOT NULL,
    "language" TEXT,
    "openKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Turn" (
    "id" UUID NOT NULL,
    "sessionId" UUID,
    "inboundMessageIds" UUID[],
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "outcome" "bot"."TurnOutcome" NOT NULL,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Message" (
    "id" UUID NOT NULL,
    "ordinal" BIGSERIAL NOT NULL,
    "contactId" UUID NOT NULL,
    "senderNumberId" UUID NOT NULL,
    "sessionId" UUID,
    "turnId" UUID,
    "direction" "bot"."MessageDirection" NOT NULL,
    "type" "bot"."MessageType" NOT NULL,
    "body" TEXT,
    "bodyRedacted" TEXT,
    "language" TEXT,
    "payloadRaw" JSONB,
    "stepId" TEXT,
    "questionId" TEXT,
    "providerMessageId" TEXT,
    "status" "bot"."MessageStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."CandidateProfile" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "standard" JSONB NOT NULL DEFAULT '{}',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "fieldMeta" JSONB NOT NULL DEFAULT '{}',
    "sharedWithGlobal" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."ProfileChange" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "source" "bot"."ChangeSource" NOT NULL,
    "turnId" UUID,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Consent" (
    "id" UUID NOT NULL,
    "contactId" UUID,
    "contactHash" TEXT NOT NULL,
    "sessionId" UUID,
    "consentKey" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "textShown" TEXT NOT NULL,
    "textShownIsCurated" BOOLEAN NOT NULL,
    "dataController" JSONB NOT NULL,
    "outcome" "bot"."ConsentOutcome" NOT NULL,
    "messageId" UUID,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."SessionFlag" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "field" TEXT,
    "needsAttention" BOOLEAN NOT NULL,
    "turnId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."NluTrace" (
    "id" UUID NOT NULL,
    "turnId" UUID,
    "task" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" TEXT NOT NULL,
    "repair" BOOLEAN NOT NULL,
    "input" JSONB,
    "output" TEXT,
    "valid" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costEstimate" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NluTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."TranslationCache" (
    "sourceHash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("sourceHash","language")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_channel_externalId_key" ON "bot"."Contact"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannelState_contactId_senderNumberId_key" ON "bot"."ContactChannelState"("contactId", "senderNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_openKey_key" ON "bot"."Session"("openKey");

-- CreateIndex
CREATE INDEX "Session_contactId_senderNumberId_startedAt_idx" ON "bot"."Session"("contactId", "senderNumberId", "startedAt");

-- CreateIndex
CREATE INDEX "Turn_sessionId_startedAt_idx" ON "bot"."Turn"("sessionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "bot"."Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_contactId_senderNumberId_direction_status_ordinal_idx" ON "bot"."Message"("contactId", "senderNumberId", "direction", "status", "ordinal");

-- CreateIndex
CREATE INDEX "Message_sessionId_direction_createdAt_idx" ON "bot"."Message"("sessionId", "direction", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_sessionId_key" ON "bot"."CandidateProfile"("sessionId");

-- CreateIndex
CREATE INDEX "ProfileChange_profileId_createdAt_idx" ON "bot"."ProfileChange"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "Consent_sessionId_idx" ON "bot"."Consent"("sessionId");

-- CreateIndex
CREATE INDEX "Consent_contactHash_idx" ON "bot"."Consent"("contactHash");

-- CreateIndex
CREATE INDEX "SessionFlag_sessionId_idx" ON "bot"."SessionFlag"("sessionId");

-- CreateIndex
CREATE INDEX "NluTrace_turnId_idx" ON "bot"."NluTrace"("turnId");

-- CreateIndex
CREATE INDEX "NluTrace_createdAt_idx" ON "bot"."NluTrace"("createdAt");

-- AddForeignKey
ALTER TABLE "bot"."ContactChannelState" ADD CONSTRAINT "ContactChannelState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "bot"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."ContactChannelState" ADD CONSTRAINT "ContactChannelState_senderNumberId_fkey" FOREIGN KEY ("senderNumberId") REFERENCES "bot"."SenderNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Session" ADD CONSTRAINT "Session_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "bot"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Session" ADD CONSTRAINT "Session_senderNumberId_fkey" FOREIGN KEY ("senderNumberId") REFERENCES "bot"."SenderNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Session" ADD CONSTRAINT "Session_campaignVersionId_fkey" FOREIGN KEY ("campaignVersionId") REFERENCES "bot"."CampaignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Turn" ADD CONSTRAINT "Turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bot"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "bot"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Message" ADD CONSTRAINT "Message_senderNumberId_fkey" FOREIGN KEY ("senderNumberId") REFERENCES "bot"."SenderNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bot"."Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Message" ADD CONSTRAINT "Message_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "bot"."Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."CandidateProfile" ADD CONSTRAINT "CandidateProfile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bot"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."ProfileChange" ADD CONSTRAINT "ProfileChange_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "bot"."CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."ProfileChange" ADD CONSTRAINT "ProfileChange_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "bot"."Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Consent" ADD CONSTRAINT "Consent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "bot"."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Consent" ADD CONSTRAINT "Consent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bot"."Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."SessionFlag" ADD CONSTRAINT "SessionFlag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bot"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."SessionFlag" ADD CONSTRAINT "SessionFlag_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "bot"."Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."NluTrace" ADD CONSTRAINT "NluTrace_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "bot"."Turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
