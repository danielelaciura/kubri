-- AlterTable: free-text name next to the partner logo, backfilled with the
-- organization name the page shows today.
ALTER TABLE "CandidateLandingPage" ADD COLUMN "brandName" TEXT;

UPDATE "CandidateLandingPage" AS l
SET "brandName" = o."name"
FROM "Organization" AS o
WHERE o."id" = l."organizationId";

ALTER TABLE "CandidateLandingPage" ALTER COLUMN "brandName" SET NOT NULL;
