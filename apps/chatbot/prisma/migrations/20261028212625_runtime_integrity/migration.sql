-- AlterTable
ALTER TABLE "bot"."Consent" ADD COLUMN     "linkShown" TEXT;

-- AlterTable
ALTER TABLE "bot"."Turn" ADD COLUMN     "contactId" UUID;

-- Backfill (hand-written): turns that have a session belong to its contact.
UPDATE "bot"."Turn" AS t SET "contactId" = s."contactId" FROM "bot"."Session" AS s WHERE t."sessionId" = s."id";

-- CreateIndex
CREATE INDEX "Turn_contactId_startedAt_idx" ON "bot"."Turn"("contactId", "startedAt");

-- AddForeignKey
ALTER TABLE "bot"."Turn" ADD CONSTRAINT "Turn_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "bot"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma does not model CHECK constraints), D105: active and needs_attention
-- sessions are always open, stopped and abandoned never are, completed may be either
-- (open in the post-completion phase, closed after an opt-out or a new campaign).
ALTER TABLE "bot"."Session" ADD CONSTRAINT "Session_openKey_status_check" CHECK (
  "status" = 'completed' OR (("openKey" IS NULL) = ("status" NOT IN ('active', 'needs_attention')))
);
