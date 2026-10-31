-- Candidate creation from the dashboard: import process records + attached documents.
-- Additive only; no existing rows touched.

-- CreateEnum
CREATE TYPE "CandidateImportOrigin" AS ENUM ('OPERATOR', 'PUBLIC_LINK', 'BULK');

-- CreateEnum
CREATE TYPE "CandidateImportStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'READY', 'COMPLETED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "CandidateDocumentKind" AS ENUM ('CV');

-- CreateTable
CREATE TABLE "CandidateImport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "origin" "CandidateImportOrigin" NOT NULL,
    "status" "CandidateImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "createdById" UUID,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "extractedText" TEXT,
    "extractionMethod" TEXT,
    "draft" JSONB,
    "errorCode" TEXT,
    "candidateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateDocument" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "kind" "CandidateDocumentKind" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateImport_organizationId_createdAt_idx" ON "CandidateImport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateImport_status_updatedAt_idx" ON "CandidateImport"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CandidateDocument_candidateId_idx" ON "CandidateDocument"("candidateId");

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

