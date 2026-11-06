-- CreateEnum
CREATE TYPE "bot"."Channel" AS ENUM ('whatsapp');

-- CreateEnum
CREATE TYPE "bot"."SenderProvider" AS ENUM ('meta', 'twilio');

-- CreateEnum
CREATE TYPE "bot"."SenderStatus" AS ENUM ('provisioning', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "bot"."CampaignStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateTable
CREATE TABLE "bot"."SenderNumber" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID,
    "channel" "bot"."Channel" NOT NULL DEFAULT 'whatsapp',
    "provider" "bot"."SenderProvider" NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "bot"."SenderStatus" NOT NULL DEFAULT 'provisioning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Campaign" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "senderNumberId" UUID NOT NULL,
    "keywords" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "externalKey" TEXT NOT NULL,
    "status" "bot"."CampaignStatus" NOT NULL DEFAULT 'paused',
    "activeVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."CampaignVersion" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderNumber_slug_key" ON "bot"."SenderNumber"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SenderNumber_channel_phoneE164_key" ON "bot"."SenderNumber"("channel", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "bot"."Campaign"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_activeVersionId_key" ON "bot"."Campaign"("activeVersionId");

-- CreateIndex
CREATE INDEX "Campaign_senderNumberId_status_idx" ON "bot"."Campaign"("senderNumberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_version_key" ON "bot"."CampaignVersion"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_checksum_key" ON "bot"."CampaignVersion"("campaignId", "checksum");

-- AddForeignKey
ALTER TABLE "bot"."SenderNumber" ADD CONSTRAINT "SenderNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "bot"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "bot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_senderNumberId_fkey" FOREIGN KEY ("senderNumberId") REFERENCES "bot"."SenderNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "bot"."CampaignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "bot"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
