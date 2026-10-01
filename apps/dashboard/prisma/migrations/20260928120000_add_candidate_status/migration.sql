-- CreateEnum
CREATE TYPE "CandidateStatusValue" AS ENUM ('NEW', 'CONTACTED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_SELECTED');

-- CreateTable
CREATE TABLE "CandidateStatus" (
    "candidateId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "CandidateStatusValue" NOT NULL,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateStatus_pkey" PRIMARY KEY ("candidateId","organizationId")
);

-- CreateIndex
CREATE INDEX "CandidateStatus_organizationId_status_idx" ON "CandidateStatus"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "CandidateStatus" ADD CONSTRAINT "CandidateStatus_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStatus" ADD CONSTRAINT "CandidateStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStatus" ADD CONSTRAINT "CandidateStatus_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

