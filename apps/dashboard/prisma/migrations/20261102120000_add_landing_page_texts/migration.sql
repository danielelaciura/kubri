-- AlterTable: per-landing headline and intro, Italian and English.
ALTER TABLE "CandidateLandingPage"
  ADD COLUMN "titleIt" TEXT,
  ADD COLUMN "titleEn" TEXT,
  ADD COLUMN "subtitleIt" TEXT,
  ADD COLUMN "subtitleEn" TEXT;

-- Backfill existing landings with the texts they show today.
UPDATE "CandidateLandingPage" AS l
SET
  "titleIt" = 'Candidati con ' || o."name",
  "titleEn" = 'Apply to ' || o."name",
  "subtitleIt" = 'Scegli come preferisci. È gratis, ci vogliono pochi minuti e non serve registrarti.',
  "subtitleEn" = 'Choose the way you prefer. It''s free, it takes a few minutes and you don''t need an account.'
FROM "Organization" AS o
WHERE o."id" = l."organizationId";

ALTER TABLE "CandidateLandingPage"
  ALTER COLUMN "titleIt" SET NOT NULL,
  ALTER COLUMN "titleEn" SET NOT NULL;
