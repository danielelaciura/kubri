-- DropTable
DROP TABLE "CandidateTag";

-- CreateTable
CREATE TABLE "CandidateList" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateListMembership" (
    "listId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "addedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateListMembership_pkey" PRIMARY KEY ("listId","candidateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateList_organizationId_name_key" ON "CandidateList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CandidateList_organizationId_idx" ON "CandidateList"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateListMembership_candidateId_idx" ON "CandidateListMembership"("candidateId");

-- AddForeignKey
ALTER TABLE "CandidateList" ADD CONSTRAINT "CandidateList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateList" ADD CONSTRAINT "CandidateList_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListMembership" ADD CONSTRAINT "CandidateListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CandidateList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListMembership" ADD CONSTRAINT "CandidateListMembership_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListMembership" ADD CONSTRAINT "CandidateListMembership_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
