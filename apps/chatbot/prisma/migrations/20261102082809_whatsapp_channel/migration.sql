-- AlterEnum
ALTER TYPE "bot"."MessageType" ADD VALUE 'interactive';

-- AlterTable
ALTER TABLE "bot"."Message" ADD COLUMN     "interactive" JSONB,
ADD COLUMN     "replyId" TEXT;

-- CreateTable
CREATE TABLE "bot"."InboundDeadLetter" (
    "id" UUID NOT NULL,
    "raw" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundDeadLetter_pkey" PRIMARY KEY ("id")
);
