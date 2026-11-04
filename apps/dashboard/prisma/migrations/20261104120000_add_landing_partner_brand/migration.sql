-- AlterTable: partner logo and the line under the organization name.
ALTER TABLE "CandidateLandingPage"
  ADD COLUMN "logoPath" TEXT,
  ADD COLUMN "taglineIt" TEXT,
  ADD COLUMN "taglineEn" TEXT;
