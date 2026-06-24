-- DropIndex
DROP INDEX "Candidate_makeDatastoreId_createdAt_idx";

-- DropIndex
DROP INDEX "Candidate_makeDatastoreId_externalId_key";

-- DropIndex
DROP INDEX "Candidate_makeDatastoreId_idx";

-- DropIndex
DROP INDEX "Candidate_makeDatastoreId_lastName_idx";

-- AlterTable
ALTER TABLE "Candidate" DROP COLUMN "makeDatastoreId",
ALTER COLUMN "poolId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "makeDatastoreId";

-- CreateIndex
CREATE INDEX "Candidate_poolId_idx" ON "Candidate"("poolId");

-- CreateIndex
CREATE INDEX "Candidate_poolId_createdAt_idx" ON "Candidate"("poolId", "createdAt");

-- CreateIndex
CREATE INDEX "Candidate_poolId_lastName_idx" ON "Candidate"("poolId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_poolId_externalId_key" ON "Candidate"("poolId", "externalId");

-- Vincolo: al massimo un Pool con isGlobal = true
CREATE UNIQUE INDEX pool_only_one_global
ON "Pool" ("isGlobal")
WHERE "isGlobal" = true;
