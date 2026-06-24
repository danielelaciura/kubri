-- CandidateNote: add candidateId FK, drop makeRecordId
ALTER TABLE "CandidateNote" ADD COLUMN "candidateId" UUID;

UPDATE "CandidateNote" cn
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = cn."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = cn."makeRecordId";

-- Drop orphan rows (no matching Candidate could be resolved via Organization.makeDatastoreId).
-- Note: in dev/prod today, both tables are empty so this is a no-op. Documented for future runs.
DELETE FROM "CandidateNote" WHERE "candidateId" IS NULL;

ALTER TABLE "CandidateNote" ALTER COLUMN "candidateId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateNote_makeRecordId_organizationId_idx";
ALTER TABLE "CandidateNote" DROP COLUMN "makeRecordId";

ALTER TABLE "CandidateNote"
  ADD CONSTRAINT "CandidateNote_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CandidateNote_candidateId_idx" ON "CandidateNote"("candidateId");
CREATE INDEX "CandidateNote_organizationId_idx" ON "CandidateNote"("organizationId");

-- CandidateTag: add candidateId FK + unique
ALTER TABLE "CandidateTag" ADD COLUMN "candidateId" UUID;

UPDATE "CandidateTag" ct
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = ct."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = ct."makeRecordId";

-- Drop orphan rows (no matching Candidate could be resolved via Organization.makeDatastoreId).
-- Note: in dev/prod today, both tables are empty so this is a no-op. Documented for future runs.
DELETE FROM "CandidateTag" WHERE "candidateId" IS NULL;

ALTER TABLE "CandidateTag" ALTER COLUMN "candidateId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateTag_makeRecordId_organizationId_idx";
ALTER TABLE "CandidateTag" DROP COLUMN "makeRecordId";

ALTER TABLE "CandidateTag"
  ADD CONSTRAINT "CandidateTag_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CandidateTag_candidateId_idx" ON "CandidateTag"("candidateId");
CREATE INDEX "CandidateTag_organizationId_idx" ON "CandidateTag"("organizationId");
ALTER TABLE "CandidateTag"
  ADD CONSTRAINT "CandidateTag_candidateId_organizationId_tag_key"
  UNIQUE ("candidateId", "organizationId", tag);
