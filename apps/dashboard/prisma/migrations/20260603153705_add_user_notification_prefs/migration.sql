-- CreateEnum
CREATE TYPE "NotifyFrequency" AS ENUM ('DAILY', 'WEEKLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyFrequency" "NotifyFrequency" NOT NULL DEFAULT 'WEEKLY';
