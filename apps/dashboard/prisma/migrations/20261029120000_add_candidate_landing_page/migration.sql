-- Public candidate landing pages. Additive only; no existing rows touched.

-- CreateTable
CREATE TABLE "CandidateLandingPage" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "privacyPolicyUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLandingPage_slug_key" ON "CandidateLandingPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLandingPage_organizationId_key" ON "CandidateLandingPage"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateLandingPage_poolId_idx" ON "CandidateLandingPage"("poolId");

-- AddForeignKey
ALTER TABLE "CandidateLandingPage" ADD CONSTRAINT "CandidateLandingPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateLandingPage" ADD CONSTRAINT "CandidateLandingPage_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
