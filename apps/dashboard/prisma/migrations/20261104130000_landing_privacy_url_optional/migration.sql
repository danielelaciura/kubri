-- AlterTable: the organization's own privacy notice becomes optional
-- (Kubri's notice always applies to the landing consent).
ALTER TABLE "CandidateLandingPage" ALTER COLUMN "privacyPolicyUrl" DROP NOT NULL;
