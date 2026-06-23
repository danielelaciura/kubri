-- Add Candidate.sharedWithGlobal: candidate consented (via the Kubri privacy
-- notice, "is_kubri_privacy_accepted" in the Make payload) to be shared with
-- the global dataset. Privacy-safe default false: no consent = not shared.
-- Hand-authored (worktree has no DB) — intentionally omits the spurious
-- DROP INDEX on the HNSW pgvector indexes that `prisma migrate dev` injects.
ALTER TABLE "Candidate" ADD COLUMN "sharedWithGlobal" BOOLEAN NOT NULL DEFAULT false;
