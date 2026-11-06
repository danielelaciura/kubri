-- AlterTable
ALTER TABLE "bot"."Session" ADD COLUMN     "consentsShown" JSONB NOT NULL DEFAULT '{}';
