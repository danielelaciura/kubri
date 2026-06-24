-- Make userId nullable and ON DELETE SET NULL on CandidateNote, AuditLog, JobDescription.
-- This allows deleting a User (via admin.auth.admin.deleteUser) without losing
-- notes, audit logs, or job descriptions — they are preserved but unlinked.

-- CandidateNote.userId
ALTER TABLE "CandidateNote" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "CandidateNote" DROP CONSTRAINT IF EXISTS "CandidateNote_userId_fkey";
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog.userId
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_userId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- JobDescription.createdByUserId
ALTER TABLE "JobDescription" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "JobDescription" DROP CONSTRAINT IF EXISTS "JobDescription_createdByUserId_fkey";
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
