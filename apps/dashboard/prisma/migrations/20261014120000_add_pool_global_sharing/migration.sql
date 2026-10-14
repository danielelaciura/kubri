-- Per-pool override of Candidate.sharedWithGlobal at ingestion time.
-- Default WEBHOOK keeps today's behaviour (consent from the payload) for every
-- existing pool. No candidate rows are touched.

-- CreateEnum
CREATE TYPE "GlobalSharingMode" AS ENUM ('WEBHOOK', 'ALWAYS', 'NEVER');

-- AlterTable
ALTER TABLE "Pool" ADD COLUMN "globalSharing" "GlobalSharingMode" NOT NULL DEFAULT 'WEBHOOK';
