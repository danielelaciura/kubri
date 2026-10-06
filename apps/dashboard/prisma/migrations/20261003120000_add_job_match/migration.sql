-- CreateTable
CREATE TABLE "JobMatch" (
    "jobDescriptionId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "llmScore" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("jobDescriptionId","candidateId")
);

-- CreateIndex
CREATE INDEX "JobMatch_organizationId_llmScore_idx" ON "JobMatch"("organizationId", "llmScore");

-- CreateIndex
CREATE INDEX "JobMatch_organizationId_candidateId_idx" ON "JobMatch"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
