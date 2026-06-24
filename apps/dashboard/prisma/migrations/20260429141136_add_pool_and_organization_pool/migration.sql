-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "poolId" UUID;

-- CreateTable
CREATE TABLE "Pool" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "externalKey" TEXT,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationPool" (
    "organizationId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationPool_pkey" PRIMARY KEY ("organizationId","poolId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pool_slug_key" ON "Pool"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_externalKey_key" ON "Pool"("externalKey");

-- CreateIndex
CREATE INDEX "OrganizationPool_poolId_idx" ON "OrganizationPool"("poolId");

-- AddForeignKey
ALTER TABLE "OrganizationPool" ADD CONSTRAINT "OrganizationPool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationPool" ADD CONSTRAINT "OrganizationPool_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
